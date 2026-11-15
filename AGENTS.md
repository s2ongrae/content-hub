# AGENTS.md — content-hub (aside · 코드 에이전트 공용)

이 저장소를 만지는 모든 코딩 에이전트(클로드 코드, aside, 기타)가 **먼저 읽는** 파일입니다.
전체 내용은 [`CLAUDE.md`](CLAUDE.md)에 있고, 여기에는 **어겨서는 안 되는 것만** 다시 적었습니다.
두 문서가 어긋나면 `CLAUDE.md`와 실제 코드를 기준으로 판단하고, 차이를 사용자에게 알립니다.

## 이 저장소는

대전 청년(🍺)과 삐약 김메리(🐱) **두 브랜드의 콘텐츠를 한 화면에서 기획·검수·발행**하는 서버리스 웹앱입니다.
프론트 = GitHub Pages(`main` 푸시 → 30~60초 배포), 백엔드 = Google Sheets + Apps Script(`gas/`).
라이브: <https://s2ongrae.github.io/content-hub/> · **저장소는 공개(public)**.

## 지켜야 하는 것 (요약)

1. **2트랙을 섞지 않는다** — 대전 청년(블로그·쇼츠·릴스·클립, 숏폼→블로그→역삽입 2단계) /
   김메리(쇼츠·릴스, 업로드 즉시 `LINKED`, 블로그·클립 `SKIPPED`). 분기는 `brand` 하나로만.
2. **`READY` 승격 게이트를 우회하지 않는다** — 80점 이상 + 사람 검수, 서버가 `ERR_TOS_REVIEW_REQUIRED`로 재검증.
   M2부터 **팩트 슬롯 `[ ]`가 남아 있으면 `READY` 금지**, S1(커버·훅 일치)·S3(인트로 0초)·S4(밀도) 필수.
3. **시리즈는 JSON → 렌더러 순서만** — 원본 `seeds/series_pack_2026w47.json`, 문서는
   `python3 tools/render_series_pack.py`가 생성. 생성 문서를 직접 고치지 않는다.
4. **비밀·개인정보 금지(공개 저장소)** — GAS `/exec` URL·토큰은 `localStorage`에만, 시드·문서에 실명·전화번호·영수증 URL 금지.
5. **렌더링은 `textContent` 전용** — `innerHTML` 금지, CSP 유지, 토큰 마스킹.
6. **배포 절차** — 프론트를 고치면 `index.html`의 `js/app.js?v=m2-N`과 `#build-label`을 올리고 푸시(Pages 캐시 최대 10분).
   `gas/`는 붙여넣기 후 **새 버전 배포**까지 해야 반영.
7. **화면을 바꿨으면 폰(360·390px)·PC(1400px)에서 직접 확인**한 뒤 "됐다"고 말한다.
8. **폰에서 가로 스크롤을 만들지 않는다** — 보드는 ≤699px에서 상태별 세로 스택, 시리즈 제목은 여러 줄 허용. 표는 좁은 화면에서 글자를 줄이거나 줄바꿈한다.
9. **PWA는 manifest + 192/512 아이콘까지.** `tools/make_icons.py`로 아이콘을 다시 만들고, **Service Worker는 넣지 않는다**(캐시 꼬임).

## 판단 기준 (콘텐츠)

- 유튜브랜딩 4원칙: 타겟 1명 / 썸네일=간판·첫 2초=문턱 / 끝이 보이는 5편 / 통제 가능한 숫자 3개(24h·72h·7d).
  롱폼 10분 원칙은 채택하지 않았다(`rejected_from_source`).
- 증거형 훅(`PROOF_FIRST`)은 **실측 수치가 있을 때만**. 숫자를 만들지 않는다.
- 네이버 클립 챌린지: 정보태그 + `#오늘클립챌린지` + 전체공개. AI 전체 생성 클립은 정산 제외(`ai_generated_ratio ≥ 0.5` 경고),
  동일 내용 재업로드 제외. 보상·조건은 월별로 바뀌므로 기준일을 함께 적는다.

## 문서

`README.md`(기능·구조) · `DEPLOY_GUIDE.md`(시트+GAS 3분 배포) · `docs/M2_ROADMAP.md`(서버가 받아야 할 것) ·
`seeds/series_pack_2026w47.json`(시리즈10편·키워드팩·훅A/B) · `tools/render_series_pack.py`(문서 렌더러)
