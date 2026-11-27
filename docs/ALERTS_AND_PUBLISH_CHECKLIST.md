# 경보 운영 규정 · 4채널 발행 체크리스트

기준: `s2ongrae/content-hub` `main` `3af3c29` (2026-11-27). 이 문서는 **운영 규정 초안 v1**이고, 코드는 아직 없다.
아래 표의 `지금 상태`가 `구현`이면 이미 코드에 있는 것, `제안`이면 문서만 있는 것(넣으려면 `gas/Notify.gs` 수정 + **GAS 새 버전 배포**가 필요하다)이다.

초안 출처: 뷔투 보고 `Q-20261127-180120-1v89`(4채널 발행 체크리스트·자동화 경보 운영 규정). 이 문서는 그 초안을 실제 코드·시트와 대조해 **어긋난 부분을 고친 판**이다(정정 내역은 §5).

---

## 1. 지금 코드에 있는 것 (검증)

| 항목 | 코드 | 내용 |
|---|---|---|
| 경보 3종 | `gas/Notify.gs` | `ALERT_BACKUP_FAIL`(백업·트리거 실패 또는 48시간 초과) · `ALERT_QUOTA_80`(일일 호출 80%) · `ALERT_NEEDS_HUMAN_STALE`(`NEEDS_HUMAN` 2건 이상 또는 2시간 방치) |
| 판정 시점 | `gas/Backup.gs` `runMaintenanceTrigger` | **15분마다** `checkAndNotifyHealth_()` — 경보 때문에 새 트리거를 만들 필요가 없다 |
| 스팸 차단 | `ALERT_COOLDOWN_SEC_ = 14400` | 같은 경보는 **4시간에 1회**(CacheService) |
| 발송 | `notifyOnce_` | 슬랙 웹훅(`SLACK_WEBHOOK_URL`) → 실패·미설정이면 메일(`ALERT_EMAIL` 또는 계정 메일). 보낸 경보는 `System_Health`에 `ALERT` 행으로 남는다 |
| 쿼터 서킷 | `ALERT_QUOTA_80` | 80%에서 `THROTTLE_MODE`를 6시간 켠다 |
| 발행 게이트 | `gas/Code.gs` `assertReadyGate_` | `READY`는 **`Checklist_Runs`에 `human_reviewed=true` + `total_score>=80`** 기록이 있어야 통과(없으면 `ERR_TOS_REVIEW_REQUIRED`) |
| 링크 가드 | `gas/Code.gs` `channelLinkAudit_`(2026-11-26) | `LINKED`는 트랙 채널마다 상태·주소가 찼고 주소가 그 채널 규칙에 맞아야 통과(`ERR_LINK_INCOMPLETE`, `confirm_incomplete:true`로만 넘김) |
| 상태값 | `Contents.status` | `DRAFT · GENERATING → REVIEW → READY → PUBLISHING/PUBLISHED → LINKED`, 격리 `NEEDS_HUMAN`·`PARTIAL_FAIL` |
| 채널 칸 | `Contents` 40칸 | `blog_status/blog_url` · `shorts_status/shorts_url` · `reels_status/reels_url` · `ig_feed_status/ig_feed_url/ig_carousel_count` · `clip_status/clip_url` · `daangn_status/daangn_url` |
| 피드 카드 상태 | `gas/IgCardDraft.gs` | `ig_feed_status`: `queued → drafting → draft_ready → human_approved`(반려하면 `queued`) |
| 기록 | 기존 시트 | `Channel_Logs`(작업·실패: `task_type`, `result_status`, `error_code`, `error_detail`, `created_at`) · `System_Health` · `Integrity_Logs` · `Ops_Queue`(재시도) |

**새 시트를 만들지 않는다.** `Contents`는 **40칸 그대로**이고, 경보·체크리스트를 위해 열을 더하지 않는다.

---

## 2. 추가 경보 6종 (검증·정정본)

공통 문구: `[경보명] 조건 한 줄 / 쌓인 수 / 해야 할 일 1개`. 같은 경보는 **4시간 쿨다운 안에서 1회**만 보낸다(기존 `notifyOnce_` 그대로). 판정은 모두 15분 유지보수 트리거 안에서 하며, **새 트리거를 만들지 않는다.** 경보는 알림만 한다 — 자동으로 고치거나 발행하지 않는다.

| # | 경보 | 조건 | 판정 근거(시트·칸) | 사람이 할 일 | 지금 상태 |
|---|---|---|---|---|---|
| 1 | `STATS_STALE` | **블로그** 통계가 48시간 넘게 새로 들어오지 않음 | `Blog_Visitors` 최신 `day`(없으면 `synced_at`)가 오늘보다 2일 이상 뒤 | 통계 수집 루틴(피클 브라우저 루틴)이 돌았는지 확인하고 한 번 다시 보낸다 | 제안 |
| 2 | `DRAFT_READY_PILE` | `ig_feed_status='draft_ready'`가 3건 이상 | `Contents` 행 수. 방치 시간은 `Channel_Logs`의 그 카드 `task_type='ig_card_draft'`·`result_status='OK'` **`created_at`**(=초안이 만들어진 시각) | 승인 탭에서 승인/다시 쓰기 | 제안 |
| 3 | `PARTIAL_FAIL_ACCUM` | 24시간 안에 `status='PARTIAL_FAIL'` 3건 이상 | `Contents.status` + `updated_at`(24시간 이내) | 실패한 채널을 열어 원인 확인 후 다시 올리기 | 제안 |
| 4 | `LINK_PENDING` | 트랙 A에서 숏폼 3종(쇼츠·릴스·클립)이 모두 `UPLOADED/DONE/PUBLISHED/LINKED`인데 **블로그 발행 단계가 12시간 넘게 비어 있음**(`blog_status`가 위 상태가 아니거나 `blog_url` 빈칸) | `Contents`의 `shorts_status`·`reels_status`·`clip_status`·`blog_status`·`blog_url` + `updated_at` | 블로그 발행 → 숏폼 고정댓글에 블로그 주소 넣기 → 카드를 `LINKED`로 | 제안 |
| 5 | `TRIGGER_FAIL` | **야간 카드 초안 트리거**(매일 02:30)가 그날 실행 흔적이 없음 | `Channel_Logs`에 그 날짜(`created_at`) `task_type='ig_card_draft'` 행이 **0건**(OK·ERROR 무관) | Apps Script 트리거 목록 확인 → `installIgCardDraftTrigger()` 재설치 | 제안 |
| 6 | `ACTIVE_NO_OUTPUT` | 야간 트리거가 돌았는데 새 `draft_ready`가 0건인 날이 **2일 연속** | `Channel_Logs`의 `ig_card_draft` OK 행은 있는데 `Contents.ig_feed_status`가 `draft_ready`로 바뀐 카드 0건(`updated_at`으로 확인 불가 — §5-3) | `ig_feed_status='queued'` 카드가 있는지, 근거 글이 비었는지 확인 | 제안 |

**초기 수치(48시간·3건·12시간·2일)는 운영하며 조정한다.** 지금 값은 "사람이 하루 한 번 보면 되는 양"을 기준으로 잡은 시험값이다.

### 넣지 않은 것

- **클립 통계 미적재 경보**: 네이버 클립은 **자동 수집이 없다**(`gas/Analytics.gs`는 `youtube`·`instagram`만, 블로그는 `blog_stats_ingest`로 피클이 보낸다). 클립을 조건에 넣으면 경보가 **항상 켜져 있게** 되므로 넣지 않는다.
- **백업·무결성 트리거 실패**: 이미 `ALERT_BACKUP_FAIL`이 잡는다(`runTriggerSafely_` → `LAST_BACKUP_FAILURE_AT`). 같은 것을 두 번 알리지 않는다.
- **실패 기록용 새 시트**: 만들지 않는다. 실패 기록은 `Channel_Logs`(`error_code`·`error_detail`)와 `Ops_Queue`(재시도 상태)에 이미 남는다.

---

## 3. 4채널 발행 체크리스트 운영 규정

원칙: **모든 발행·업로드는 사람 승인 뒤에만.** 자동 발행·자동 업로드 코드는 없다(인스타 피드 포함 — 승인은 `ig_feed_status`만 `human_approved`로 바꾼다).

### 트랙 A · 대전 청년 (`daejeon_youth`)

| 채널 | 발행 전 | 발행 뒤 기록 | 실패하면 |
|---|---|---|---|
| 블로그 | 검수 탭 체크리스트 **10항목 100점 중 80점 이상** + `human_reviewed`(이게 `READY` 게이트다). 금지어·상투 표현 없음, 단점 1개, 팩트 확인, 광고 표시 확인 | `blog_url`(blog.naver.com 형식) — 형식이 틀리면 `LINKED` 가드가 막는다 | `Channel_Logs`에 사유가 남고, 다시 올린 뒤 URL을 고친다 |
| 유튜브 쇼츠 | 커버 문구 = 첫 2초 자막, 인사말·로고 0초, 팩트 슬롯 `[ ]` 없음 | `shorts_url`(youtube.com/shorts·youtu.be 형식) | `shorts_status`를 되돌리고 다시 올린다 |
| 인스타 릴스 | 같은 소재면 9:16으로 다시 배치(4:5 카드를 그대로 넣으면 잘린다) | `reels_url`(instagram.com) | 같음 |
| 인스타 피드 카드뉴스 | `draft_ready` 초안의 5~8장을 폰에서 읽어 보고 승인. 카드 PNG는 승인 탭 [전체 저장] 또는 카드마다 [저장]으로 내려받아 직접 올린다 | `ig_feed_url`·`ig_carousel_count` | 승인 탭 [다시 쓰기] → `queued`로 돌아가 다음 밤에 다시 만든다 |
| 네이버 클립 | 정보태그 + `#오늘클립챌린지` + 전체공개, AI 비율 0.5 미만 | `clip_url`(clip.naver.com) | 같음 |
| 당근 스토리 (트랙 A 한정) | ① 지역·가게명 정확 ② 가격·영업시간 최신 ③ 과장 표현 없음 | `daangn_status`·`daangn_url` | 같음 |

### 트랙 B · 삐약 김메리 (`ppiyak_kimmary`)

쇼츠·릴스·클립 **3개만** 운영한다(블로그·피드·당근 없음). 3개가 올라가면 `LINKED`(1단계 완결). 피드 카드뉴스 초안도 만들지 않는다(`igCardTrackAllows_`가 `feed`가 없는 트랙은 건너뛴다).

### 공통

- 채널 상태는 `UPLOADED · DONE · PUBLISHED · LINKED` 중 하나여야 "올라감"으로 친다. `SKIPPED`는 그 채널을 운영하지 않는다는 표시이고 가드에서 빠진다.
- `LINKED`(전 채널 완료)는 기록이 다 찬 카드에만. 빈 채널을 알고도 넘기려면 화면의 '그래도 넘기기'(`confirm_incomplete:true`)를 쓴다 — 쓰면 `Channel_Logs`·`Integrity_Logs`에 흔적이 남는다.

---

## 4. 승인 접점

- 발행·업로드·삭제·개인정보·배포는 **포털 회의실 승인함**으로만 요청한다: `kind:'approval'`, `risk`(돈·외부 발행·계정·삭제·개인정보·배포). 규칙 원문은 `s2ongrae.github.io/docs/AGENT_PROTOCOL.md` §0(2026-11-27 v3).
- 승인 전에는 실행하지 않는다. 결정은 `reply_to` 답장(`✅ 승인`·`⏸ 보류`·`🚫 거절`)으로 온다.
- **경보는 알림만 한다** — 승인 요청을 대신 만들지 않고, 자동 조치(재실행·재발행·삭제)도 하지 않는다.

---

## 5. 뷔투 초안에서 정정한 것

1. **클립 통계 경보 삭제** — 클립 자동 수집이 없어 상시 경보가 된다(§2 '넣지 않은 것'). 블로그만 48시간으로 본다.
2. **판정 주기를 매일 09:30·18:00으로 두지 않음** — 새 시간 트리거는 GAS 재배포가 필요하고, 이미 15분 유지보수 트리거가 경보를 판정한다. 주기 대신 **4시간 쿨다운**으로 하루 횟수를 제한한다.
3. **`DRAFT_READY_PILE`의 '24시간 방치' 근거를 바꿈** — `Contents.updated_at`은 카드를 마지막으로 고친 시각이라 초안이 언제 만들어졌는지와 다르다(초안 생성은 `updated_at`을 쓰지 않는다). `Channel_Logs`의 `ig_card_draft` OK 행 `created_at`을 쓴다.
4. **`LINK_PENDING` 정의를 바꿈** — "블로그 URL 역삽입 12시간 미완"은 시트에 역삽입 기록이 없어 자동 판정이 불가능하다. 대신 **블로그 발행 단계가 12시간 비어 있는지**로 잡고, 역삽입 자체는 사람이 `LINKED`로 올릴 때 확인한다.
5. **`TRIGGER_FAIL` 범위를 좁힘** — 백업·무결성 트리거 실패는 `ALERT_BACKUP_FAIL`과 중복이라 빼고, 기록이 없어 조용히 멈추는 **야간 카드 초안 트리거**만 본다.
6. **실패 기록용 새 시트는 만들지 않는다** — 뷔투 초안이 적은 그런 시트는 없다. 실패는 `Channel_Logs`(`error_code`·`error_detail`)와 `Ops_Queue`(재시도 상태)로 충분하다.
7. **'피투가 URL을 시트에 기록'** — 맞다. 단, 형식 검사까지 있다는 것을 명시했다(`blog_url`이 blog.naver.com 형식이어야 `LINKED` 통과).
8. **'카드 10항목·80점'** — 맞다(검수 탭 `CHECKLIST` 10항목 합 100점, 80점 미만이면 넘기기 버튼이 막힌다). `human_reviewed`가 함께여야 서버가 `READY`를 받는다는 점을 더했다.

---

## 6. 미확인

- 슬랙 웹훅·`ALERT_EMAIL`이 실제 계정에 설정돼 있는지는 시트·스크립트 속성을 보지 못해 **미확인**이다(`System_Health`에 `ALERT` 행이 있는지로 확인 가능).
- 추가 6종을 코드로 넣으려면 `gas/Notify.gs` + 새 버전 배포가 필요하다. 배포는 레이 님 승인 사항이다.
- 초기 수치(48시간·3건·12시간·2일)의 적정성은 실제 운영 기록이 쌓인 뒤에 판단한다.
