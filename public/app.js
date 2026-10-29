// Single-page front end. Routes (hash based):
//   #/characters              list of registered characters
//   #/char/2588               "Character U+2588" page
//   #/char/2588/add-form      upload a glyph image for a font (password)
//   #/edit                    editor: register a character, add font files (password)
//   #/test-font               type text and preview it in an uploaded font
(() => {
  const app = document.getElementById('app');
  const TOKEN_KEY = 'glyph-token';
  let preferredFont = null; // font to preselect on the next character page
  const tester = { text: 'Type here to preview the font', font: '', size: 35, tofu: true }; // kept while browsing
  const loadedFaces = new Map(); // font file url -> CSS family name

  // ---------- Utilities ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
  const setToken = (t) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch {} };

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch('/api' + path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') setToken(null);
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
    return data;
  }

  function setTitle(title) { document.title = title; }
  function setActiveNav(name) {
    document.querySelectorAll('[data-nav]').forEach((el) => el.classList.toggle('active', el.dataset.nav === name));
  }

  // ---------- Password modal ----------
  const modal = document.getElementById('pw-modal');
  const pwForm = document.getElementById('pw-form');
  const pwInput = document.getElementById('pw-input');
  const pwError = document.getElementById('pw-error');
  let modalResolve = null;

  function askPassword() {
    pwInput.value = '';
    pwError.textContent = '';
    modal.hidden = false;
    pwInput.focus();
    return new Promise((resolve) => { modalResolve = resolve; });
  }
  function closeModal(result) {
    modal.hidden = true;
    if (modalResolve) modalResolve(result);
    modalResolve = null;
  }
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    pwError.textContent = '';
    try {
      const { token } = await api('/login', { method: 'POST', body: JSON.stringify({ password: pwInput.value }) });
      setToken(token);
      closeModal(true);
    } catch (err) {
      pwError.textContent = err.message;
      pwInput.select();
    }
  });
  document.getElementById('pw-cancel').addEventListener('click', () => closeModal(false));
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(false); });

  // Resolves true if we hold a valid token, prompting for the password if needed.
  async function ensureAuth() {
    if (getToken()) {
      try { await api('/auth'); return true; } catch { /* token expired */ }
    }
    return askPassword();
  }

  // Protected navigation: ask for the password, then go.
  async function goProtected(hash) {
    if (await ensureAuth()) location.hash = hash;
  }
  document.getElementById('edit-btn').addEventListener('click', () => goProtected('#/edit'));

  // ---------- Views ----------
  async function viewCharacters() {
    setTitle('Characters');
    setActiveNav('characters');
    app.innerHTML = '<h1>Characters</h1><p class="muted">Loading…</p>';
    const list = await api('/characters');
    if (!list.length) {
      app.innerHTML = '<h1>Characters</h1><p class="muted">No characters registered yet. Use <b>Edit</b> to register one.</p>';
      return;
    }
    app.innerHTML = `<h1>Characters</h1>
      <ul class="char-list">
        ${list.map((c) => `
          <li><a href="#/char/${esc(c.code)}">
            <span class="code">U+${esc(c.code)}</span>
            <span class="name">${esc(c.name)}</span>
          </a></li>`).join('')}
      </ul>`;
  }

  async function viewCharacter(code) {
    setActiveNav(null);
    setTitle(`Character U+${code}`);
    app.innerHTML = `<p class="muted center">Loading…</p>`;
    let char, fonts;
    try {
      [char, fonts] = await Promise.all([api('/characters/' + code), api('/fonts')]);
    } catch (err) {
      app.innerHTML = `<h1>Character U+${esc(code)}</h1><p class="error">${esc(err.message)}</p><a class="back" href="#/characters">← Back to Characters</a>`;
      return;
    }
    const formsByFont = new Map(char.forms.map((f) => [f.font.toLowerCase(), f]));

    app.innerHTML = `
      <section class="char-page">
        <h1>Character U+${esc(char.code)}</h1>
        <p class="subtitle">${esc(char.name)}</p>
        <div class="glyph-box" id="glyph-box"><span class="placeholder">Select a font below</span></div>
        <select class="font-select" id="font-select" aria-label="Font">
          <option value="">— Select a font —</option>
          ${fonts.map((f) => `<option value="${esc(f)}">${esc(f)}${formsByFont.has(f.toLowerCase()) ? '' : ' (no image)'}</option>`).join('')}
        </select>
        <button class="btn" id="add-form-btn" type="button">Add form</button>
      </section>`;

    const box = document.getElementById('glyph-box');
    const select = document.getElementById('font-select');
    function show() {
      const font = select.value;
      if (!font) { box.innerHTML = '<span class="placeholder">Select a font below</span>'; return; }
      const form = formsByFont.get(font.toLowerCase());
      box.innerHTML = form
        ? `<img src="${esc(form.image)}" alt="U+${esc(char.code)} ${esc(char.name)} in ${esc(font)}">`
        : `<span class="placeholder">No image of this character in <b>${esc(font)}</b> yet.</span>`;
    }
    select.addEventListener('change', show);
    if (preferredFont && fonts.includes(preferredFont)) { select.value = preferredFont; show(); }
    preferredFont = null;

    document.getElementById('add-form-btn').addEventListener('click', () => goProtected(`#/char/${char.code}/add-form`));
  }

  async function viewAddForm(code) {
    setActiveNav(null);
    if (!(await ensureAuth())) { location.hash = `#/char/${code}`; return; }
    let char, fonts;
    try {
      [char, fonts] = await Promise.all([api('/characters/' + code), api('/fonts')]);
    } catch (err) {
      app.innerHTML = `<p class="error">${esc(err.message)}</p>`;
      return;
    }
    setTitle(`Add form · Character U+${char.code}`);
    app.innerHTML = `
      <a class="back" href="#/char/${esc(char.code)}">← Character U+${esc(char.code)}</a>
      <h1>Add form</h1>
      <p class="muted">U+${esc(char.code)} ${esc(char.name)}</p>
      <form class="card stack" id="add-form">
        <input type="text" id="font" placeholder="Font" list="font-list" required maxlength="100" autocomplete="off">
        <datalist id="font-list">${fonts.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
        <input type="file" id="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" required>
        <img class="preview" id="preview" alt="Preview" hidden>
        <p class="error" id="form-error"></p>
        <div class="row">
          <button class="btn secondary" type="button" id="unsupported-btn" title="Use the shared tofu image for this font">Unsupported</button>
          <button class="btn" type="submit" id="upload-btn">Upload</button>
        </div>
      </form>`;

    const fileInput = document.getElementById('file');
    const preview = document.getElementById('preview');
    const errorEl = document.getElementById('form-error');
    let dataUrl = null;

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      dataUrl = null;
      preview.hidden = true;
      errorEl.textContent = '';
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { errorEl.textContent = 'Image must be 5 MB or smaller.'; fileInput.value = ''; return; }
      const reader = new FileReader();
      reader.onload = () => { dataUrl = reader.result; preview.src = dataUrl; preview.hidden = false; };
      reader.readAsDataURL(file);
    });

    const fontInput = document.getElementById('font');
    const buttons = [document.getElementById('upload-btn'), document.getElementById('unsupported-btn')];

    async function saveForm(payload) {
      errorEl.textContent = '';
      const font = fontInput.value.trim();
      if (!font) { errorEl.textContent = 'Enter the font name.'; fontInput.focus(); return; }
      buttons.forEach((b) => { b.disabled = true; });
      try {
        await api(`/characters/${char.code}/forms`, { method: 'POST', body: JSON.stringify({ font, ...payload }) });
        preferredFont = font;
        location.hash = `#/char/${char.code}`;
      } catch (err) {
        errorEl.textContent = err.message;
        buttons.forEach((b) => { b.disabled = false; });
        if (err.status === 401) goProtected(location.hash);
      }
    }

    document.getElementById('add-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!dataUrl) { errorEl.textContent = 'Choose an image file.'; return; }
      saveForm({ image: dataUrl });
    });
    // Marks the font as not supporting this character; the server uses the shared tofu image.
    document.getElementById('unsupported-btn').addEventListener('click', () => saveForm({ unsupported: true }));
  }

  async function viewEditor() {
    setActiveNav('edit');
    if (!(await ensureAuth())) { location.hash = '#/characters'; return; }
    setTitle('Editor');
    app.innerHTML = `
      <h1>Editor</h1>
      <form class="card stack" id="register-form" autocomplete="off">
        <input type="text" id="code" placeholder="Code" inputmode="text" maxlength="6" required spellcheck="false">
        <input type="text" id="name" placeholder="Name" maxlength="200" required spellcheck="false" autocapitalize="characters">
        <p class="error" id="reg-error"></p>
        <div class="row"><button class="btn" type="submit">Register</button></div>
      </form>

      <h2>Add font</h2>
      <form class="card stack" id="font-form" autocomplete="off">
        <input type="text" id="font-name" placeholder="Font name" maxlength="100" required>
        <input type="file" id="font-file" accept=".ttf,.otf,font/ttf,font/otf" required>
        <p class="error" id="font-error"></p>
        <div class="row"><button class="btn" type="submit" id="font-btn">Add font</button></div>
      </form>
      <ul class="font-list" id="font-list"></ul>`;

    const codeEl = document.getElementById('code');
    const nameEl = document.getElementById('name');
    const errorEl = document.getElementById('reg-error');

    // Filter while typing, keeping the caret in place.
    function filterInput(el, transform) {
      el.addEventListener('input', () => {
        const before = el.value;
        const after = transform(before);
        if (after === before) return;
        const pos = el.selectionStart - (before.length - after.length);
        el.value = after;
        el.setSelectionRange(Math.max(0, pos), Math.max(0, pos));
      });
    }
    // Code: hexadecimal digits only (a "U+" prefix is stripped).
    filterInput(codeEl, (v) => v.toUpperCase().replace(/^U\+/, '').replace(/[^0-9A-F]/g, ''));
    // Name: Basic Latin only, rendered in capitals.
    filterInput(nameEl, (v) => v.toUpperCase().replace(/[^\x20-\x7E]/g, ''));

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      try {
        const c = await api('/characters', { method: 'POST', body: JSON.stringify({ code: codeEl.value, name: nameEl.value }) });
        location.hash = `#/char/${c.code}`;
      } catch (err) {
        errorEl.textContent = err.message;
        if (err.status === 401) goProtected('#/edit');
      }
    });
    // ----- Add font -----
    const fontForm = document.getElementById('font-form');
    const fontName = document.getElementById('font-name');
    const fontFile = document.getElementById('font-file');
    const fontError = document.getElementById('font-error');
    const fontBtn = document.getElementById('font-btn');
    const fontList = document.getElementById('font-list');

    function renderFontList(fonts) {
      fontList.innerHTML = fonts.length
        ? fonts.map((f) => `<li><span>${esc(f.name)}</span><button type="button" class="btn secondary small" data-delete="${esc(f.name)}">Delete</button></li>`).join('')
        : '<li class="muted">No fonts added yet.</li>';
    }
    api('/font-files').then(renderFontList).catch(() => {});

    // Suggest a name from the file name.
    fontFile.addEventListener('change', () => {
      const file = fontFile.files[0];
      if (file && !fontName.value.trim()) fontName.value = file.name.replace(/\.(ttf|otf)$/i, '').replace(/[-_]+/g, ' ');
    });

    fontForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      fontError.textContent = '';
      const file = fontFile.files[0];
      if (!/\.(ttf|otf)$/i.test(file.name)) { fontError.textContent = 'Choose a .ttf or .otf file.'; return; }
      if (file.size > 30 * 1024 * 1024) { fontError.textContent = 'Font files must be 30 MB or smaller.'; return; }
      fontBtn.disabled = true;
      try {
        const fonts = await api('/font-files?name=' + encodeURIComponent(fontName.value.trim()), {
          method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
        });
        renderFontList(fonts);
        fontForm.reset();
      } catch (err) {
        fontError.textContent = err.message;
        if (err.status === 401) goProtected('#/edit');
      }
      fontBtn.disabled = false;
    });

    fontList.addEventListener('click', async (e) => {
      const name = e.target.dataset.delete;
      if (!name || !confirm(`Delete the font "${name}"?`)) return;
      try {
        renderFontList(await api('/font-files/' + encodeURIComponent(name), { method: 'DELETE' }));
      } catch (err) {
        fontError.textContent = err.message;
      }
    });

    codeEl.focus();
  }

  async function viewTestFont() {
    setActiveNav('test');
    setTitle('Test font');
    app.innerHTML = '<h1>Test font</h1><p class="muted">Loading…</p>';
    const fonts = await api('/font-files');
    if (!fonts.length) {
      app.innerHTML = '<h1>Test font</h1><p class="muted">No fonts yet. Add .ttf or .otf files with <b>Edit → Add font</b>.</p>';
      return;
    }
    if (!fonts.some((f) => f.name === tester.font)) tester.font = fonts[0].name;

    app.innerHTML = `
      <h1>Test font</h1>
      <div class="card tester">
        <div class="tester-controls">
          <select id="tf-font" aria-label="Font">
            ${fonts.map((f) => `<option value="${esc(f.name)}"${f.name === tester.font ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}
          </select>
          <label class="tf-size">
            Size
            <input type="text" id="tf-size" inputmode="decimal" maxlength="5" value="${tester.size}" aria-label="Font size in pixels">
            <span>px</span>
          </label>
          <label class="tf-check"><input type="checkbox" id="tf-tofu"${tester.tofu ? ' checked' : ''}> Show missing characters as tofu</label>
        </div>
        <textarea id="tf-preview" spellcheck="false" aria-label="Preview text"></textarea>
        <p class="muted" id="tf-status"></p>
      </div>`;

    const select = document.getElementById('tf-font');
    const size = document.getElementById('tf-size');
    const tofu = document.getElementById('tf-tofu');
    const preview = document.getElementById('tf-preview');
    const status = document.getElementById('tf-status');
    preview.value = tester.text;

    async function applyFont() {
      const font = fonts.find((f) => f.name === select.value);
      tester.font = font.name;
      let family = loadedFaces.get(font.url);
      if (!family) {
        status.textContent = 'Loading font…';
        family = 'ReshTest' + loadedFaces.size;
        try {
          const face = await new FontFace(family, `url("${font.url}")`).load();
          document.fonts.add(face);
          loadedFaces.set(font.url, family);
        } catch {
          status.textContent = `Could not load "${font.name}". The file may be damaged.`;
          return;
        }
        if (select.value !== font.name) return; // user picked another font meanwhile
      }
      status.textContent = '';
      // The fallback decides what happens to characters the font lacks.
      preview.style.fontFamily = `"${family}", ${tofu.checked ? '"Resh Tofu"' : 'system-ui, sans-serif'}`;
    }
    // Applies the typed size once it is a number from 1 to 500; otherwise keeps the last good size.
    function applySize() {
      const value = Number(size.value);
      const valid = /^\d+(\.\d+)?$/.test(size.value.trim()) && value >= 1 && value <= 500;
      size.classList.toggle('invalid', !valid);
      if (!valid) return;
      tester.size = value;
      preview.style.fontSize = value + 'px';
    }
    function resetSizeField() {
      size.value = tester.size;
      size.classList.remove('invalid');
    }

    select.addEventListener('change', applyFont);
    size.addEventListener('input', applySize);
    size.addEventListener('blur', resetSizeField);
    size.addEventListener('keydown', (e) => { if (e.key === 'Enter') { resetSizeField(); preview.focus(); } });
    tofu.addEventListener('change', () => { tester.tofu = tofu.checked; applyFont(); });
    preview.addEventListener('input', () => { tester.text = preview.value; });
    applySize();
    await applyFont();
  }

  // ---------- Router ----------
  async function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);
    window.scrollTo(0, 0);
    try {
      if (parts[0] === 'char' && parts[1] && parts[2] === 'add-form') return await viewAddForm(parts[1].toUpperCase());
      if (parts[0] === 'char' && parts[1]) return await viewCharacter(parts[1].toUpperCase());
      if (parts[0] === 'edit') return await viewEditor();
      if (parts[0] === 'test-font') return await viewTestFont();
      if (parts[0] !== 'characters') { location.replace('#/characters'); return; }
      await viewCharacters();
    } catch (err) {
      app.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  }
  window.addEventListener('hashchange', route);
  route();
})();
