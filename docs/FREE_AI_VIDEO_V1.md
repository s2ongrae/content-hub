# 무료 AI 클립 v1 — 구글 Flow · 허깅페이스 (2026-11-21)

사용자가 오늘 공유한 무료 AI 영상 인사이트(Hugging Face 공식 MCP · Google Flow 50크레딧 · 고양이 레퍼런스
동작 프롬프트 · ffmpeg-skill 토큰 절약)를 콘텐츠 허브와 집 노트북에 붙인 결과물의 계약 문서다.

- 화면: `js/aiClip.js` — 제작 스튜디오 영상(`#/create/video`)의 **🪄 AI 클립** 패널
- 표(원본): `seeds/ai_video_free.json` — 화면·노트북 도구·시험이 같은 파일을 본다
- 노트북: `hub-agent/notebook-agent/lib/aiclip.js` + `tools/aiclip.js` (클로드 토큰 0으로 Space 직접 호출)
- 시험: `node test/run.js` 의 `[무료 AI 클립]` 블록

## 1. 3층 경계 (확정)

| 층 | 누가 | 어떻게 | 토큰 |
|---|---|---|---|
| 기획·프롬프트 | 허브 `#/create/video` | 영어 프롬프트 생성·크레딧 계산·복사 | 0 |
| 고화질·춤 원천 | 사람 + 구글 Flow | 브라우저에서 손으로, 무자막 클립만 | 0 (월 250cr) |
| 반복 생산 | 집 노트북 | 허깅페이스 Space 의 `/gradio_api` 직접 호출 | 0 (GPU 하루 5분) |
| 실험 | 클로드 코드 | `hf-mcp-server` MCP 로 Space 탐색·프롬프트 튜닝 | 클로드 토큰 |

**한 줄 규칙**: 반복 생산은 노트북이 `/gradio_api` 를 직접 부르고, MCP 는 새 Space·프롬프트 실험에만 쓴다.
Flow 는 API 가 없으므로 자동화 대상이 아니다(사람이 뽑는다).

## 2. 무료 한도 (2026-11-21 공식 문서·API 실측)

| 자원 | 무료 | 제약 |
|---|---|---|
| Google Flow | 이 계정은 **PLUS 월 250크레딧**(12/12 12:26 초기화) · 무료 플랜은 하루 50 (첫 생성이 리셋 시점, 이월 없음) | Omni Flash 1.2: 360p 1cr/초 · 720p 3cr/초, 3~10초, 9:16·16:9. 15초·업스케일·연장은 구독자. **KST 23~02시 무료 영상 생성 차단**. **한국 계정은 가시 워터마크 자동** |
| 허깅페이스 ZeroGPU | 하루 5분 (비로그인 2분) | 첫 GPU 사용 후 24시간 리셋. 2초 애니메이션 ≈ 55초 요청(실측) → 하루 2편 |

워터마크는 끄는 설정이 없다. 첫 클립을 픽셀 단위로 재서 위치를 확정했다(§6).

## 3. 언제 무엇을 쓰나

| 만들 것 | 도구 | 값 |
|---|---|---|
| 묘한살림 상품 숏폼의 열기·사용 장면 | Flow 720p 5초 2컷 | 30cr |
| 대전 일상 B롤 | Flow 720p 4~5초 1컷 | 12~15cr |
| 사진 1장을 살짝 움직이기 | 허깅페이스 `wan-i2v` 3.5초 | GPU 2분 안팎 |
| 메리가 추는 2초 클립 | 허깅페이스 `wan-animate` Pose Retarget | GPU 3분 안팎 |
| 실패 재시도 | Flow 360p 4초 | 4cr (남는 8cr) |

## 4. 프롬프트 계약

- 모든 프롬프트 끝에 **무자막 문구**(`No text, no captions, no letters, no watermark...`)가 붙는다.
- 장면 프리셋 3종: `product_scene`(상품) · `daily_broll`(대전 일상) · `mary_action`(메리 동작).
- 메리는 **4단**: `[1. SCENE]` `[2. ROLE]`(사진은 정체성, 영상은 동작) `[3. IDENTITY LOCK]` `[4. KEEP]`(해부 가드).
- 네거티브: text·watermark·extra limbs·deformed paws·morphing 등 고정 문자열.
- 다시 뽑기 판정 5개: 글자 1개라도 보이면 버림 / 고양이 다리·발가락 / 컷마다 무늬·눈색 변화 / 0.3초 미만 컷 / 템플릿 자막 자리 침범.

## 5. 허깅페이스 Space 실측 (2026-11-21 RUNNING)

| Space | 엔드포인트 | 인자 순서 |
|---|---|---|
| `zerogpu-aoti/wan2-2-fp8da-aoti-faster` (좋아요 3.9k) | `/generate_video` | input_image · prompt · steps(6) · negative_prompt · duration_seconds(3.5) · guidance_scale(1) · guidance_scale_2(1) · seed(42) · randomize_seed |
| `alexnasa/Wan2.2-Animate-ZEROGPU` (377) | `/animate_scene` | input_video · max_duration_s(2) · edited_frame · rc_str · resolution_choice |

`rc_str` = `Pose Retarget`(동작만 입히기) / `Character Swap`(사람 바꾸기),
`resolution_choice` = `Low Res` / `Medium Res`. **`480p` 같은 값은 없다**(Space app.py 의 radio choices 그대로).

## 6. 완제품에 넣는 규격

**첫 클립 실측(2026-11-21, 720×1280 6초)** — 우하단 Gemini 반짝이 **48×48px**, x 576~623 · y 1136~1183(오른쪽·아래 여백 96px), 144프레임 전부 같은 자리.
**`crop=iw/1.18` 은 못 지운다** — 1080 출력에 84×81px로 남아 오히려 더 눈에 띈다(1.18배는 폐기).

```
# 기본 — delogo(프레임 전체 유지, 워터마크 자리만 주변 픽셀로 메움 · 업스케일 1.5배만)
delogo=x=iw*0.7944:y=ih*0.8844:w=iw*0.0778:h=ih*0.0438,
scale=1080:1920:flags=lanczos:force_original_aspect_ratio=increase,crop=1080:1920,
unsharp=3:3:0.5:3:3:0.0,fps=30

# 대안 — 하단 크롭(아래 160px·좌우 45px 제거 · 실효 줌 1.143배). 배경에 글자·무늬가 있어 delogo 얼룩이 보일 때
crop=iw*0.875:ih*0.875:iw*0.0625:0,
scale=1080:1920:flags=lanczos:force_original_aspect_ratio=increase,crop=1080:1920,
unsharp=3:3:0.5:3:3:0.0,fps=30
```

- 좌표는 **프레임 대비 비율**로 적어 360p·720p 모두 같은 식이 먹는다(720p 절대값 x572 y1132 56×56, 4px 여유).
- 노트북 도구는 `--crop-mode delogo|bottom-crop` 로 부를 수 있고 요약에 `crop_mode` 를 남긴다(`hub-agent/notebook-agent/lib/aiclip.js`).
- 삽입 1~2.5초. **네이버 클립은 완제품의 20% 이하**(AI 비율 0.5 규칙), 유튜브는 30% 이하.
- 소리는 버린다(`-an`). 내레이션·현장음·자막은 `content_render`(ffmpeg, 토큰 0)가 붙인다.
- 오더 큐는 4,000자 제한 — 프롬프트 전문을 싣지 않고 `ai_clips[].name/seconds/source/crop_mode` 만 싣는다.
- 워터마크를 지워도 표시 의무는 그대로다: 파일에 SynthID(비가시)가 남고, 업로드 화면 'AI 활용' 체크·설명란 한 줄은 지킨다.

## 7. 표시 의무

| 어디 | 무엇 |
|---|---|
| 네이버 클립 | AI 생성 비율 50% 미만 유지(우리는 20% 상한) + 업로드 화면 'AI 활용' 체크 |
| 유튜브 쇼츠 | Studio 의 '변경된 콘텐츠' 표시. 설명란 첫 줄에 "일부 컷은 AI 생성" 한 줄 |
| 영상 자막 | 템플릿 자막에는 'AI' 를 쓰지 않는다(자막은 말만 담는다). 표시는 업로드 화면·설명란에서 |
| 카드 기록 | `payload.ai_clips` 에 몇 초 들어갔는지 남긴다(성과분석에서 AI 컷 유무로 나눠 본다) |

## 8. 하지 않는 것

- **피크(KST 23~02시) 자동 재시도** — 실패하면 `DEFERRED` 로 두고 사람에게 알린다.
- 정적 호스팅에서 Flow 를 자동 조작하는 것 — Flow 는 로그인·브라우저 세션 기반이고 이용약관상 자동화 대상이 아니다.
- 한 번에 긴 영상 — 무료 한도는 짧은 컷 전용이다. 긴 영상은 지금처럼 촬영본으로 만든다.
- AI 클립에 소리·자막을 직접 넣기 — 한글이 깨진다. 자막·내레이션은 렌더가 붙인다.
