"""
Print-ready signup flyer for Gotchu: a real, scannable QR to gotchu.velroi.com.

Written as a bare PDF rather than pulled through a rendering stack because the
one thing that must not go wrong is the QR, and a hand-built content stream
lets the modules be drawn as vector rectangles - sharp at any size, at any
printer's resolution, with no resampling to soften the edges a scanner reads.

Fonts are the PDF base-14 (Helvetica), so nothing is embedded and the file
opens identically everywhere.

    python3 tools/make_signup_flyer.py [out.pdf]
"""
import sys
import zlib

import segno

URL = "https://gotchu.velroi.com"
PAGE_W, PAGE_H = 612.0, 792.0  # US Letter, in points

# The product's own colours, so the flyer and the site look like one thing.
INK = (0.078, 0.125, 0.086)      # #142016 near-black green
GREEN = (0.122, 0.361, 0.227)    # #1f5c3a
MUTED = (0.42, 0.45, 0.43)


def rgb(c):
    return f"{c[0]:.3f} {c[1]:.3f} {c[2]:.3f}"


def esc(text):
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def text(x, y, size, font, colour, body, spacing=None):
    """One line of text, positioned from its baseline."""
    out = [f"BT /{font} {size:.2f} Tf {rgb(colour)} rg"]
    if spacing:
        out.append(f"{spacing:.2f} Tc")
    out.append(f"1 0 0 1 {x:.2f} {y:.2f} Tm ({esc(body)}) Tj")
    if spacing:
        out.append("0 Tc")
    out.append("ET")
    return " ".join(out)


def centred(y, size, font, colour, body, width_factor, spacing=0.0):
    """Helvetica has no metrics here, so width is approximated per weight."""
    w = len(body) * size * width_factor + max(0, len(body) - 1) * spacing
    return text((PAGE_W - w) / 2, y, size, font, colour, body, spacing or None)


def qr_modules(url):
    """The QR as a list of (row, col) dark modules, plus its size."""
    # Error correction Q (~25%): survives a scuffed, taped-up flyer without
    # making the modules so small that a phone struggles across a table.
    qr = segno.make(url, error="q")
    matrix = [[bool(m) for m in row] for row in qr.matrix]
    return matrix, len(matrix)


def build():
    matrix, n = qr_modules(URL)

    ops = []

    # Ground: white page, with a thin rule under the wordmark.
    ops.append(f"1 1 1 rg 0 0 {PAGE_W} {PAGE_H} re f")

    ops.append(centred(702, 54, "F2", INK, "Gotchu", 0.60))
    ops.append(centred(664, 15.5, "F1", GREEN, "Campus tasks, handled over text.", 0.50))

    # The QR, quiet zone included. Four modules of white on every side is the
    # spec's minimum and the difference between scanning instantly and not.
    quiet = 4
    box = 322.0
    module = box / (n + quiet * 2)
    qr_x = (PAGE_W - box) / 2
    qr_y = 296.0

    ops.append(f"1 1 1 rg {qr_x:.2f} {qr_y:.2f} {box:.2f} {box:.2f} re f")
    ops.append(f"{rgb(INK)} rg")
    for r, row in enumerate(matrix):
        # Runs of adjacent dark modules become one rectangle: fewer, larger
        # path objects, and no hairline seams between neighbours where a
        # renderer rounds two edges to the same device pixel.
        c = 0
        while c < n:
            if not row[c]:
                c += 1
                continue
            start = c
            while c < n and row[c]:
                c += 1
            x = qr_x + (quiet + start) * module
            # PDF's origin is bottom-left; QR rows count from the top.
            y = qr_y + box - (quiet + r + 1) * module
            ops.append(f"{x:.3f} {y:.3f} {(c - start) * module:.3f} {module:.3f} re f")

    ops.append(centred(258, 13, "F1", MUTED, "S C A N   T O   J O I N", 0.52, spacing=0.6))

    # The URL, for anyone who would rather type it than point a camera.
    ops.append(centred(214, 27, "F2", GREEN, "gotchu.velroi.com", 0.58))

    ops.append(f"{rgb(MUTED)} rg 156 190 {PAGE_W - 312:.2f} 0.8 re f")

    ops.append(centred(160, 12.5, "F1", INK, "Ask for something. Someone nearby gets it done.", 0.49))
    ops.append(centred(140, 12.5, "F1", INK, "Agree a price over text. Get paid in railcoins.", 0.49))

    ops.append(centred(96, 10.5, "F1", MUTED, "CMU students only - sign up with your @andrew.cmu.edu address.", 0.47))
    ops.append(centred(78, 10.5, "F1", MUTED, "Railcoins are campus credit with no cash value.", 0.47))

    stream = zlib.compress(" ".join(ops).encode("latin-1"))

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W:g} {PAGE_H:g}] "
            f"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>"
        ).encode("latin-1"),
        b"<< /Length " + str(len(stream)).encode() + b" /Filter /FlateDecode >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ]

    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_at = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n".encode()
    pdf += b"0000000000 65535 f \n"
    for off in offsets:
        pdf += f"{off:010d} 00000 n \n".encode()
    pdf += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n"
    ).encode()

    return bytes(pdf), n


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "gotchu-signup.pdf"
    data, modules = build()
    with open(out, "wb") as fh:
        fh.write(data)
    print(f"wrote {out} ({len(data):,} bytes), QR {modules}x{modules} modules -> {URL}")
