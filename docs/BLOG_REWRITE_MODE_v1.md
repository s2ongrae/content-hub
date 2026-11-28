# 블로그 AI `rewrite` 모드 — 허브 연결 v1 (2026-11-28)

노트북 쪽 계약·프롬프트·사실 대조는 `hub-agent/docs/REWRITE_MODE_v1.md` 가 원본이다.
이 문서는 **허브(웹앱)가 그 계약을 어떻게 싣고 화면에 보여 주는지**만 적는다.

## 무엇이 달라졌나

| | `preserve` (기본) | `rewrite` (새로 쓰기) |
|---|---|---|
| 보내는 필드 | `content_draft.format:'blog'` | 같은 payload + `mode:'rewrite'` |
| 원문 | 문단 해시 잠금 — 결과의 USER 블록이 다르면 AI 문장을 버린다 | 재료로만 쓴다. `draft.body` 문단이 본문이 된다 |
| 검사 | 블록 해시(`verifyUserBlocks`) | 사실 대조(`draft.fact_check`) — 원문에 없는 숫자가 생기면 폐기 |
| 화면 | 「붙여넣기 키트」에 내 문단 그대로 | 새 본문 + **원문 / 재작성 나란히** + '재료로 쓴 원문' 접기 |

`rewrite` 는 **블로그만**이다. 영상 대본은 장면·비트 검사와 엇갈릴 수 있어 다음 단계다(`normalizeDraftMode`가 영상은 preserve 로 낮춘다).

## 코드 지도

- `js/studioLogic.js`
  - `DRAFT_MODES` · `normalizeDraftMode(mode, format)` — 계약 범위로 좁힌다.
  - `buildDraftRequest({…, mode})` — `rewrite` 일 때만 `mode` 필드를 싣는다. **preserve 는 필드 자체가 없어 예전 payload 와 100% 같다.**
    드라이브 경로(`payload_source:'drive'`)로 넘어가도 `mode` 는 base 에 남는다.
  - `composeBlogWithDraft(kit, draft)` — `draft.mode==='rewrite'` 이고 `draft.body` 가 있으면 `composeRewriteBlog` 로 간다.
    본문 앞에 원문 블록을 깔지 않고, 제목·본문·마무리·캡션만 조립한다. 원문은 `origin_paras` 로 돌려준다.
    본문이 비어 오면 **원문 보존 조립으로 안전하게 되돌아간다**(결과물을 잃지 않는다).
  - `factCheckLine(fact_check, warnings)` — 승인 카드 한 줄: `사실 12개 대조 통과 · 경고 3건`.
- `js/createStudio.js`
  - 블로그 화면 「AI 초안 방식」 칩: `내 문단 그대로` / `✍️ 사실만 남기고 새로 쓰기`. 고른 값은 브랜드별 localStorage(`contenthub.studio.draftmode.*`)에 남는다.
  - `paintKit` — rewrite 면 결과 맨 위에 본문 문단 수·글자 수·사실 대조 줄을 붙이고, 키트 아래에 원문/재작성 비교(`.st-compare`)와 '재료로 쓴 원문' 접기(`.st-fold`)를 그린다.
  - 오더 접수 뒤 `h` 를 못 찾아 터지던 결함(`sendOrder`)도 여기서 고쳤다 — 고치기 전에는 AI 초안이 늘 "연결 또는 형식 오류 — h is not defined"로 끝났다.
- `css/studio.css` — `.st-compare`(760px 부터 두 칸, 폰은 위아래) · `.st-fold`.

## 시험

`node test/run.js` 의 `[9] 제작·생성 스튜디오` 절이 본다.

- 계약: `preserve` 는 mode 없음 / `rewrite` 만 mode 있음 / 영상은 안 실림 / 드라이브 경로에도 남음
- 조립: `draft.body` 로 본문, 원문을 앞에 깔지 않음, 두 줄 호흡 유지, 사실 대조·경고 한 줄, 본문이 비면 preserve 폴백
- 화면: 가짜 DOM 으로 실제 버튼 흐름 — 고른 방식이 오더 `mode` 로 나가고 승인 화면에 비교가 그려지는지
