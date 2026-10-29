"""Builds public/tofu-fallback.ttf: a tiny font that draws every character as a
tofu box (a rectangle with an X, like public/tofu.png).

The Test font page lists it after the font being tested, so characters the
tested font lacks show up as boxes instead of silently falling back to a
system font.

Run with fontTools installed:  python tools/make-tofu-font.py
"""
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

UPM = 1000
ADVANCE = 600
LEFT, RIGHT, BOTTOM, TOP = 80, 520, -120, 760  # box edges
STROKE = 50


def rect(pen, x0, y0, x1, y1, clockwise=True):
    pts = [(x0, y0), (x0, y1), (x1, y1), (x1, y0)]
    if not clockwise:
        pts.reverse()
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()


def bar(pen, a, b, half):
    """Clockwise quadrilateral of width 2*half from point a to point b."""
    (ax, ay), (bx, by) = a, b
    dx, dy = bx - ax, by - ay
    length = (dx * dx + dy * dy) ** 0.5
    nx, ny = -dy / length * half, dx / length * half
    pts = [(ax + nx, ay + ny), (bx + nx, by + ny), (bx - nx, by - ny), (ax - nx, ay - ny)]
    # Make the winding match the outer rectangle (clockwise in font coordinates).
    area = sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(pts, pts[1:] + pts[:1]))
    if area > 0:
        pts.reverse()
    pen.moveTo(tuple(round(v) for v in pts[0]))
    for p in pts[1:]:
        pen.lineTo(tuple(round(v) for v in p))
    pen.closePath()


def tofu_glyph():
    pen = TTGlyphPen(None)
    rect(pen, LEFT, BOTTOM, RIGHT, TOP)  # outer edge
    rect(pen, LEFT + STROKE, BOTTOM + STROKE, RIGHT - STROKE, TOP - STROKE, clockwise=False)  # hole
    inset = STROKE
    bar(pen, (LEFT + inset, BOTTOM + inset), (RIGHT - inset, TOP - inset), STROKE / 2)
    bar(pen, (LEFT + inset, TOP - inset), (RIGHT - inset, BOTTOM + inset), STROKE / 2)
    return pen.glyph()


def main():
    out = Path(__file__).resolve().parent.parent / "public" / "tofu-fallback.ttf"
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder([".notdef", "tofu"])
    fb.setupCharacterMap({0x41: "tofu"})  # replaced below
    glyph = tofu_glyph()
    fb.setupGlyf({".notdef": glyph, "tofu": glyph})
    fb.setupHorizontalMetrics({".notdef": (ADVANCE, LEFT), "tofu": (ADVANCE, LEFT)})
    fb.setupHorizontalHeader(ascent=900, descent=-250)
    fb.setupNameTable({"familyName": "Resh Tofu", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=900, sTypoDescender=-250, usWinAscent=900, usWinDescent=250)
    fb.setupPost()

    # Format 13 maps whole ranges to one glyph, so covering every code point
    # costs a few bytes. Skip the C0/C1 controls so newlines and tabs behave.
    sub = CmapSubtable.newSubtable(13)
    sub.platformID, sub.platEncID, sub.language = 3, 10, 0
    ranges = [(0x20, 0x7E), (0xA0, 0x10FFFF)]
    sub.cmap = {cp: "tofu" for start, end in ranges for cp in range(start, end + 1)}
    fb.font["cmap"].tables = [sub]

    fb.save(str(out))
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
