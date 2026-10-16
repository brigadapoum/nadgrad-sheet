"""Кольца Надграда для «динамического кольца токена» Foundry (Тушь и Смог).

Спрайт-лист как у колец ядра: на каждый размер — фон (bkg) и кольцо (ring).
Доли — от половины стороны кадра:
  0 … 0.667  — место под картинку (Foundry сам вписывает её в середину),
  фон заливает круг до 0.68 (виден сквозь прозрачные места картинки),
  0.667 … 0.80 — кольцо (тушь / копоть),
  0.715 … 0.745 — светлая полоса, её Foundry красит «цветом кольца» (по умолчанию — ржавчина / неон),
  у Смога снаружи — мягкое оранжевое свечение до 0.86.
Запуск: python3 tools/rings.py  → art/rings/nadgrad-<тема>.webp + .json
"""
import json
import math
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "art", "rings")
SS = 4  # суперсэмплинг — ровные края

# (имя кадра, сторона, x фона, x кольца, gridTarget) — раскладка как у колец ядра
FRAMES = [("gnt", 2048, 0, 2048, 4), ("hge", 2048, 0, 2048, 3), ("lrg", 1024, 4096, 5120, 2),
          ("med", 512, 6144, 6656, 1), ("tny", 256, 7168, 7424, 0.5)]
SHEET = (7680, 2048)

R_SUBJ, R_BKG, R_OUT = 0.667, 0.68, 0.80
BAND = (0.715, 0.745)

THEMES = {
    "tush": {"label": "Тушь", "ring": (28, 24, 20), "bkg": (28, 24, 20), "color": "#A64F2B", "glow": None},
    "smog": {"label": "Смог", "ring": (16, 12, 10), "bkg": (20, 18, 15), "color": "#E0763A", "glow": (224, 118, 58)},
}


def disk(size, r_out, r_in, rgba):
    """Кольцо (или круг при r_in=0) радиусами в долях половины стороны."""
    n = size * SS
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = n / 2
    d.ellipse([c - r_out * c, c - r_out * c, c + r_out * c, c + r_out * c], fill=rgba)
    if r_in > 0:
        d.ellipse([c - r_in * c, c - r_in * c, c + r_in * c, c + r_in * c], fill=(0, 0, 0, 0))
    return im.resize((size, size), Image.LANCZOS)


def ring_frame(size, t):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if t["glow"]:
        g = disk(size, 0.84, R_OUT - 0.01, t["glow"] + (170,))
        g = g.filter(ImageFilter.GaussianBlur(radius=size * 0.012))
        im = Image.alpha_composite(im, g)
    im = Image.alpha_composite(im, disk(size, R_OUT, R_SUBJ, t["ring"] + (255,)))
    # светлая полоса — её перекрашивает «цвет кольца»
    im = Image.alpha_composite(im, disk(size, BAND[1], BAND[0], (235, 235, 235, 255)))
    return im


def bkg_frame(size, t):
    return disk(size, R_BKG, 0, t["bkg"] + (255,))


def frame_json(x, size, extra=None):
    f = {"frame": {"x": x, "y": 0, "w": size, "h": size}, "rotated": False, "trimmed": False,
         "spriteSourceSize": {"x": 0, "y": 0, "w": size, "h": size}, "sourceSize": {"w": size, "h": size},
         "anchor": {"x": 0.5, "y": 0.5}}
    if extra:
        f.update(extra)
    return f


def build(theme_id):
    t = THEMES[theme_id]
    sheet = Image.new("RGBA", SHEET, (0, 0, 0, 0))
    frames = {}
    done = set()
    for name, size, xb, xr, grid in FRAMES:
        if (xb, size) not in done:
            sheet.paste(bkg_frame(size, t), (xb, 0))
            sheet.paste(ring_frame(size, t), (xr, 0))
            done.add((xb, size))
        frames[f"{name}-ring-bkg"] = frame_json(xb, size)
        frames[f"{name}-ring"] = frame_json(xr, size, {"gridTarget": grid, "ringThickness": round(R_OUT - R_SUBJ, 3)})
    img = f"nadgrad-{theme_id}.webp"
    sheet.save(os.path.join(OUT, img), "WEBP", lossless=True, method=6)
    data = {"config": {"defaultColorBand": {"startRadius": BAND[0], "endRadius": BAND[1]}, "defaultRingColor": t["color"]},
            "frames": frames,
            "meta": {"version": "1.1", "image": img, "format": "RGBA8888", "size": {"w": SHEET[0], "h": SHEET[1]}, "scale": "1"}}
    with open(os.path.join(OUT, f"nadgrad-{theme_id}.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for tid in THEMES:
        build(tid)
    print("ok", sorted(os.listdir(OUT)))
