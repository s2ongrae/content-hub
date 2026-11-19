# 채널 목록·콘텐츠 상세 드릴다운 v1 (2026-11-19)

`#/perf`(성과분석)에서 유튜브·인스타 **채널 목록**을 보고, 영상 하나를 눌러 **상세(`#/post`)** 로 내려가는 기능입니다.
같은 소재가 다른 채널에서 어떻게 나왔는지도 한 화면에 나란히 보입니다.

## 0. 트랙별 채널 범위 (모든 화면 공통)

| 트랙 | 브랜드 | 운영 채널 |
|---|---|---|
| A | `daejeon_youth` | 블로그 · 쇼츠 · 릴스 · 피드 · 클립 · 당근 (6개) |
| B | `ppiyak_kimmary` | **쇼츠 · 릴스 · 클립 (3개)** — 김메리는 블로그·인스타 피드 사진·당근을 운영하지 않는다. 쇼츠·릴스·클립 3개가 올라가면 그 소재는 끝 |

- **기준 파일**: `seeds/track_channels.json`
  `{"daejeon_youth":["blog","shorts","reels","feed","clip","daangn"],"ppiyak_kimmary":["shorts","reels","clip"]}`
- **사본 세 곳**(런타임 fetch·매 요청 시트 읽기 없음): 프론트 `js/trackChannels.js` · GAS `gas/PostDetail.gs` `TRACK_CHANNELS` · 수집기 `tools/analytics/lib/channels.js`.
  `node test/run.js`와 `node gas/test/run.js`가 기준 파일과 `deepStrictEqual`로 대조한다 — 한쪽만 고치면 시험이 깨진다.
- **완료 판정**: 분모 = 트랙 채널셋 중 `*_status`가 `SKIPPED`인 칸을 뺀 것, 분자 = `UPLOADED/DONE/PUBLISHED/LINKED`인 칸.
  `Metrics` 숫자가 아니라 `Contents` 상태만 본다. 트랙 B는 3/3이면 완료, 클립이 늦으면 `PUBLISHING`으로 드러난다(화면 말: "올리는 중").
- **미운영·SKIPPED 채널은 어디에도 남기지 않는다**: 비교표·칩·KPI에서 칸 자체를 뺀다('—'도, "블로그 미연결" 같은 문구도 없음).
  트랙 B에서는 `#/perf`의 당근 KPI 2개·입력 칸·`[블로그 통계 →]` 칩이 숨고, 옛 Metrics 행 중 미운영 채널 것은 KPI·최근 기록에서 제외된다.
- **지표 API가 없는 채널**(클립·당근): 비교표 조회 칸에 "게시 완료(지표 없음)", 아직이면 상태 라벨.
- **수집기(인스타 표면 필터)**: `tools/analytics/config.json`의 `tracks.track_b.instagram.allowedSurfaces = ["reels"]`.
  `instagram.js`가 허용 밖 표면(IMAGE·CAROUSEL_ALBUM 등)을 적재 목록에서 빼고(인사이트 호출도 아낌) 수집 로그에 `[IGNORED_SURFACE]` **1줄**만 남긴다.
  설정이 없으면 트랙 채널셋 ∩ {reels, feed}를 쓴다(트랙 A = 둘 다).
  **이미 쌓인 트랙 B 피드 행**은 시트에 남아 있어도 목록·KPI·비교표에서 제외된다(프론트 `isTrackRow`, GAS 상세 `ERR_NOT_FOUND`).

## 1. GAS — `gas/PostDetail.gs`

| 액션 | 모드 | 하는 일 |
|---|---|---|
| `get_post_detail` | READ | `source`(youtube·instagram·blog) + `external_id` + 선택 `content_id` → 메타·시계열·트랙 채널 비교 |
| `upsert_media_meta` | WRITE | `items[]`(≤500) → `Media_Meta` 갱신. 라우터가 `tryLock`을 잡는다 |
| `list_media_meta` | READ | `source` + `ids[]`(≤200) 일괄 조회 |

- **`Media_Meta` 시트(9열)**: `meta_key, source, external_id, channel, title, thumbnail_url, published_at, duration_sec, updated_at`.
  없으면 첫 올리기 때 스스로 만든다(`gas/Setup.gs`는 건드리지 않음). `meta_key`(`source:external_id`)가 없거나 `updated_at`이 **7일 지났을 때만** 갱신한다. 썸네일은 `https://` 주소만 받는다.
- **`get_post_detail` 응답**: `meta` · `checkpoints`(D1/D7/D14/D30/LATEST 각 마지막 한 줄) · `daily`(날짜당 한 줄, 최대 60일) · `latest` · `collected`(수집 전이면 false) · `linked`/`content_missing` · `track_channels[]` · `compare[]`.
  - 현재값은 `checkpoint='LATEST'` 행 중 가장 최근 하나다(누적값이라 여러 날을 더하면 중복).
  - blog: `Blog_Post_Views`(log_no) 일별 추이 + 글 정보 + 검색어·유입 통계. **검색어·유입은 글별이 아니라 블로그 전체 최근 7일** 통계다(`Blog_Keywords`/`Blog_Inflow`에 글 번호 열이 없음) — 응답의 `scope_note`가 화면에 같이 보인다.
  - `content_id`가 없어도 시트 행의 `content_id`(유튜브·인스타)나 `blog_url`의 글 번호(블로그)로 카드를 찾는다.
  - `compare[]`: 트랙 채널셋 중 `SKIPPED`가 아닌 칸마다 `{channel, status, url, source, external_id, has_metrics_api, collected, metrics}`. 카드의 6개 URL 열에서 ID를 뽑는다 — 유튜브 11자, 인스타 permalink shortcode, `blog_url` 9자리 이상 숫자.
  - 트랙 B 카드로는 블로그를 열 수 없다(`ERR_BLOG_SKIPPED`), 트랙이 운영하지 않는 표면의 게시물은 `ERR_NOT_FOUND`.
- **ID 정규화**: `tools/analytics/lib/ids.js`는 CommonJS라 GAS에서 못 불러서 같은 규칙을 `PostDetail.gs` 안에 복제했다. `gas/test/run.js`가 같은 입력 표로 두 구현을 대조한다.
- **한계(인스타)**: Graph API의 숫자 media id와 permalink shortcode는 서로 계산되지 않는다. 그래서 인스타 비교·상세 연결은 수집 설정 `links`(permalink → content_id)로 `Analytics_Daily.content_id`가 채워진 행에 의존한다.
- 수집 쪽: `tools/analytics/lib/sync.js`가 수집 종료 때 제목·썸네일·길이(트랙 채널셋 안의 표면만)를 `upsert_media_meta`로 올린다. **실패해도 경고 1줄(`[MEDIA_META]`)만 남기고 수집은 성공으로 유지**한다.
- 건드리지 않은 것: `Contents` 열(35+α 그대로), `gas/Analytics.gs`, `gas/Setup.gs`, 워크플로·토큰 전달부.

## 2. 프론트

| 파일 | 역할 |
|---|---|
| `js/trackChannels.js` | 트랙 채널셋·완료 판정(`completionOf`)·트랙 외 행 거르기(`isTrackRow`) |
| `js/channelView.js` | `#/perf`의 `[유튜브]` `[인스타]` 서브탭 — 채널 카드 + 게시물 목록. `LATEST` 행만, 영상당 최근 한 줄(중복 합산 금지) |
| `js/postView.js` | `#/post?source=…&id=…[&cid=…]` 상세 — 지표 카드 3개 · 순수 SVG 추이 · 체크포인트 · 트랙 채널 비교 |
| `js/perfView.js` | 서브탭 `[전체 \| 유튜브 \| 인스타]` + `[블로그 통계 →]` 칩(트랙 B 숨김), 입력 채널을 트랙 채널셋으로 제한 |
| `js/app.js` · `index.html` · `css/style.css` | `#/post` 라우팅(상세는 들어온 탭을 켜 둠) · `app.js?v=20261119o` · 테마 변수만 사용 |

- **하단 탭 개수는 그대로**(10개). 상세는 별도 탭이 아니라 주소(`#/post?…`)다 — 딥링크·새로고침·뒤로가기가 그대로 된다.
- **비교 레이아웃**: PC는 3열 카드 그리드, 폰(≤699px)은 가로 표 대신 채널별 세로 행(채널·상태·핵심지표 2개).
- **빈값·미연결**: 수집 전엔 "⏳ 수집 대기 중", `content_id`가 없으면 "아직 허브 카드와 연결되지 않은 게시물" 안내. 서버가 아직 모르는 액션이면 배포 안내만 보여 준다(빨간 오류 없음).
- 렌더링은 `createElement`/`textContent`/`createElementNS`만 쓴다(`innerHTML` 0건 — 시험이 소스를 검사한다).
- **썸네일 이미지는 그리지 않는다.** CSP가 `img-src 'self' data:`라 외부 이미지가 막힌다. 제목·숫자만 보여 주고, `thumbnail_url`은 시트에만 저장해 둔다(나중에 CSP를 열기로 하면 그때 연결).

## 3. 배포 순서

1. `gas/PostDetail.gs`를 Apps Script에 **새 파일로 추가**하고, `gas/Auth.gs`·`gas/Code.gs` 변경분을 붙여 넣은 뒤 **배포 → 배포 관리 → 편집 → 새 버전**. (이 작업에서는 사용자가 따로 한다.)
2. 프론트는 `main` 푸시로 배포(Pages 캐시 최대 10분, 안 보이면 강제 새로고침).
3. 수집기는 다음 정기 실행부터 제목·썸네일을 올린다. GAS 배포 전에 돌아도 경고 1줄만 남고 수집은 성공한다.

## 4. 시험

```bash
node test/run.js          # GAS 시험 + js 문법 + 조립기 + 수집기 + 트랙 채널 계약·드릴다운 로직
node gas/test/run.js      # GAS 단독
node tools/analytics/test/run.js
```

- 트랙 계약(세 곳 deepStrictEqual) · 트랙 B 분기(3칸·피드 행 제외) · 수집 필터(`allowedSurfaces`·`[IGNORED_SURFACE]` 1줄) · ID 정규화(ids.js와 같은 입력 표) · 빈값/미연결/권한 · `Media_Meta` 7일 갱신 규칙 · SVG 추이.
- 확인하지 못한 것: 실제 시트·실제 GAS 배포 상태의 동작(가짜 환경에서만 시험), 실제 인스타 Graph API 응답의 `thumbnail_url` 필드.
