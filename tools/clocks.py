"""Арты счётчиков (часов) Надграда: 4/6/8/10/12 секторов, темы «Тушь» и «Смог».

Геометрия — как у исходных clockN.png (в единицах картинки 256×256):
внешний диск r≈121, кольцо секторов 65–107, центр r≈55, первый шов сверху,
секторы идут по часовой стрелке. В центре — цифра размера (Oswald 600).

  python3 tools/clocks.py module      → art/clocks/<тема>/clock<N>-<заполнено>.webp (512 px, все состояния)
  python3 tools/clocks.py png <папка> → <папка>/<тема>/clock<N>.png (256 px, пустые — как исходные)

Нужны Pillow, fontTools и brotli (шрифт берётся из fonts/*.woff2 модуля).
"""
import math, os, sys, tempfile
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZES = (4, 6, 8, 10, 12)
R_OUT, R_SEG_OUT, R_SEG_IN, R_CORE = 121, 107, 65, 55
GAP = 2.0  # половина зазора между секторами (в единицах 256)

THEMES = {
    "tush": dict(
        disk="#ECE7DA", disk_line="#1C1814", disk_line_w=3, dots=(28, 24, 20, 30),
        seg="#F6F2E8", seg_line="#1C1814", seg_line_w=2,
        core="#1C1814", ring="#A64F2B", ring_w=2.5, num="#ECE7DA", glow=False,
        fill="#A64F2B", full="#A63C2C",
    ),
    "smog": dict(
        disk="#14120F", disk_line="#545A4D", disk_line_w=2, dots=None,
        seg="#1C1A16", seg_line="#545A4D", seg_line_w=2,
        core="#100C0A", ring="#E0763A", ring_w=2, num="#E0763A", glow=True,
        fill="#E0763A", full="#E2402F",
    ),
}


def rgba(h, a=255):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


def font_path():
    from fontTools.ttLib import TTFont
    out = os.path.join(tempfile.gettempdir(), "nadgrad-oswald-600.ttf")
    if not os.path.exists(out):
        f = TTFont(os.path.join(ROOT, "fonts", "oswald-latin-600-normal.woff2"))
        f.flavor = None
        f.save(out)
    return out


class Canvas:
    def __init__(self, size):
        self.size = size
        self.S = max(2, round(2048 / size))          # сглаживание: рисуем крупно и уменьшаем
        self.k = size / 256 * self.S                   # единица 256-картинки → пиксели холста
        self.W = round(size * self.S)
        self.C = self.W / 2
        self.font = ImageFont.truetype(font_path(), round(64 * self.k))

    def circle(self, d, r, **kw):
        r *= self.k
        d.ellipse([self.C - r, self.C - r, self.C + r, self.C + r], **kw)

    def sector(self, n, i):
        step = 2 * math.pi / n
        a0, a1 = -math.pi / 2 + i * step, -math.pi / 2 + (i + 1) * step
        pts = []
        for r, frm, to in ((R_SEG_OUT, a0, a1), (R_SEG_IN, a1, a0)):
            da = GAP / r
            s, e = (frm + da, to - da) if frm < to else (frm - da, to + da)
            for j in range(65):
                a = s + (e - s) * j / 64
                pts.append((self.C + r * self.k * math.cos(a), self.C + r * self.k * math.sin(a)))
        return pts

    def w(self, v):
        return max(1, int(round(v * self.k)))

    def blur(self, img, layer, radius):
        img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(radius * self.k)))


def render(theme, n, value, size=256):
    t = THEMES[theme]
    cv = Canvas(size)
    W = cv.W
    full = value >= n
    ring = t["full"] if full else t["ring"]
    num = t["full"] if (full and theme == "smog") else t["num"]
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    cv.circle(d, R_OUT, fill=t["disk"], outline=t["disk_line"], width=cv.w(t["disk_line_w"]))
    if t["dots"]:  # полутоновая точка «Туши»
        layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        step, rr = 4 * cv.k, 0.7 * cv.k
        y, row = 0.0, 0
        while y < W:
            x = step / 2 if row % 2 else 0.0
            while x < W:
                ld.ellipse([x - rr, y - rr, x + rr, y + rr], fill=t["dots"])
                x += step
            y += step
            row += 1
        mask = Image.new("L", (W, W), 0)
        cv.circle(ImageDraw.Draw(mask), R_OUT - 2, fill=255)
        dots = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        dots.paste(layer, (0, 0), mask)
        img.alpha_composite(dots)
        d = ImageDraw.Draw(img)

    fill = t["full"] if full else t["fill"]
    if t["glow"] and value:
        g = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        gd = ImageDraw.Draw(g)
        for i in range(value):
            gd.polygon(cv.sector(n, i), fill=rgba(fill, 170))
        cv.blur(img, g, 6)
        d = ImageDraw.Draw(img)
    for i in range(n):
        d.polygon(cv.sector(n, i), fill=fill if i < value else t["seg"],
                  outline=t["seg_line"], width=cv.w(t["seg_line_w"]))

    if t["glow"]:
        g = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        cv.circle(ImageDraw.Draw(g), R_CORE + 1, outline=rgba(ring, 150), width=cv.w(4))
        cv.blur(img, g, 4)
        d = ImageDraw.Draw(img)
    cv.circle(d, R_CORE, fill=t["core"])
    cv.circle(d, R_CORE, outline=ring, width=cv.w(t["ring_w"] + (1 if full else 0)))

    txt = str(n)
    bb = d.textbbox((0, 0), txt, font=cv.font)
    pos = (cv.C - (bb[2] - bb[0]) / 2 - bb[0], cv.C - (bb[3] - bb[1]) / 2 - bb[1])
    if t["glow"]:
        g = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        ImageDraw.Draw(g).text(pos, txt, font=cv.font, fill=rgba(num, 200))
        cv.blur(img, g, 5)
        d = ImageDraw.Draw(img)
    d.text(pos, txt, font=cv.font, fill=num)
    return img.resize((size, size), Image.LANCZOS)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "module"
    if mode == "module":
        for theme in THEMES:
            out = os.path.join(ROOT, "art", "clocks", theme)
            os.makedirs(out, exist_ok=True)
            for n in SIZES:
                for v in range(n + 1):
                    render(theme, n, v, 512).save(os.path.join(out, f"clock{n}-{v}.webp"), quality=92, method=6)
        print("ok: art/clocks")
    elif mode == "png":
        dest = sys.argv[2]
        for theme in THEMES:
            os.makedirs(os.path.join(dest, theme), exist_ok=True)
            for n in SIZES:
                render(theme, n, 0, 256).save(os.path.join(dest, theme, f"clock{n}.png"), optimize=True)
        print("ok:", dest)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
