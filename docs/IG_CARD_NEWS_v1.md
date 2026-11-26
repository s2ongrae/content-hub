# 인스타 카드뉴스 초안 v1 (2026-11-26)

인스타 **피드 카드뉴스**를 밤에 자동으로 초안까지 만들어 두고, 폰 승인 탭에서 한 번에 승인·반려하는 1차 MVP입니다.
**자동 발행은 없습니다** — 인스타에 올리는 일은 사람이 직접 합니다(2단계 분리).

## 1. 한 장의 흐름

```
Contents.ig_feed_status = 'queued'
        ↓  (밤 02:30, 야간 트리거 1회)
   'drafting'  ← 선점(동시에 두 번 만들어지지 않게)
        ↓  무료 Gemini 초안 JSON
   드라이브 저장  →  payload.ig_feed + ContentHubOS_Uploads/<content_id>/ig_card_draft.json
        ↓
   ig_feed_status = 'draft_ready' · status = 'REVIEW' · ig_carousel_count = N
        ↓  폰 승인 탭 [✅ 카드뉴스 승인]
   ig_feed_status = 'human_approved'      (반려하면 → 'queued', 다음 밤 다시 초안)
```

실패하면 `ig_feed_status` 를 **`queued` 로 되돌리고** `Channel_Logs` 에 `task_type=ig_card_draft`·`ERROR` 로 사유를 남깁니다.

## 2. 쓰는 칸 — 새 열을 만들지 않는다

| 열 | 값 |
|---|---|
| `ig_feed_status` | `queued` → `drafting` → `draft_ready` → `human_approved` |
| `ig_carousel_count` | 초안 슬라이드 장수(3~8, 보통 5~8) |
| `media_drive_url` | 비어 있을 때만 초안 폴더 링크를 채운다(사람이 적어 둔 값은 덮지 않는다) |
| `payload_file_id` | 있던 payload 파일 그대로 — 초안은 그 안 `ig_feed` 키로 들어간다 |

`Contents` 40칸은 그대로입니다(`gas/Setup.gs` 무변경).

## 3. 화면

- **승인 탭**(`js/quickApprove.js`): `ig_feed_status = draft_ready` 카드는 `🖼️ 인스타 카드뉴스 N장` 카드로 뜹니다.
  요약·해시태그(초안 파일에서 한 번만 읽음) · **드라이브에서 초안 보기** · **4:5 / 3:4 미리보기** · PNG 저장.
- **카드 그리기**(`js/studioCanvas.js`): 기본 4:5(`1080×1350`) 그대로, `aspect:'3:4'` 를 주면 `1080×1440` 으로 그립니다.

## 4. 켜는 순서 (사람이 하는 일)

1. Apps Script 에 `gas/IgCardDraft.gs` 를 **새 파일로 추가**하고 `gas/Auth.gs`·`gas/Code.gs` 도 다시 붙여넣는다.
2. **배포 → 배포 관리 → 편집 → 새 버전**(URL 유지). 새 파일만 붙이고 새 버전을 안 올리면 액션이 없다(`ERR_UNKNOWN_ACTION`).
3. 스크립트 속성 확인:
   - `GEMINI_API_KEY` — 무료 키
   - `GEMINI_BILLING_ACK_YYYYMM` = `1` — 이번 달 과금 인지(0원 방어, AI_Brief 와 같은 규칙)
4. 편집기에서 `igCardSelfTest` 한 번 → 키·과금 인지·트리거·대기 카드 수 확인(키 값은 돌려주지 않는다).
5. `installIgCardDraftTrigger` 한 번 → 매일 02:30 KST. 끄려면 `removeIgCardDraftTrigger`.
6. 초안을 만들 카드의 `ig_feed_status` 를 **`queued`** 로 둔다(트랙 B=삐약 김메리는 피드를 운영하지 않아 건너뛴다).

## 5. 안전장치

- **무료만**: 허용 모델 `gemini-4-hydrogen`·`gemini-3.8-flash` 두 개. 그 밖의 모델은 `ERR_MODEL_NOT_ALLOWED`.
- **0원 방어**: 키가 없으면 `SKIPPED_NO_API_KEY`, 과금 인지가 없으면 `SKIPPED_NO_BILLING_ACK` — 호출 0회, 카드는 `queued` 그대로.
- **한도**: 하루 12콜(`IG_CARD_CNT_<날짜>`), 429 는 재시도 없이 `SKIPPED_429` + 당일 잠금(`GEMINI_EXHAUSTED_<날짜>`), 한 번에 최대 3장, 240초 예산.
- **개인정보**: 전송 직전 AI_Brief 의 스크러버를 그대로 태운다(휴대폰·이메일·주민번호·긴 숫자·도로명주소). 가린 뒤에도 남으면 `ERR_BLOCKED_PII` 로 **전송하지 않는다**.
- **사실**: 프롬프트가 "근거에 없는 사실·숫자·가격·영업시간을 만들지 말라"고 못 박고, 근거는 카드 payload 의 본문 발췌 + 시트 사실 칸만 쓴다. 근거에 `[ ]`·`[채우기]` 가 있으면 초안 `flags.fact_placeholder=true` 로 화면에 알린다.
- **멈춘 선점 회수**: `drafting` 이 30분 넘게 그대로면 다음 실행이 회수한다(영구히 잠기지 않음).
- **발행 금지**: Meta/인스타 API 를 부르지 않는다(시험이 소스에서 확인).

## 6. 액션

| action | mode | 비고 |
|---|---|---|
| `ig_card_draft_run` | WRITE · longRunning | 사람이 화면에서 지금 한 번 돌릴 때(`limit` 1~3, `content_id` 로 한 장만) |
| `ig_card_review` | WRITE | `{content_id, decision:'approve'|'reject', reason?}` — 승인은 `draft_ready` 만, 반려는 승인 취소도 가능. 같은 결정 재클릭은 `already:true` |

## 7. 시험

- `node gas/test/run.js` — `[IG]` 절: 선점·정상 초안·드라이브 저장·실패 복구·429·PII·예산·승인/반려·트리거.
- `node test/run.js` — `[20]` 절: 4:5/3:4 프리셋, 승인 탭 카드, 미리보기, 승인/반려 호출.
- `node tools/analytics/test/run.js` — `[7]` 절: 초안이 도는 트랙 = 수집기가 피드를 모으는 트랙(기준 `seeds/track_channels.json`).

## 8. 다음 단계(이번 MVP 밖)

- Slides API 로 실제 카드 이미지 생성 → 드라이브 저장(GAS 재배포 필요, 스코프 추가 필요).
- 승인된 초안의 예약 발행(Meta Graph API) — **사람이 켜는 별도 2단계**.
- 블로그 발행 D+1~D+2 시차 자동 `queued` 전환.
