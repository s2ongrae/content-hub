# 제작·생성 스튜디오 v1 (2026-11-21)

확정 설계: 세션 기록 `downloads/콘텐츠허브_제작생성스튜디오_개편설계_20261120.md`(레이 × 제미니, 2026-11-20).
이 문서는 **구현된 계약**만 짧게 적는다. 코드가 바뀌면 여기부터 고친다.

> 2026-11-21 추가: 블로그 결과 화면에 **톤·2줄 호흡** 패널이 붙었다 — 수치·분할·금지어는 `docs/BLOG_TONE_v5.md`, 이미지 프롬프트는 `docs/IMAGE_AI_FREE_v1.md` 가 기준이다.

## 1. 화면 구조

| 라우트 | 화면 | 코드 |
|---|---|---|
| `#/create` | 포맷 선택(3장) + 최근 작업 3개 | `js/createStudio.js` → `renderChooser` |
| `#/create/blog` | 블로그 글 — 재료 → 키트 / AI 초안 | `renderFormat('blog')` |
| `#/create/video` | 영상 — 재료 → 대본 / 사진 렌더 + 기존 7단계 마운트 | `renderFormat('video')` |
| `#/create/feed` | 인스타 피드 — 4:5 카드 6장 | `renderFormat('feed')` |
| `#/create/legacy` | 예전 채널 조립기(지우지 않음) | `js/create-view.js` |
| 카드 상세 `제작` 탭 | 기존 `js/produceView.js`(영상 7단계) — 스튜디오 영상 안에도 마운트 | `produceSection` |

- `js/studioView.js` 는 **연재 탭의 숏폼 공방**(훅 채점·EDL·댓글 분류)이 이미 쓰고 있다. 설계의 'studioView.js(가칭)' 자리를 `createStudio.js` 로 잡았다(덮어쓰면 공방이 사라진다).
- 트랙 B(삐약 김메리)는 **영상만**: 블로그·피드 라우트를 열면 `#/create/video` 로 옮기고 토스트 `반려동물 채널은 영상만 지원해 영상 스튜디오로 이동했어요`.

## 2. 재료 4칸

| 칸 | 저장 | 규칙 |
|---|---|---|
| 사진 | `payload.studio.media[]` + 드라이브 `ContentHubOS_Uploads/<content_id>/` | jpg·jpeg·png·webp · 장당 10MB · 카드당 25장 · 올리기 전 장변 2048px·JPEG 0.85 (`js/uploadVideo.js preparePhoto`) |
| 장소 | `payload.studio.place` | 링크는 저장만(크롤링 없음) |
| 내용 | `payload.studio.content` | 메모는 **원문**(AI 가 고치지 않음) |
| 컨셉 | `payload.studio.concept` | 유형 3 · 톤 3 · 한 줄 지시 |

- 기기에는 브랜드별 `localStorage('contenthub.studio.v1.<brand>')` 로 메타만 남긴다(Blob 은 못 넣는다 — 새로고침하면 미리보기만 사라지고 '올리기 필요'로 표시).
- 미리보기는 **로컬 ObjectURL** 만. 드라이브는 비공개라 `<img src>` 로 못 쓴다(CSP `img-src 'self' data: blob:`).

## 3. 사진 자동 배치

- 역할 추정: 파일 이름 → `마무리(영수증·계산)` → `메뉴판` → `분위기(내부·테이블)` → `외관(입구·간판)` → `음식`.
- 순서: 외관 → 메뉴판 → 음식 → 분위기 → 마무리. 사용자가 `‹ ›` 로 만진 순서는 유지.
- 장수: 블로그 22 · 영상 15초 5 / 30초 8 / 60초 15 · 피드 6. 모자라면 가진 만큼(영상은 최소 5장).
- 캡션: **빈 칸만** 15~25자 사실 묘사. 직접 쓴 캡션은 덮지 않는다(`captions[].auto === false`).

## 4. 오더 계약

### 4.1 `content_draft` (LOW · 자동승인)
```
{ type:'content_draft', content_id, brand, format:'blog'|'video', concept:{kind,tone,hint},
  facts:{…}, memo_sha256, blocks:[{id,origin:'USER',text,sha256}], media:[{name,role}],
  ask:{titles:1..3,bridge,captions,outro}, payload_source:'inline'|'drive', length_sec }
```
- 허브 검증(`hubDraftPayload_`): **허용 외 필드는 `ERR_VALIDATION_FAILED`**, 블록 해시 재계산, `memo_sha256` 재계산, 사진 25장, 블록 60문단.
- 직렬화가 **3,500자**를 넘으면 블록·팩트를 빼고 `payload_source:'drive'` — 워커가 `get_content_detail` 로 카드 `studio.content` 를 읽는다.
- 결과: 노트북이 `update_content` + **`patch_mode:'deep'`** 으로 `studio.formats.<format>.draft` 한 갈래만 쓴다. `ERR_VERSION_CONFLICT` 면 최신 버전을 다시 읽어 같은 하위 키만 재저장(3회).
- 원문 3중 잠금: ① 허브 해시 검증 ② 노트북이 USER 블록 사이에만 삽입 ③ 저장 전 재해시 불일치면 **폐기 후 1회 재시도**(두 번 다 다르면 아무것도 저장하지 않는다).

### 4.2 `content_render` + `images[]` (HIGH 유지)
- `images`: 사진 1~25장(영상 `inputs` 1~8개와 별개). 사진만이면 최소 5장.
- `photo_seconds`(1~15초) · `xfade`(0~2초) · `length_sec`(5~600초, 사진만일 때) 선택.
- 노트북(`lib/kenburns.js`): 장당 `max(3.0초, 그 장의 자막·내레이션 큐 길이 + 0.3초)` — **고정 3.5초 금지**(TTS 잘림). 전환 0.3초 xfade, 1080×1920·30fps, 줌 1.00↔1.08 교대.
- 사진 클립은 **맨 뒤**에 붙인다 — `cuts` 의 파일 번호(`inputs` 순서)를 흔들지 않게.

## 5. 카드 payload (시트 37칸 불변)
```
studio
├ meta {format, updated_at}
├ place {name, naver_url, kakao_url}
├ concept {kind, tone, hint}
├ content {memo, hours, closed_days, price_menu, parking, wait_time, tel, address, region_dong, category}
├ media [{name, kind:'photo', role, order, caption}]
└ formats
  ├ blog {draft, kit, saved_at}
  ├ video {…기존 7단계 상태, length_sec, draft}
  └ feed {…}
production {captions, narration, script}   ← 완제품 렌더가 읽는 자막·내레이션
```
- **읽기**: `studio.formats.video` → 없으면 구 구조(`studio.steps`…) 폴백(`readStudio`).
- **쓰기**: 언제나 `studio.formats.video`(`mergeFormat`). 구 루트 키는 지우지 않는다 → 문제 시 읽기 우선순위 한 줄로 원복.
- `produceView` 도 같은 규칙으로 저장한다(동시 수정 시 최신 studio 를 다시 읽어 video 하위 키만 교체).

## 6. 검증

```
node gas/test/run.js        # GAS: 업로드(사진)·렌더 payload(images)·content_draft·deep 병합
node test/run.js            # 프론트: studioLogic/studioCanvas 계산 + 세 포맷 화면 스모크 + CSP·탭 이름
cd ../hub-agent/notebook-agent && node test/run.js   # 워커: draft(3중 잠금·버전 병합)·kenburns·렌더 회귀
cd ../hub-agent && node gas/test/run.js              # 큐: content_draft LOW
```

## 7. 🎵 뮤직비디오 모드 (Phase 1, 2026-11-21)

`#/create/video` 안의 토글 하나 — 새 라우트를 만들지 않는다. 일반 영상 화면은 그대로 두고 MV 모드에서만 입력이 바뀐다.

| 칸 | 입력 | 기본값 |
|---|---|---|
| ② 음원 | `[내 파일]`(mp3·m4a 25MB · wav 30MB, `bgm_put` 2MB 조각) / `[보관함에서 고르기]`(무료 BGM·내 파일, `bgm_list`) | 내 파일 |
| ③ 가사 | 여러 줄 붙여넣기 / 가사 없음(연주곡) | 내가 쓴 가사 |
| ④ 분위기 | 신나는 팝 · 감성 발라드 · 코믹·병맛 · 밴드·락 (기록·보고용, 곡 생성은 Phase 3) | 신나는 팝 |
| ⑤ 길이·컷 밀도 | 15·30·60초·곡 끝까지 × 2박·1마디·2마디 | 곡 끝까지 · 1마디 |
| 이펙트 | 다운비트 번쩍임 on/off | on |

- **노래가 목소리라서 내레이션(TTS)·자막 레이어를 쓰지 않는다** — 가사 카라오케 레이어만.
- 저장: `studio.formats.video.mv`(일반 템플릿과 격리). 카드가 없으면 다른 포맷과 같이 `create_content` 로 만든다.
- 곡 파일은 큐로 오지 않는다 — `_bgm` 보관함에 올리고 **이름만** 오더에 싣는다. 노트북은 `bgm_fetch` 로 받는다.
- 유료 API 없음(Phase 1). 보컬 생성(ACE-Step 등)은 화면 안내대로 사용자가 뽑아 mp3 로 올린다.

### 오더 계약 (`content_render`, `mode:'mv'`)
```json
{ "content_id": "...", "brand": "daejeon_youth", "profile": "captions", "mode": "mv",
  "images": ["사진01.jpg", "…"],
  "mv": { "audio": "내 노래.mp3", "density": "normal_4beat", "bpm_hint": 0,
          "lyrics": "한 줄\n두 줄", "effects": "pulse", "mood": "pop",
          "length_sec": 0, "lyric_mode": "mine", "lines": 2 } }
```
- `density` ∈ `fast_2beat | normal_4beat | slow_1bar` · `effects` ∈ `pulse | none` · `mood` ∈ `pop | ballad | comic | rock`.
- `length_sec` 0 = 곡 끝까지. `lyric_mode:'none'` 이면 가사를 버린다(연주곡).
- 사진은 3~25장. Phase 1 은 사진만(영상 입력은 다음 단계).
- 가사가 2,000자(또는 payload 3,500자)를 넘으면 `lyrics` 를 빼고 `payload_source:'drive'` 로 보낸다 — 노트북이 카드의 `studio.formats.video.mv` 에서 읽는다.
- GAS 는 `isRealRenderOrder_` 가 `mode` 만 있어도 렌더 경로로 보내 검증에서 거절한다(옛 `claude_prompt` 경로로 새지 않게).
