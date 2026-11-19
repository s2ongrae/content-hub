# 유튜브·인스타 성과 자동 수집 v1 (2026-11-19)

성과분석(#/perf)은 지금까지 **사람이 D+1·D+7·D+14에 숫자를 넣는 화면**이었다. 이 문서는 그중
**유튜브·인스타그램 지표를 API로 자동으로 채우는 파이프라인**을 설명한다. 블로그·클립·당근은
공개 통계 API가 없어 그대로 손으로 넣는다.

---

## 1. 왜 이렇게 나눴나

| 구분 | 사람이 넣는 값 (기존) | 자동 수집 (이번 작업) |
|---|---|---|
| 채널 | 블로그·클립·당근 | 유튜브(쇼츠·롱폼), 인스타(릴스·피드) |
| 저장 위치 | `Metrics` 시트 | `Analytics_Daily` 시트 (+ 카드 연결 행은 `Metrics` 에도 비춤) |
| 화면 | `#/perf` 숫자 입력함 | `#/perf` 상단 '📡 자동 수집' 구역 |
| 수집 주체 | 사람 | GitHub Actions 무료 크론 (06:10 KST) |

`Contents` 35컬럼과 `Metrics` 기존 열 순서는 건드리지 않는다. `Setup.gs` 도 건드리지 않는다 —
`Analytics_Daily` 는 첫 적재 때 스스로 만든다.

---

## 2. API로 실제로 얻는 것 / 못 얻는 것

### 유튜브 Data API v3 (API 키, OAuth 불필요)

| 얻는다 | 못 얻는다 |
|---|---|
| 영상 조회·좋아요·댓글, 채널 구독자·총조회 | 노출수·클릭률(CTR), 시청지속, 수익 |
| 길이(초) → 쇼츠(≤180초)/롱폼 구분 | 검색 유입 비율 |

**쿼터 설계** (일 10,000 unit 기준)

| 호출 | 단가 | 1회 실행(채널 2·영상 100) |
|---|---|---|
| `channels.list` | 1 unit | 2 |
| `playlistItems.list` (업로드 50개) | 1 unit | 2 |
| `videos.list` (50개 묶음) | 1 unit | 2 |
| **합계** | | **6 unit/일 → 월 180 unit** |

즉 하루 한 번 돌려도 한도의 0.06%만 쓴다. 영상 1건당 호출하는 방식은 쓰지 않는다(쿼터 낭비).

### 유튜브 Analytics API (OAuth, 선택)

- 얻는다: 시청 시간, 평균 시청 비율, 수익화 후 **YouTube 가 보고한 수익(원, `currency=KRW`)**.
- **수익화 전 채널**: `estimatedRevenue` 계열을 부르면 403 이 온다. 배치를 멈추지 않고
  `MONETIZATION_NOT_ENABLED` 로 표시하고 건너뛴다 — 설정의 `tracks.*.youtube.monetized` 가 `false` 면
  아예 부르지 않는다.
- CTR·노출은 API로 제공되지 않는다(YouTube Studio 화면에만 있음).

### 인스타그램 Graph API (장기 토큰)

| 얻는다 | 못 얻는다 |
|---|---|
| 미디어별 조회(views)·도달(reach)·저장(saved)·공유(shares)·좋아요·댓글 | **수익**(정산 개념 없음), 협찬 금액 |
| `media_product_type` 으로 릴스/피드 구분 | 노출(impressions — 메타가 폐기, 도달로 대체) |

- 자기 계정용 라이브 앱은 앱 심사 없이 `instagram_manage_insights` 를 쓸 수 있는 경우가 많다.
  권한이 부분적으로 막히면 **미디어 행은 남기고** `INSIGHTS_*` 로 표시한다(전체 실패로 만들지 않는다).
- 장기 토큰은 **60일**. 만료 7일 전부터 경고를 남기고, `refresh_access_token` 으로 갱신한 새 토큰을
  사람이 Secrets 에 넣는다(자동 저장하지 않는다).

---

## 3. 흐름

```
GitHub Actions (06:10 KST, 무료)
  └─ tools/analytics/cli.js --live --push
       ├─ youtube.js   : channels → playlistItems → videos(50묶음)
       ├─ instagram.js : media(50) → media insights
       ├─ normalize.js : 소스·외부ID·표면·시점·수집일 행으로 정규화
       ├─ score.js     : 성과 점수(실제 수집값만으로 계산)
       ├─ sync.js      : 수익(YouTube 보고·확정 협찬만) · 중복 제거 → 50건 묶음 → GAS ingest_analytics
                          (토큰은 요청 본문에만, 멱등키 = AND-YYYYMMDD-NNN)
GAS (gas/Analytics.gs)
  ├─ Analytics_Daily 에 적재 (중복 키 = 소스|외부ID|표면|시점|수집일)
  └─ 카드와 연결된 쇼츠·릴스·피드 행은 Metrics 에도 한 줄 → 기존 #/perf KPI·배지 그대로 동작
화면 (js/analyticsView.js)
  └─ #/perf 상단 '📡 자동 수집' : 소스별 동기화 상태 · 이번 주 회/도달 · 실제 수익(있을 때만) · 표면별 표
```

키가 하나도 없으면 **네트워크 호출 0** 으로 dry-run 계획만 출력한다(설정 전에도 안전).

---

## 4. 수익 표기 규칙 — 실제 데이터만

추정치를 만들지 않는다. 조회수 × 가정 단가 같은 계산은 코드에서도 화면에서도 없다.

| 상황 | 표시 | 저장 |
|---|---|---|
| 유튜브 수익화 전 | 수익 카드 대신 **구독자** 카드 | `revenue_krw=0`, `revenue_source=''` |
| 유튜브 수익화 후 | `수익 (실데이터)` — YouTube 가 보고한 값 | `revenue_krw`, `revenue_source='ypp'` |
| 사람이 확정한 협찬·제휴 | 같은 카드에 합산 | `revenue_krw`, `revenue_source='confirmed'` |
| 인스타그램 | 정산 개념 없음 → 수익 0 (확정 협찬액만) | `revenue_source=''` 또는 `'confirmed'` |

- 확정 협찬·제휴액은 `tools/analytics/config.json` 의 `revenue.confirmed` 에 영상·미디어 ID 로 적는다
  (`"ID": { "krw": 300000, "label": "브랜드 협찬" }` 또는 숫자만). 비밀값이 아니므로 공개 저장소에 두어도 된다.
- YouTube 보고 수익은 `currency=KRW` 로 받아 **환율 환산을 하지 않는다**. 창은 최근 7일이며, 영상별 최신 행에만 붙는다.
- 화면은 `revenue_source` 가 `ypp`·`confirmed` 인 금액만 센다 — 출처 없는 금액은 세지 않는다.

성과 점수(0~100) = 같은 표면 중위수 대비 조회(최대 60) + 반응률(최대 30) + 저장·공유(최대 10).
표면마다 기준 중위수가 다르므로 쇼츠와 롱폼을 같은 자로 재지 않는다. 점수는 실제 수집값만으로 계산하는 파생 지표다.

---

## 5. 처음 한 번만 해야 하는 것 (사용자)

| 준비물 | 어디서 | 어디에 넣나 |
|---|---|---|
| YouTube Data API v3 키 | Google Cloud Console → API 사용 설정 → 사용자 인증 정보 → API 키 | GitHub Secrets `YOUTUBE_API_KEY` |
| (선택) YouTube Analytics OAuth | 수익화 **후에만** — `yt-analytics.readonly` 동의 | GitHub Secrets `YOUTUBE_OAUTH_TOKEN` |
| Instagram Graph 장기 토큰(60일) | Meta for Developers → 비즈니스 앱 → Instagram Graph API + `instagram_manage_insights` | GitHub Secrets `IG_ACCESS_TOKEN`, 만료일 `IG_TOKEN_EXPIRES_AT` |
| GAS 웹앱 주소·토큰 | Apps Script 배포 URL / 속성의 `API_SECRET_TOKEN` | GitHub Secrets `GAS_WEBAPP_URL`, `GAS_API_TOKEN` |
| 채널 ID·IG 계정 ID·카드 연결 | 유튜브 채널 ID(`UC…`), IG 비즈니스 계정 ID | `tools/analytics/config.json` (비밀 아님) |
| 확정 협찬·제휴액 | 실제 계약 금액 | `tools/analytics/config.json` 의 `revenue.confirmed` (비밀 아님) |

Apps Script 쪽에도 같은 `gas/Analytics.gs` 를 올리고 **재배포**해야 `list_analytics`·`ingest_analytics`
가 살아난다. 재배포 전에는 화면이 '자동 수집 준비 중'으로 조용히 안내한다.

> 공개 저장소다. 실명·전화번호·시트 ID·GAS URL·토큰을 **파일·커밋·화면 문구에 남기지 않는다.**
> 채널 핸들도 코드·문서에 쓰지 않는다(설정 파일의 ID 칸으로만).

---

## 6. 블로그 관리 API 작업과의 충돌 경계

이번 작업이 **새로 만든 파일**은 서로 겹치지 않는다.

```
tools/analytics/**                     (신규)
gas/Analytics.gs                       (신규)
js/analyticsView.js                    (신규)
tools/analytics/workflow/analytics-collect.yml(신규)
docs/ANALYTICS_PIPELINE_v1.md          (신규)
```

기존 파일 수정은 **딱 네 곳, 각 2~6줄**이다.

| 파일 | 수정 내용 |
|---|---|
| `gas/Code.gs` | `M1_HANDLERS` 에 `list_analytics`·`ingest_analytics` 두 줄 |
| `gas/Auth.gs` | `ACTION_WHITELIST` 에 같은 두 줄 |
| `js/perfView.js` | `analyticsView.js` import 1줄 + 패널 호출 1줄 |
| `css/style.css` | 파일 끝에 `.an-*` 규칙 추가(기존 규칙 무수정) |
| `test/run.js`, `gas/test/run.js` | 시험 단계·파일 목록 추가 |

`js/api.js`, `js/lintView.js`, `gas/Orders.gs`, `smartstore-hub`, 포털 오더함(`Command_Queue`)은
**건드리지 않는다.** 블로그 API 작업과 같은 파일을 동시에 고치지 않도록 PR 로 분리해 둔다.

---

## 7. 운영 체크리스트

- [ ] `tools/analytics/workflow/analytics-collect.yml` 을 `.github/workflows/analytics-collect.yml` 로 옮긴다(GitHub App 권한상 워크플로 파일은 브랜치 푸시로 못 올린다 — 웹에서 이름 바꿔 옮기면 끝)
- [ ] Actions Secrets 5종 등록 (없어도 워크플로는 초록으로 끝난다)
- [ ] `tools/analytics/config.json` 에 채널·계정 ID 채우기
- [ ] Apps Script 에 `gas/Analytics.gs` 추가 후 새 버전 배포
- [ ] 첫 실행(`workflow_dispatch`) 후 `#/perf` 에 '📡 자동 수집' 숫자 확인
- [ ] 인스타 토큰 만료일을 `IG_TOKEN_EXPIRES_AT` 에 넣고, 7일 전 경고를 받으면 갱신
- [ ] 카드와 연결할 영상·미디어 ID 를 `links` 에 추가(미연결은 `UNMAPPED` 로 표시)

## 8. 제미니 구현 리뷰(2차) 반영 내역

| 지적 | 반영 |
|---|---|
| 외부ID ↔ 카드 매핑이 공유 주소의 `?si=`·`?igsh=` 때문에 빗나감 | `lib/ids.js` 추가 — 유튜브는 주소에서 11자 ID 추출, 인스타는 permalink 키로 매칭. 설정에 주소를 그대로 붙여도 카드가 붙는다(시험 12건) |
| 200건 일괄 쓰기가 GAS 락(1.8초)과 충돌 | 묶음 크기를 **50건**으로 낮춤(서버 상한은 500 유지) |
| 쇼츠 RPM 150원은 과대 착시 | ~~기본값을 30원으로 낮춤~~ → **2026-11-19 추정 수익 로직 전면 제거**(실제 보고·확정 금액만), `estimate.js` → `score.js` |
| '이번 주 조회'가 누적 재합산이라 부풀려짐 | **순증(델타)** 으로 정의 — `최신 누적 − 기간 시작 전 마지막 누적`, 기간 안에 처음 보인 소재만 누적 전체 |
| 스냅샷을 수집일이 아니라 게시일로 | 이미 게시일(`published_at`) 경과일로 D1/7/14/30 판정 |

## 9. 알려진 한계 (v2 후보)

- **인스타 토큰 자동 갱신은 아직 사람 손 1회다.** 60일 토큰이라 만료 7일 전 경고를 남기지만,
  Cron 이 스스로 Secrets 를 바꿀 수는 없다. v2 후보 ① Apps Script 속성에 토큰을 보관하고 GAS 주간
  트리거가 `refresh_access_token` 으로 갱신 → 수집기가 `get_ig_token` 으로 읽기(비밀값이 웹앱 인증
  토큰 하나로 묶임) ② 토큰을 GCP Secret Manager 에 두고 Workload Identity 로 읽기.
  **둘 다 '비밀값을 어디에 둘지'의 결정**이라 사용자 확인 후 붙인다.
- 인스타 릴스/피드의 노출·도달 정의는 메타 정책에 따라 바뀐다(폐기된 지표는 0으로 남는다).
- 쇼츠/롱폼 구분은 길이(기본 180초) 기준이다 — 3분 초과 쇼츠나 세로 롱폼은 오분류될 수 있다.
- GAS `ingest_analytics` 는 한 번에 500건까지만 받는다(수집기는 50건씩 보낸다).
- 크론은 GitHub 무료 러너라 수 분 늦게 돌 수 있다(시각 정확도가 필요한 지표는 없다).
