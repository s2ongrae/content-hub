# Content Hub OS — 대전청년 · 삐약 김메리

1인 크리에이터가 성격이 다른 **2개 브랜드 트랙**을 한 화면에서 전환하며 기획 · 취재 · 검수 · 발행 · 성과 · 노하우 학습을 처리하는 서버리스 웹앱입니다.

- **웹앱(이 저장소, GitHub Pages)**: https://s2ongrae.github.io/content-hub/
- **백엔드**: Google Sheets + Apps Script (`gas/` 폴더, 복붙 3분 → [`DEPLOY_GUIDE.md`](DEPLOY_GUIDE.md))
- **PRD**: `downloads/콘텐츠허브_최종PRD_v2.md` (M1 범위 구현)

| 트랙 | 채널 | 발행 규칙 |
|---|---|---|
| `daejeon_youth` 🍺 대전 청년 | 네이버 블로그 · 유튜브 쇼츠 · 인스타 릴스 + 인스타 피드(카드뉴스) · 네이버 클립 · **당근 스토리** | 숏폼 3종 → 블로그(숏폼 임베드) → 숏폼 고정댓글에 블로그 URL 역삽입 → `LINKED`. 카드뉴스 피드는 블로그 발행 뒤 D+1~D+2 시차. 당근은 쇼츠·릴스·클립 직후에 3가지만 손봐서 같이 올린다(역삽입 댓글은 당근만 생략) |
| `ppiyak_kimmary` 🐱 삐약 김메리 | 유튜브 쇼츠 · 인스타 릴스 · 네이버 클립 **(3채널)** | 쇼츠 · 릴스 · 클립 업로드 즉시 `LINKED` — 블로그·인스타 피드 사진·당근은 운영하지 않는다(쇼츠·릴스·클립 3개가 올라가면 그 소재는 끝). 기준: `seeds/track_channels.json` · [`docs/CHANNEL_DRILLDOWN_v1.md`](docs/CHANNEL_DRILLDOWN_v1.md) |

## 지금 되는 것 (M1)

1. **브랜드 스위처** — 상단에서 🍺 대전 청년(6채널) ↔ 🐱 삐약 김메리(3채널: 쇼츠·릴스·클립) 전환. 목록 · 검수 · 승인 · 취재가 모두 그 브랜드 기준으로 바뀝니다.
2. **보드** — `DRAFT · GENERATING → REVIEW → READY → PUBLISHING/PUBLISHED → LINKED` 칸반 + `NEEDS_HUMAN/PARTIAL_FAIL` 격리 열. 발행 전(초안·작성 중·확인·수정) 카드에는 **본문 첫 두 줄**이 붙고, 카드를 누르면 상세가 **`작성본` 탭**으로 열려 본문·대본을 글로 읽고 [본문 복사]·[붙여넣어 저장]한다. 본문이 없는 카드는 그 사실을 크게 알려 준다 — [`docs/DRAFT_CONTENT_v1.md`](docs/DRAFT_CONTENT_v1.md).
3. **10초 승인** — 폰에서 카드 1장(브랜드 · 상호 · 품질점수 · 핵심 3줄 · 단점 1줄)을 읽고 `[반려] [스킵] [✅ 승인]`. 승인 1탭 = `record_checklist(human_reviewed=true)` → `update_content(READY)`.
4. **검수** — F2 발행 전 체크리스트 10항목(100점). **80점 이상 + 사람 확인**이어야 READY 승격(서버가 `ERR_TOS_REVIEW_REQUIRED`로 재검증).
5. **취재 등록** — 상호 · 지역 · 키워드 · 플레이스 URL만으로 30초 안에 `DRAFT` 생성(`DY-YYYYMMDD-NNN` / `KM-…` 자동 채번).
6. **노하우 수집함** — 잘 된 글의 규칙을 적어 두고 JSON으로 내보내기(M3 `ingest_benchmark` 입력 형식 초안).
7. **운영 패널** — 헬스체크 · 수동 백업 · 무결성 점검 · 스냅샷 복구(2단 확인) · 토큰 회전 · 콜드스타트 온보딩, 백업 지연 · 쿼터 서킷 · NEEDS_HUMAN 적체 배너.
8. **연결 전 안내** — GAS URL·토큰이 없으면 가짜 데이터 없이 "⚙︎ 설정에서 GAS URL과 API 토큰을 연결하세요" 안내만 보여 줍니다. 연결하는 즉시 실제 시트를 읽습니다.
9. **폰 보드** — 좁은 화면(≤699px)에서는 6열 칸반 대신 상태별 세로 스택으로 바뀝니다(가로 스크롤 없음). 0건 열은 제목 줄만 남습니다.
10. **메타 보정** — 카드 상세에서 `target_keywords`·`quality_score`를 직접 채워 시트에 저장합니다(발행 기록만 가져온 행의 빈칸 보정).
11. **홈 화면 앱(PWA)** — `manifest.webmanifest` + 192/512 아이콘. 안드로이드 크롬에서 "앱 설치"로 주소창 없는 화면. Service Worker는 넣지 않습니다(캐시 꼬임 방지).
12. **당근 스토리(5번째 채널)** — 대전 청년 카드에만 `[당근]` 칩이 붙고, 상세 시트에 **수익화 트래커**(당월 인정 스토리 N/5 · 유효 시청 N/2,000 · 확정 기본보상 · 달성 배지)와 **발행 전 점검 3개**(직접 촬영·설명 30자·협찬 표기)가 있습니다. 메리 트랙은 `daangn_status=SKIPPED` 고정으로 칩을 그리지 않습니다. 근거: [`docs/DAANGN_STORY_CHANNEL_v1.md`](docs/DAANGN_STORY_CHANNEL_v1.md), 수치: `seeds/daangn_story_v1.json`.
13. **성과분석(#/perf)** — 큰 숫자 3개(이번 주 유효조회 · 당월 누적 리워드 · 당근 달성률) + **오늘 입력할 숫자**(D+1·D+7·D+14가 걸린 카드만 채널별 한 줄 입력) + **D+7 승자(🏆)·D+14 리프레시(🔄) 배지** + 최근 기록. `Metrics` 시트에 시계열로 쌓고, GAS가 `list_metrics`/`record_metrics`를 모르면 빨간 오류 대신 조용한 안내만 띄웁니다.
14. **발행 전 린터(#/lint)** — 상위 24건 실측에서 뽑은 **8항목**(제목 앞배치·제목 길이·첫 화면 정보·본문 분량·사진 밀도·문단 호흡·짧은 줄·해시태그)을 PASS·주의·고칠 것으로 채점합니다. 같은 규칙을 웹앱(`js/blogLint.js`)과 CLI(`tools/blog_lint_cli.py`)가 `seeds/blog_lint_rules_2026w48.json` 하나로 공유합니다. 기준 문서: [`docs/BLOG_STANDARD_v4.md`](docs/BLOG_STANDARD_v4.md). 같은 화면에서 **AI 티 7패턴**(WARN/표시)과 **첫 400자 D.I.A.+ 게이트**, **키워드 3~5회**를 함께 판정하고, 2개↑ 적발·결말 상투어·키워드 6회↑는 '발행 보류'로 알립니다 — [`docs/BLOG_AI_TONE_v1.md`](docs/BLOG_AI_TONE_v1.md).
15. **내 블로그(#/blog)** — 네이버 '블로그 관리 → 통계'를 따로 열지 않고 여기서 봅니다. GAS(`gas/Blog.gs`)가 **로그인 없이 공개된 데이터만** 모읍니다: 글 목록·카테고리·발행일·댓글·공감·사진 수, 최근 5일 방문자 수. 화면에는 큰 숫자 4개(어제 방문자 · 최근 7일 방문자와 앞 7일 대비 · 이번 달 발행과 발행 간격 · 7일 반응 증가), 30일 방문자 막대, 글 목록(최신·반응·이번 주 뜨는 글 정렬, 7일 증가분, 연결된 카드), **[점검]** — 발행된 본문을 읽어 린터 8항목으로 채점, 카테고리별 평균 반응, **검색 순위**(네이버 검색 API 블로그 탭 상위 100, `Rank_Log` 누적).
    - 처음 한 번: Apps Script에 `gas/Blog.gs` 붙여넣기 → 새 버전 배포 → 편집기에서 `installBlogDailyTrigger` 1회 실행(매일 23시 자동 수집 — 네이버가 방문자를 5일치만 주므로 이걸 켜야 기록이 쌓임).
    - 검색 순위(선택): developers.naver.com 에서 '검색' API 앱 등록 → 스크립트 속성 `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`. **키는 저장소·시트에 넣지 않는다.**
    - 글별 조회수·유입 검색어·유입 경로·성별/연령은 로그인해야 보이는 통계라 **피클이 매일 읽어 `blog_stats_ingest`로 보냅니다**(로그인은 피클 브라우저에만, 허브는 비밀번호·쿠키를 받지 않음). 지시서·형식: [`docs/BLOG_STATS_INGEST.md`](docs/BLOG_STATS_INGEST.md). 2일 넘게 안 들어오면 화면 위에 알려 줍니다.
    - 시트: `Blog_Posts`(글별 최신값) · `Blog_Post_Daily`(글별 하루 1줄) · `Blog_Visitors`(날짜별 방문자) — 첫 수집 때 자동 생성.
    - 피클 통계용 시트: `Blog_Post_Views` · `Blog_Keywords` · `Blog_Inflow` · `Blog_Audience`(첫 전송 때 자동 생성), `Blog_Visitors`에 `pageviews` 열 추가.

## 구조

```
index.html              # 앱 (CSP meta, 토큰 마스킹)
css/style.css           # 브랜드 테마(네이비·오렌지 / 코랄·크림), 상태 배지, 폰·PC 레이아웃
js/api.js               # 30s AbortController, 429/5xx만 3회 재시도, 멱등키, 오프라인 큐, 미설정 시 ERR_NO_CONFIG
js/quickApprove.js      # 폰 10초 승인 카드 스택
js/app.js               # 해시 라우터 · 브랜드 스위처 · 화면 8종 (렌더링 textContent 전용)
js/draftView.js         # 카드 상세 '작성본' 탭 — 채널별 본문 읽기·복사·붙여넣어 저장
js/perfView.js          # 성과분석(#/perf) — 큰 숫자·오늘 입력함·승자/리프레시 배지 · 서브탭 [전체|유튜브|인스타]
js/trackChannels.js     # 트랙별 운영 채널(seeds/track_channels.json 사본)·완료 판정
js/channelView.js       # #/perf 유튜브·인스타 채널 목록·카드 → 상세로 드릴다운
js/postView.js          # #/post 콘텐츠 상세 — 지표 3개·SVG 추이·트랙 채널 비교 (docs/CHANNEL_DRILLDOWN_v1.md)
js/lintView.js          # 발행 전 린터(#/lint) — 8항목 채점 화면
js/blogLint.js          # 린터 규칙 엔진(웹앱·CLI 공용)·window.BlogLint
js/daangnView.js        # 당근 수익화 트래커·발행 전 점검 3개
js/studioView.js        # 숏폼 공방(연재 탭) — 훅 채점·대본 뼈대·제목/썸네일·컷 리스트·댓글·바이럴
js/yt/                  # 무료 MIT 스킬의 계산을 한국어로 옮긴 모듈(hookscore·titlelint·edl·viral·preset·comments)
seeds/skills/           # 숏폼 프리셋·훅 공식·댓글 규칙·말투(웹앱과 파이썬 도구가 함께 읽는 데이터)
seeds/daangn_story_v1.json        # 당근 자격·보상·규격·점검 3개
tools/blog_lint_cli.py  # 초안 md 8항목 + AI 티 검사 CLI(통과 0 · 고칠 것 1 · --strict 면 발행 보류도 1)
tools/yt/               # 노트북·클로드 코드용 파이썬 도구 4개 + 스킬 설치 스크립트
.claude/skills/yt-*     # 클로드가 바로 부르는 숏폼·유튜브 스킬 12개
gas/PostDetail.gs       # 채널 드릴다운 — get_post_detail · upsert_media_meta · list_media_meta(Media_Meta 시트)
gas/Setup.gs            # 23시트 · Drive 폴더 · 토큰(비노출) · 시딩 · 트리거
gas/Auth.gs             # 상수시간 토큰 · 화이트리스트 · tryLock(1800) · 멱등 · 민감필드 차단 · 쿼터 서킷
gas/Backup.gs           # 일/주/월 스냅샷 · 80개 배치+이어하기 · manifest · 보존 · 복구 · 무결성 6종
gas/Code.gs             # doGet(liveness) / doPost 라우터 + M1 핸들러 12종
gas/Notify.gs           # 헬스 경보(Slack/메일, 4시간 쿨다운)
gas/Onboarding.gs       # 콜드스타트 위저드(훅·포맷·플레이스·키워드 + 2주 캘린더 10건)
manifest.webmanifest     # PWA (name 콘텐츠 허브 / standalone / icons 192·512)
icons/icon-192.png       # 홈 화면 아이콘 (tools/make_icons.py 로 생성)
icons/icon-512.png
appsscript.json          # timeZone Asia/Seoul, V8, WebApp(USER_DEPLOYING / ANYONE_ANONYMOUS)
tools/make_icons.py      # 아이콘 생성기 (Pillow)
DEPLOY_GUIDE.md         # 시트 + GAS 3분 배포 가이드
```

## 숏폼 공방 (연재 탭 → 🎬 숏폼 공방)

무료 공개 스킬(`Jakeschincariol/youtube-agent-skill`, MIT)과 당근 스토리 숏폼 관찰을 이 채널에 맞게 옮겼습니다.
**서버·API 키 없이 브라우저에서 계산**하고, 규칙 데이터는 `seeds/skills/*.json` 하나를 웹앱과 파이썬 도구가 같이 읽습니다.

| 도구 | 하는 일 |
|---|---|
| ① 훅 채점 | 21개 공식 분류 + 5속성(특정성·호명·손실·호기심·간결), 최종 = 평균 60% + 최약 40% |
| ② 대본 뼈대 | 당근 프리셋 비트(0~2초 훅 → 약속 → 증거 2 → 페이오프 → 요청) + 타임코드·ON SCREEN·자막 배치, 카드로 저장 |
| ③ 패키지 | 제목 + 썸네일 한 쌍 린터(폭 기준 60/40, 중복·숫자 없음) |
| ④ 컷편집 | SRT → DEAD·FILLER·REPEAT 컷 타임코드 + 살릴 곳의 화면 지시 |
| ⑤ 댓글 | 4분류 + 말투 파일 기반 답장 초안 + 고정 1개 |
| ⑥ 바이럴 | 채널별 중위수 대비 배수(2.0배 이상 강조) |

노트북·클로드 코드에서는 같은 도구를 1줄로 붙입니다: `bash tools/yt/install_skills.sh` → `~/.claude/skills/yt-*`.
자세한 규칙: [`docs/SHORTS_PRESET_v1.md`](docs/SHORTS_PRESET_v1.md), 스킬 목록: [`.claude/skills/README.md`](.claude/skills/README.md).

## 보안 원칙

- **커밋 금지 5종** — ①실명·연락처 ②Google Sheet ID ③GAS `/exec` URL ④API 토큰 ⑤고객·계정 캡처. 커밋 전 `git diff --staged`로 한 번 더 본다.
- **저장소에는 비밀 없음.** `/exec` URL과 API 토큰은 각 기기 브라우저 `localStorage`에만 있고 요청 본문으로만 전송합니다(`URL · Referer · 로그`에 남지 않음).
- 계정 비밀번호 · 쿠키 · 2FA 코드는 앱도 서버도 저장하지 않습니다(서버가 `ERR_SENSITIVE_FIELD`로 거부).
- 캡차 · 2FA · 로그인 만료는 `NEEDS_HUMAN`으로 격리 — 사람이 직접 처리합니다.
- 렌더링은 `textContent` 전용, CSP meta 적용, 토큰 입력 마스킹.
- 토큰 유출 의심 시 운영 패널에서 **토큰 회전** 1회 → 이전 토큰 즉시 무효.

## 고치고 배포할 때 (3분)

1. 프론트(`index.html` · `css/` · `js/`)를 고치면 `index.html` 의 `?v=m1-N` 을 한 단계 올립니다.
2. `git push` → GitHub Pages 가 30~60초 뒤 새로 배포합니다.
3. **GitHub Pages 캐시는 10분**입니다. 바로 안 바뀌어 보이면 10분 뒤 새로고침하세요(브라우저 강제 새로고침: `Ctrl+Shift+R`).
4. GAS(`gas/`)를 고쳤으면 Apps Script에 다시 붙여넣고 **배포 → 배포 관리 → 편집 → 새 버전** 으로 올려야 반영됩니다(URL 유지).

## 상태

M1(이 저장소)은 **프론트 7화면 + GAS 백엔드 12액션**입니다. 파이프라인 리스/재시도(`Pipeline.gs`), 트랙별 발행 전 린터(`QualityGate.gs`), 동일 경과일 아웃라이어(`AnalyticsEngine.gs`), 규칙 A/B(`BenchmarkEngine.gs`)는 M2~M3.

### 시트 스키마 (2026-11-18)
`Contents`는 29 → 35 → **37컬럼**입니다. 오른쪽 끝에만 덧붙였고 기존 행·값은 그대로입니다.
`series_id` · `episode_no` · `hook_variant`(M2 시리즈) / `ig_feed_status` · `ig_feed_url` · `ig_carousel_count`(인스타 피드) / **`daangn_status` · `daangn_url`(당근)**.
`Metrics`는 기존 11컬럼 뒤에 **`valid_views` · `saves` · `reward_krw`** 3칸을 덧붙였습니다.
**읽기·표시는 지금 동작**하고, 쓰기는 `gas/Code.gs`의 `editable` 목록·핸들러에 넣어 두었으니 **Apps Script 재배포 후** 동작합니다.
칼럼은 첫 호출 때 `ensureSchemaV2_`가 헤더만 늘리므로 시트를 새로 만들 필요는 없습니다(초기 설치를 다시 돌려도 됨).
