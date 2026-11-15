---
title: "콘텐츠 표준 v2 — 자막·음량·발행 규격 (2026-11-16 확정)"
kind: note
---

# 콘텐츠 표준 v2

> 이 문서는 **코드가 참조하는 단일 출처**입니다. 숫자를 바꾸면 `seeds/render_standard_v2.json`, `seeds/prompt_rules_2026w47.json`, 이 문서 **세 곳을 같이** 고칩니다.
> 상위 문서: `downloads/콘텐츠허브_노트북자동화_설계.md` v2(2026-11-16). 확정 근거는 거기 §1에 있다.

## 1. 왜 바뀌었나 (한 줄씩)

| 문제 | 처방 |
|---|---|
| 검은 레터박스 띠 + 3줄 통짜 자막이 화면 40%를 먹음 | **풀프레임 9:16 + 최대 2줄** |
| Edge-TTS +20% 배속이 억양을 눌러 평탄하게 만듦 | **속도 +0~8%**, 대신 문장을 줄인다 |
| Regular 한 굵기 정적 자막이라 위계가 없음 | ** 흰색 기본 + 줄당 1어절 포인트**, 굵기 대비 |
| 현장음 0 + BGM만 | 현장음 살리고 **덕킹**, -14 LUFS / TP -1.5 |
| 노란 도현체 시안이 "옛날 예능"처럼 보임 | **기각** → Pretendard Bold / 나눔스퀘어라운드 ExtraBold |

## 2. 자막 (1080×1920, ASS/libass, `PlayResX 1080` · `PlayResY 1920` · `WrapStyle: 2`)

| 항목 | 🍺 대전 청년 | 🐱 삐약 김메리 |
|---|---|---|
| 폰트 | **Pretendard Bold** (훅 ExtraBold) | **나눔스퀘어라운드 ExtraBold** |
| 크기 | 본문 68 / 훅 86 | 본문 64 / 훅 82 |
| 기본색 | `&H00FFFFFF` | `&H00F8FFFF` |
| 포인트(1어절) | `&H0018D8FF` (#FFD818) | `&H00B4A5FF` (#FFA5B4) |
| 외곽선 | 4.5 `&H00101010` | 4.0 `&H002B2238` |
| 그림자 | 2.5 `&H80000000` | 2.0 `&H66000000` |
| 본문 위치 | 하단 y1380 (`\an2\pos(540,1380)`) | 상단 y280 (`\an8\pos(540,280)`) |
| 훅 위치 | `\an8\pos(540,260)` 2줄 | 같음. **훅 종료 2.00s 뒤 0.05s 간격** |
| 최대 줄 / 줄당 글자 | 2줄 / 12자 | 2줄 / 11자 |
| 등장 | `{\fad(60,40)\t(0,90,\fscx100\fscy100)}` | `{\fad(80,50)\move(540,295,540,280,0,100)}` |

**안전영역**: 상단 240 · 하단 y≤1420 · 좌 96 · 우 140 (유효 폭 844px).

**폰트 이름(libass 주의)**: libass는 **패밀리명**으로 매칭한다. 스타일의 Fontname은 A=`Pretendard`, B=`NanumSquareRound`로 두고 **Bold=-1**(굵게)을 준다. 파일명(`Pretendard-Bold.otf`, `NanumSquareRoundEB.ttf`)을 Fontname에 쓰면 기본 고딕으로 대체된다. 훅은 `Pretendard ExtraBold` / `NanumSquareRound ExtraBold`를 우선 시도하고 없으면 굵은 지정체로 대체한다.

**하이라이트 표기(그대로 복사)**
```
{\c&H0018D8FF&\fscx108\fscy108}석암생소금구이{\r}\N야장에 생삼겹살
```
- **줄당 1어절**, 반드시 `{\r}`로 닫기. 안 닫으면 줄바꿈을 넘어 아랫줄 전체가 물든다.
- **`\k` 금지**, **단어마다 색을 옮기는 카라오케 금지**(무내레이션 모드에 타이밍 소스가 없다).

## 3. 오디오

```
[현장음] highpass=f=80,lowpass=f=14000,afftdn=nf=-25:tn=1,
        acompressor=threshold=-20dB:ratio=3:attack=10:release=100,
        loudnorm=I=-18:TP=-2:LRA=9, asplit=2
[BGM]   highpass=f=100,loudnorm=I=-24:TP=-3:LRA=7
[덕킹]  sidechaincompress=threshold=0.03:ratio=4:attack=15:release=250:makeup=1
[믹스]  amix=inputs=2:normalize=0:duration=first:dropout_transition=0
[마감]  loudnorm=I=-14:TP=-1.5:LRA=7, alimiter=limit=0.841:level=false:attack=5:release=50
```

- 순서: **라우드노름 → 리미터**. 반대로 하면 피크가 다시 올라간다.
- `asplit=2` 없으면 `Stream specifier matches no streams`로 죽는다.
- `alimiter`에 `level=false` 없으면 -14.0이 **-13.0**으로 어긋난다.
- 목표: **-14.0 LUFS(±0.5)**, **TP ≤ -1.5 dBTP**.

## 4. 영상

- 풀프레임 9:16 강제, **검은 레터박스 금지**.
- 훅 0~2초는 0.8~1.2초 컷 2개, 본문 1.5~2.5초, **3초 이상 정지 금지**.
- 손떨림 `vidstabdetect` → `vidstabtransform smoothing=12 optzoom=1 zoom=3` + `unsharp`.
- 사진 켄번즈 2초에 1.00→1.08배, **컷마다 방향 교체**.
- 속도 램프 진입 0.6×PTS / 강조 1.25×PTS (0.8배 미만 슬로모션은 30fps에서 끊김).
- 출력 1080×1920 · 30fps CFR · CRF 18 · yuv420p · faststart · AAC 192k/48k.

## 5. 모드와 타이밍

| 모드 | 언제 | 타이밍 소스 | cue_gap 검사 |
|---|---|---|---|
| **무내레이션**(기본) | 맛집·술집·일상·메리 | 컷 타임코드 + VAD(발화 시작점만) | **끔** (무자막 호흡 1~2초가 설계) |
| **내레이션** | 정보 전달이 꼭 필요할 때 | WordBoundary(100ns/1e7) → 없으면 문장 경계+VAD | **켬** |

- 내레이션: 20초 5문장 이하, 10초당 2문장 이하, 문장 18~32자, 문장 사이 0.25~0.4초 무음.
- **ASR이 인식한 글자는 자막으로 쓰지 않는다.**
- TTS는 **무료만**: Gemini 3.8 Flash TTS(무료 티어) → Edge-TTS 7.3.1+.

## 6. 발행 전 판정 (기계 6 + 사람 12)

| 기계 규칙 | 판정 |
|---|---|
| `subtitle_out_of_safe_area` | FAIL |
| `subtitle_overlap` | FAIL (메리 훅↔본문 0.05초 규칙 포함) |
| `subtitle_cue_gap` | WARN — **내레이션 모드만** |
| `loudness_out_of_range` | -15~-13 밖 WARN, **TP > -1.0 FAIL** |
| `script_translationese` | WARN (`~에 대해`·`~에 있어서`·`~되어진다`·`가지고 있다`·`~에 의해`) |
| `subtitle_line_limit` | FAIL (줄당 12/11자 초과, 3줄, `\k`) |

사람 검수는 상호·가격 사실, AI 표시, 워터마크, 저작권 음원·폰트(OFL만) — 기계가 못 보는 것만 남긴다.

## 7. 채널과 AI 표시

| 트랙 | 대상 채널 | AI 표시 |
|---|---|---|
| 🍺 대전 청년 | 블로그 · 쇼츠 · 릴스 · 클립 (+피드·스레드 선택) | 유튜브=아니오 / 인스타=AI 공개 / 클립=AI 활용 ON |
| 🐱 삐약 김메리 | 쇼츠 · 릴스 · **클립** (+피드·스레드 선택) | 같음. 블로그만 `SKIPPED` |

- 하루 상한: 채널별 2건(제목·AI 표시·워터마크 확인 후).
- 자사 스토어 유입 시: `※ 직접 기획·판매하는 자사 스토어 상품입니다` 고정.
