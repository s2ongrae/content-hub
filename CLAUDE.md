# content-hub — 클로드 코드·aside 작업 안내

> 1인 크리에이터(성래 님)가 성격이 다른 **두 브랜드 트랙**을 한 화면에서 기획·검수·발행·성과까지 처리하는
> 서버리스 웹앱입니다. 프론트는 이 저장소(GitHub Pages), 데이터는 Google Sheets + Apps Script.
> 이 파일은 `git pull` 하는 순간 클로드 코드가 자동으로 읽습니다. 프론트를 고치기 전에 §2(2트랙)와 §5(시리즈·시드)를 먼저 읽으세요.

사용자는 **성래 님**입니다. 개발자가 아니고, 폰에서 화면을 확인합니다. 한국어로, 전문용어는 풀어서 말합니다.
확인하지 않은 것은 "확인하지 못했다"고 밝히고, 화면을 바꿨으면 **폰 폭(360·390px)과 PC 폭(1400px)에서 직접 확인한 뒤에** "됐다"고 말합니다.

---

## 어느 PC에서 열어도 (2026-11-19)

- **시작 전에 `git pull --ff-only` 한 번.** 회사 PC와 집 노트북이 같은 `main` 을 쓴다. force·merge 로 밀지 말고, 갈라지면 멈추고 알린다.
- **구글 드라이브·OneDrive 폴더 안의 `.git` 은 만지지 않는다.** 회사 PC 코드는 `C:\dev`, 집 노트북은 기존 로컬 폴더. 드라이브는 문서·산출물 보관 전용이고 `.env`·키 파일은 드라이브 밖(`%USERPROFILE%\.freellmapi.key`)에 둔다.
- 두 기기가 같은 파일을 동시에 고치지 않는다: 코드 작업은 한 곳(집 노트북 워커 또는 회사 PC)에서만 돌리고, 커밋하면 `pcbeat hook` 이 포털 관제에 알린다.
- 게이트: 워커는 `main` 에 올리기 전에 시험·문법과 **최근 30분 원격 터치**를 확인한다(겹치거나 시험을 못 돌렸으면 `auto-review/<order_id>` 로 보류).

## 1. 이 저장소는

| 항목 | 값 |
|---|---|
| 라이브 | <https://s2ongrae.github.io/content-hub/> (GitHub Pages, `main` 푸시 → 30~60초 뒤 배포) |
| 저장소 | **공개(public)** — 비밀·개인정보를 절대 넣지 않는다 |
| 백엔드 | Google Sheets + Apps Script(`gas/`). 배포 주소(`/exec`)와 API 토큰은 **각 기기 브라우저 `localStorage`에만** 있고 요청 본문으로만 전송 |
| 상태 | M1(프론트 6화면 + GAS 12액션) 배포됨. `#/series`는 M2 시리즈·키워드팩·훅 A/B (시드 JSON 기반, 서버 불필요) |

### 구조

| 경로 | 무엇 |
|---|---|
| `index.html` | 앱 셸(CSP meta, 토큰 마스킹, 하단 탭 `data-route`). 스크립트는 `js/app.js?v=m2-1`, 빌드 표시는 `#build-label` |
| `js/app.js` | 해시 라우터 · 브랜드 스위처 · 화면 6종(보드·승인·검수·취재·노하우·운영). 렌더링은 `textContent`/`createElement` 전용 |
| `js/api.js` | GAS 호출(30s AbortController, 429/5xx만 3회 재시도, 멱등키, 오프라인 큐, 미설정 시 `ERR_NO_CONFIG`) |
| `js/quickApprove.js` | 폰 10초 승인 카드 스택 |
| `js/trackChannels.js` · `js/channelView.js` · `js/postView.js` | 채널 드릴다운 — 트랙별 운영 채널 상수(`seeds/track_channels.json` 사본, 시험이 3곳 대조) · `#/perf` 유튜브·인스타 서브탭 · `#/post` 상세. `docs/CHANNEL_DRILLDOWN_v1.md` |
| `gas/PostDetail.gs` | `get_post_detail` · `upsert_media_meta` · `list_media_meta` + `Media_Meta` 시트(첫 올리기 때 자동 생성). 배포는 새 파일 추가 후 새 버전 |
| `js/seriesView.js` | `#/series` — 시리즈(대본 복사·보드에 DRAFT 생성)·키워드팩·훅 A/B 체크리스트(편별 `localStorage`) |
| `manifest.webmanifest` · `icons/` | 홈 화면 앱(PWA). Service Worker 없음 |
| `tools/make_icons.py` | 아이콘 생성기(192/512). 디자인을 바꾸면 이 스크립트로 다시 만든다 |
| `css/style.css` | 브랜드 테마(네이비·오렌지 / 코랄·크림)·상태 배지·폰/PC 레이아웃 |
| `gas/Setup.gs` | 23시트·Drive 폴더·토큰(비노출)·시딩·트리거 |
| `gas/Auth.gs` | 상수시간 토큰·화이트리스트·`tryLock(1800)`·멱등·민감필드 차단(`ERR_SENSITIVE_FIELD`)·쿼터 서킷 |
| `gas/Code.gs` | `doGet`(liveness만) / `doPost` 라우터 + M1 핸들러 12종(`list_contents`·`create_content`·`update_content`·`record_checklist`·`backup_now`·`restore_from_snapshot`·`rotate_token`·`run_coldstart_onboarding` 등) |
| `gas/Backup.gs` | 일/주/월 스냅샷·80개 배치·manifest·보존·복구·무결성 6종 |
| `gas/Notify.gs` | 헬스 경보(슬랙/메일, 4시간 쿨다운) |
| `gas/Onboarding.gs` | 콜드스타트 위저드(훅·포맷·플레이스·키워드 + 2주 캘린더 10건) |
| `gas/Blog.gs` · `js/blogView.js` | `#/blog` 내 블로그 — 네이버 공개 데이터(글·댓글·공감·방문자) 수집·본문 린터·검색 순위(오픈API 키는 스크립트 속성에만). 쿠키·로그인 금지. 로그인 통계(조회수·검색어·독자)는 피클이 `blog_stats_ingest`로 보냄 → `docs/BLOG_STATS_INGEST.md` |
| `seeds/series_pack_2026w47.json` | **시리즈 10편(2×5)·키워드팩·훅 A/B 시드.** 읽기 전용 정적 JSON(공개 페이지가 `fetch`로 읽음) |
| `tools/render_series_pack.py` | 시드 JSON → 기획 문서 렌더러. **문서를 직접 고치지 않는다** |
| `docs/M2_ROADMAP.md` | M2에서 서버(GAS)·시트가 받아야 할 것(스키마 3컬럼·액션·품질 게이트) |
| `DEPLOY_GUIDE.md` | 시트 + GAS 3분 배포 절차 |

## 2. 2트랙 분리 원칙 (가장 중요)

| 트랙 | 채널 | 발행 규칙 |
|---|---|---|
| `daejeon_youth` 🍺 대전 청년 | 네이버 블로그(`youth-daejeon`) · 유튜브 쇼츠(`@daejeon_daily`) · 인스타 릴스(`@daejeon_daily`) · 네이버 클립 | **2단계 순환**: 숏폼 3종 업로드 → 블로그 발행(숏폼 임베드) → 숏폼 고정댓글에 블로그 URL 역삽입 → `LINKED` |
| `ppiyak_kimmary` 🐱 삐약 김메리 | 유튜브 쇼츠(`@s2ongrae`) · 인스타 릴스(`@m2ow.mari`) · 네이버 클립 | **1단계 완결**: 쇼츠·릴스·클립 3개가 올라가면 즉시 `LINKED`. 블로그·인스타 피드 사진·당근은 운영하지 않는다(2026-11-16 확정, 2026-11-19 피드까지 제외) |

- **두 트랙의 콘텐츠·계정·해시태그·톤을 섞지 않는다.** 메리 소재는 메리 트랙에만, 대전 맛집·일상은 대전 청년 트랙에만.
- 인스타는 대전 청년 계정의 **맛집 전용** 규칙을 지킨다(개인 일상은 별도).
- **인스타는 표면이 둘이다** — 릴스(`reels_*`, 비팔로워 추천·완주·공유)와 피드 카드뉴스(`ig_feed_*`, 팔로워 관계·저장·슬라이드). 한 칸으로 합치지 않는다.
  트랙 A 피드는 블로그 핵심 요약 5~8장 캐러셀로 **블로그 발행 뒤 D+1~D+2 시차** 발행(동시 게시는 초기 노출을 나눠 먹는다). 트랙 B 는 피드 사진을 운영하지 않는다(릴스만) — `seeds/track_channels.json`.
  컬럼: `ig_feed_status` · `ig_feed_url` · `ig_carousel_count` (2026-11-16 시트에 추가, GAS 재배포 전까지는 **읽기·표시 전용**).

- 코드에서 트랙 분기는 `brand`(`daejeon_youth` / `ppiyak_kimmary`) 하나로만 한다. 새 화면을 만들 때도 `BRANDS` 정의를 쓰고 문자열을 흩뿌리지 않는다.
- 상태값: `DRAFT · GENERATING → REVIEW → READY → PUBLISHING/PUBLISHED → LINKED`, 격리 열 `NEEDS_HUMAN`·`PARTIAL_FAIL`.

## 3. READY 승격 게이트 (서버가 재검증)

- **80점 이상 + 사람 검수(`human_reviewed=true`)** 여야 `READY`. 아니면 서버가 `ERR_TOS_REVIEW_REQUIRED`로 거부한다(`gas/Code.gs` `handleUpdateContent_`·`handleRecordChecklist_`).
- M2에서 추가할 판정(전부 코드로 판정 가능, `docs/M2_ROADMAP.md` §2-3): 첫 2초 자막 12자 이내(WARN) · 커버 문구와 첫 2초 자막의 **숫자 집합 일치**(다르면 FAIL) · `series_id`가 있으면 `episode_no`/`total` 필수 · **팩트 슬롯 잔존 시 `READY` 차단**.
- **지금 구현된 게이트**: `record_checklist`가 100점 만점 채점을 해 `total_score >= 80`과 `human_reviewed`를 함께 보고, `update_content`가 `READY` 승격 때 서버에서 다시 확인한다(아니면 `ERR_TOS_REVIEW_REQUIRED`).
- **M2에서 추가할 채점·필수 항목**(`downloads/콘텐츠허브_PRDv2_부록A_참고영상반영.md` §6): B1~B6(30점) + S1~S8(70점). **S1(커버·훅 일치)·S3(인트로 0초)·S4(밀도)는 필수** — 90점이어도 S3가 실패면 승격 불가. 서버에 넣기 전까지는 체크리스트 문구로만 존재한다.
- 게이트를 "일단 통과시키는" 우회(강제 `READY`, 검수 생략 플래그)를 만들지 않는다. 필요하면 사용자에게 이유를 설명하고 확인받는다.

## 4. 보안 — 이 저장소는 공개다

- **비밀 없음**: GAS `/exec` URL·API 토큰은 브라우저 `localStorage`에만. 코드·시드·문서·커밋에 넣지 않는다. `.env`·`config.local.js`·`*.local.json`은 `.gitignore` 대상.
- **개인정보 금지**: 시드 JSON과 문서에 고객·계정 실명, 전화번호, 영수증 이미지 URL, 계정 캡처를 넣지 않는다. 팩트 슬롯은 `[ ]`로 비워 둔다.
- **렌더링은 `textContent` 전용**(`innerHTML` 금지). CSP meta 유지. 토큰 입력은 마스킹.
- 계정 비밀번호·쿠키·2FA 코드는 앱도 서버도 저장하지 않는다(서버가 `ERR_SENSITIVE_FIELD`로 거부). 캡차·2FA·로그인 만료는 `NEEDS_HUMAN`으로 격리해 사람이 처리.
- 토큰 유출 의심 시 운영 패널의 **토큰 회전** 1회(이전 토큰 즉시 무효).
- 광고·협찬 표기와 AI 활용 표시는 끄지 않는다(네이버 클립 챌린지 정산 조건).

## 5. 시리즈·시드·렌더러 (M2)

- **원본은 JSON 하나**: `seeds/series_pack_2026w47.json` — 시리즈 2개(`SY-DY-01` 대전 청년 5편 / `SY-KM-01` 김메리 5편), 편마다 제목(SEO)·커버 문구·첫 2초 훅·20초 컷별 대본·해시태그 5·크로스 포인트·팩트 슬롯·연결 장치, 그리고 `keyword_pack`(네이버 자동완성 실측 22 질의·클러스터 7·제목 공식 3), `hook_ab`(발행 전 체크리스트 11항·A/B 설계), `publishing_calendar`.
- **고치는 순서는 JSON → 렌더러** 하나뿐:
  ```bash
  python3 tools/render_series_pack.py                 # 기본 출력: ../downloads/콘텐츠허브_시리즈10편_키워드팩.md
  python3 tools/render_series_pack.py --out /tmp/check.md
  ```
  생성된 문서를 직접 고치면 앱과 어긋난다. 시드를 고치면 렌더러를 다시 돌린다. 라이브 `#/series`는 `seeds/series_pack_2026w47.json?v=2026w47`을 `cache:no-cache`로 읽으므로 시드만 바꿔도 프론트 재배포는 필요 없다(브라우저 캐시만 주의 — 안 보이면 강제 새로고침).
- **팩트 슬롯 규칙**: 대본의 `[ ]`는 촬영 당일 채우는 자리다. **`[ ]`가 남아 있는 편은 `READY`로 올리지 않는다.** 확인하지 않은 가격·영업시간·몸무게·시각을 자막에 쓰지 않는다 — 이 채널의 유일한 무기는 실측이다.
- 시드에는 **검색량 수치를 쓰지 않는다.** 자동완성은 "검색 수요가 있다"는 증거일 뿐이다. 제목 공식·클러스터만 쓴다.
- `#/series`의 "취재 보드에 DRAFT 생성"은 `create_content`를 호출한다(브랜드·상호·키워드). 화면에서 시드를 수정하지 않는다(읽기 전용).

## 6. 유튜브랜딩 4원칙 · 네이버 클립 챌린지 조건 (콘텐츠 판단 기준)

참고영상 「구독자 1000명 전엔 '5가지'만 반복하세요」(유튜브랜딩, 2026-10-20)에서 **롱폼 10분 원칙만 제외**하고 4원칙을 쇼츠 지표로 번역해 채택했다(`downloads/유튜브_참고영상_쇼츠가이드.md`, `downloads/콘텐츠허브_PRDv2_부록A_참고영상반영.md`).

1. **타겟은 한 명** — 채널 타겟 한 문장 밖의 소재는 그 채널에 올리지 않는다.
2. **썸네일=간판, 첫 30초=문턱** — 쇼츠는 **첫 2초**. 커버 문구를 확정한 뒤 그 약속을 첫 2초 자막으로 회수하고, 인사말·날씨·로고 인트로는 0초.
3. **끝이 보이는 5편 시리즈** — 편번호(N/5)·중반 위치 앵커·숨긴 단서·다음 편 예고(3초)로 이탈을 막는다.
4. **통제 가능한 숫자 3개만** — 24h/72h/7d(3초 잔존율). 조회수를 목표로 삼지 않는다.

- 증거형 훅(`PROOF_FIRST`)은 **실측 수치가 있을 때만**. 없는 숫자를 만들면 채널이 죽는다.
- 발행 리듬: 유튜브 쇼츠 **주 2~3개**(편당 훅·커버에 20분 이상), 네이버 클립은 1일 1개 재활용.
- **네이버 클립 챌린지 조건**: 정보태그 부착 + `#오늘클립챌린지` + **전체공개**. (동영상 주 3개 2,000원 / 게시물 주 5개 2,000원, 4주 최대 8,000원, 월간 어워즈 TOP500 최대 5만원. 예산 소진 시 합산 재생수 상위 3만명까지.)
- **AI 비율 가드**: 전체 또는 대부분을 AI로 생성한 클립은 심사·혜택 제외 → `ai_generated_ratio ≥ 0.5`인 클립은 미션 집계에서 자동 제외 경고(자막·색보정 같은 보조 수단은 'AI 활용' 표시하고 통과).
- 클립 부적합: 3초 미만, 단일 사진만, 정보태그와 내용 불일치, 협찬 미표기, 남의 영상 재사용, **동일 내용 반복·태그만 바꾼 재업로드**.
- 조건·보상은 **월별로 바뀐다**. 수치를 인용할 때는 기준일을 함께 적는다.

## 7. 고치고 배포하는 순서

1. 프론트(`index.html`·`css/`·`js/`) 수정 → **`index.html`의 `js/app.js?v=m2-N`과 `#build-label`을 한 단계 올린다**(캐시 때문에 안 올리면 옛 화면이 보인다).
2. `main`에 푸시 → Pages가 30~60초 뒤 배포. **Pages 캐시는 최대 10분** — 바로 안 바뀌면 기다리거나 강제 새로고침(`Ctrl+Shift+R`).
3. `gas/`를 고쳤으면 Apps Script 편집기에 다시 붙여넣고 **배포 → 배포 관리 → 편집 → 새 버전**(URL 유지). 붙여넣기만 하고 새 버전을 안 올리면 반영되지 않는다.
4. 화면을 바꿨으면 **폰(360·390px)과 PC(1400px) 캡처를 직접 확인**한다. PC 화면은 꼭 필요할 때만 바꾼다.
5. 사용자에게는 "무엇이 바뀌었고 / 무엇을 확인했고 / 무엇은 확인 못 했는지"를 짧게 알린다.

## 8. 검증 (자동 테스트 없음 — 이 저장소에는 테스트 꾸러미가 없다)

- 시드·렌더러: `python3 tools/render_series_pack.py --out /tmp/check.md`가 오류 없이 끝나고, 10편이 모두 나오는지 확인. JSON 문법은 `python3 -m json.tool seeds/series_pack_2026w47.json`.
- 프론트: 실제 GAS 연결 상태에서 보드·승인·검수·취재·`#/series`를 폰 폭(360·390)과 PC 폭(1400)으로 직접 눌러 본다. 콘솔 오류 0건.
- PWA: `manifest.webmanifest`·`icons/icon-192.png`(192×192)·`icons/icon-512.png`(512×512) 존재, `index.html` head에 manifest/icon/apple-touch-icon/mobile-web-app-capable. **Service Worker는 넣지 않는다**(캐시 꼬임).
- GAS: Apps Script 편집기에서 저장(문법) → `health` 1회 호출 응답 확인. 실제 시트에 붙이기 전에는 **새 버전 배포를 하지 않는다**(라이브 앱이 깨진다).
- 확인하지 못한 것은 보고에 그대로 적는다("화면은 봤지만 실제 GAS 저장은 확인 못 함" 등).

## 9. 코드를 고칠 때 자주 나는 사고

- `innerHTML`로 되돌리기 금지(CSP·XSS). 태그가 필요하면 `createElement`.
- 시드 JSON을 화면에서 수정하는 코드 금지(읽기 전용). 저장이 필요하면 GAS 액션을 만든다.
- `api.js`의 재시도 규칙(429/5xx만 3회)을 넓히지 않는다 — 중복 생성 사고가 난다. 쓰기는 `idempotency_key`를 유지.
- `#/series` fetch 경로는 상대경로 `seeds/…`다. 하위 경로 배포를 가정해 `/seeds/…` 같은 절대경로로 바꾸지 않는다.
- 라우터에 화면을 추가하면 `index.html`의 탭(`data-route`)과 `js/app.js`의 렌더 맵 두 곳을 같이 고친다.
- 톤: 사용자는 "짜치다"(유행·감성 부족)에 민감하다. 카드·뱃지·이모지를 더 얹기보다 여백·정렬·색을 다듬는다.


## 에이전트 동시 작업 규칙 (피클·집 노트북·회사 PC 공통, 2026-11-19)

- **시작**: `git pull --ff-only` → 같은 기기에서 `agent-lock lock <레포> "작업명"` → `pcbeat start "작업명" <프로젝트>`. ff 불가·잠금 충돌이면 **멈추고 보고**한다(임의 merge·force 금지).
- **같은 레포를 병렬로** 해야 하면 `agent-lock wt <레포> <작업이름>`(로컬 워크트리·브랜치 `agent/<기기>/<작업>`), 끝나면 테스트 후 `agent-lock wtdone`.
- **끝**: 테스트 → 한 가지씩 커밋 → 즉시 `git push` → `agent-lock unlock <레포>` → `pcbeat done`.
- **금지**: `push --force`·`reset --hard`·충돌 파일 통째 덮어쓰기·남의 `agent/…`·`auto/…` 브랜치 수정·`status/agent.json` 직접 수정(피클 전용). 키·주소·고객 정보는 어디에도 넣지 않는다.
- 전체 규칙·한계·설치: `s2ongrae.github.io` 의 `docs/AGENT_COORDINATION.md`, 도구 `tools/agent-lock.ps1`.

## ECC 스킬 (2026-11-19)

- `affaan-m/ECC` v2.2.3에서 기존 `yt-*` 12종·`daejeon-content`와 겹치지 않는 4개만 골라 `.claude/skills/ecc-*/`에 넣었다 — `ecc-seo`(블로그 노출) · `ecc-article-writing`(장문 초안) · `ecc-brand-voice`(트랙별 목소리 프로필) · `ecc-short-video-distribution`(쇼츠·릴스·클립 배포).
- 본문은 영어 원문 그대로, 앞머리에 이 레포 기준 한국어 메모. 고른 이유·갱신은 `.claude/skills/ECC.md`. **부딪히면 이 CLAUDE.md §2·§3이 우선한다.**
