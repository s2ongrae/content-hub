#!/usr/bin/env python3
"""content-hub 홈 화면 앱 아이콘 생성기.

남색 그라데이션 배경 + 주황 'C' 모노그램 + 채널 4점(블로그·쇼츠·릴스·클립).
1024px 로 그린 뒤 LANCZOS 로 줄여 192/512 를 만든다. (Pillow 만 사용)

    python3 tools/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / 'icons'
SIZE = 1024
SS = 2  # 슈퍼샘플 배수

NAVY_TOP = (26, 42, 74)
NAVY_BOTTOM = (9, 14, 26)
ORANGE_TOP = (255, 168, 74)
ORANGE_BOTTOM = (244, 96, 18)
CREAM = (255, 244, 226)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vertical_gradient(size, top, bottom):
    img = Image.new('RGB', (1, size), top)
    px = img.load()
    for y in range(size):
        px[0, y] = lerp(top, bottom, y / max(1, size - 1))
    return img.resize((size, size))


def font(size):
    for path in (
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def build() -> Image.Image:
    n = SIZE * SS
    img = vertical_gradient(n, NAVY_TOP, NAVY_BOTTOM).convert('RGBA')
    d = ImageDraw.Draw(img)

    # 위쪽 파란 글로우 (포털 아이콘과 같은 계열)
    glow = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-n * 0.25, -n * 0.55, n * 1.25, n * 0.55], fill=(70, 120, 210, 70))
    img.alpha_composite(glow.filter(__import__('PIL.ImageFilter', fromlist=['ImageFilter']).GaussianBlur(n // 12)))

    # 바깥 얇은 링 (홈 화면에서 잘리지 않게 안전 반경 안쪽)
    ring = n * 0.735
    d.ellipse([n / 2 - ring, n / 2 - ring, n / 2 + ring, n / 2 + ring],
              outline=(240, 150, 60, 120), width=max(2, n // 200))

    # 주황 'C' 모노그램 — 위→아래 그라데이션은 마스크로 입힌다
    f = font(int(n * 0.60))
    txt = 'C'
    bbox = d.textbbox((0, 0), txt, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pos = (n / 2 - tw / 2 - bbox[0], n / 2 - th / 2 - bbox[1] - n * 0.015)

    mask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(mask).text(pos, txt, font=f, fill=255, stroke_width=int(n * 0.016), stroke_fill=255)
    grad = vertical_gradient(n, ORANGE_TOP, ORANGE_BOTTOM).convert('RGBA')
    img.paste(grad, (0, 0), mask)

    # 그림자 한 겹 (얇게) — 작은 크기에서도 도형이 떠 보이게
    shadow = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((pos[0], pos[1] + n * 0.012), txt, font=f, fill=(0, 0, 0, 110))
    img.alpha_composite(shadow.filter(__import__('PIL.ImageFilter', fromlist=['ImageFilter']).GaussianBlur(n // 90)))

    # 채널 4점: 블로그(위) · 쇼츠(오른쪽) · 릴스(아래) · 클립(왼쪽)
    r = n * 0.034
    cx, cy = n / 2, n / 2
    orbit = n * 0.345
    for dx, dy in ((0, -orbit), (orbit, 0), (0, orbit), (-orbit, 0)):
        d.ellipse([cx + dx - r, cy + dy - r, cx + dx + r, cy + dy + r], fill=CREAM)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    base = build()
    base.resize((512, 512), Image.LANCZOS).save(OUT / 'icon-512.png')
    base.resize((192, 192), Image.LANCZOS).save(OUT / 'icon-192.png')
    print('wrote', OUT / 'icon-512.png', OUT / 'icon-192.png')


if __name__ == '__main__':
    main()
