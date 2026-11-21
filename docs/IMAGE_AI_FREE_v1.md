# 제미니 이미지 'AI 티 빼기' 가이드 v1

2026-11-21 확정. 제미니 고정방 「콘텐츠 허브 프로젝트 관리」 합의안 B.
실제 생성 검증: `downloads/Gemini_Generated_Image_ebmsorebmsorebms.png` → 대표 이미지로 사용(`downloads/blog_20261121/00_cover_noai_1080x1350.png`).

## 1. 기본 생성 템플릿 (영문 · 그대로 복붙)

```
Candid everyday smartphone snapshot taken on iPhone 15 Pro, 26mm f/1.78 lens,
natural ambient indoor lighting from a side window, subtle Kodak Portra 400 film grain,
slightly off-center casual framing, lived-in messy Korean apartment desk,
authentic natural skin and fabric texture, muted neutral tones, realistic shadows,
unedited raw photo look
```

## 2. 네거티브 목록 (영문)

```
anime, 3d render, digital illustration, Pixar style, cyberpunk, neon glow, holographic,
heavy gradient, plastic smooth skin, airbrushed, dramatic HDR, extreme wide angle, fisheye,
stock photo pose, watermark, embedded text, distorted fingers, extra limbs, studio lighting
```

## 3. 용도별 변형 3종

| 용도 | 기본 템플릿 + 아래 문장 |
|---|---|
| **표지(1:1·4:5)** | `medium shot of an exhausted young Korean man in a plain gray hoodie staring blankly at a laptop screen with faint red glow in a dim room, minimal composition, high contrast shadows` |
| **본문 삽화** | `overhead flat-lay candid shot of a half-empty iced Americano, a crumpled receipt, and a smartphone on a worn wooden cafe table, natural daylight` |
| **정보 카드 배경** | `minimalist macro photograph of textured off-white cotton paper with soft natural window shadow falling diagonally across the surface, clean negative space, muted warm gray tone, subtle grain` |

## 4. 생성 후 3초 자가 판정 5개

1. 문객진 외곽에 **텍스트가 1글자라도 보임** → 폐기
2. 피부·색상이 **플라스틱처럼 매끈**하고 HDR 광택이 과함 → 폐기
3. 광고·보라 네온 조명이나 **과장된 역광** 존재 → 폐기
4. 손가락 개수·구도 접합이 어긋나고 **표정이 일그러짐** → 폐기
5. **좌우 대칭 스튜디오 화보**처럼 생활감이 없음 → 폐기

## 5. 프롬프트에 절대 넣지 않는 것

- 상세 거주지(동·아파트명·건물), 실제 인물 얼굴(실명·지인)
- 등록 상표·로고(성심당·토스·증권사 등)
- 계좌·금액 숫자 텍스트를 **렌더링 지시**하는 문구 (숫자는 흐릿한 빛 덩어리로만)

## 6. 운영 메모

- 생성 이미지에는 제미니 워터마크(우하단 ✦)가 붙는다 → 아래 6%를 잘라 쓰고 4:5(1080×1350)로 리사이즈한다.
- 표지는 `[사진: 대표 이미지 — …]` 자리에 넣고, 캡션은 `▲` 한 줄만.
- 같은 장면을 두 번 뽑지 않는다 — 첫 결과가 §4를 통과하면 그대로 쓰고, 실패할 때만 다시 뽑는다.
