# Content Hub OS — 대전청년 · 삐약 김메리

1인 크리에이터가 성격이 다른 **2개 브랜드 트랙**을 한 화면에서 전환하며 기획 · 취재 · 검수 · 발행 · 성과 · 노하우 학습을 처리하는 서버리스 웹앱입니다.

- **웹앱(이 저장소, GitHub Pages)**: https://s2ongrae.github.io/content-hub/
- **백엔드**: Google Sheets + Apps Script (`gas/` 폴더, 복붙 3분 → [`DEPLOY_GUIDE.md`](DEPLOY_GUIDE.md))
- **PRD**: `downloads/콘텐츠허브_최종PRD_v2.md` (M1 범위 구현)

| 트랙 | 채널 | 발행 규칙 |
|---|---|---|
| `daejeon_youth` 🍺 대전 청년 | 네이버 블로그 · 유튜브 쇼츠 · 인스타 릴스 · 네이버 클립 | 숏폼 3종 → 블로그(숏폼 임베드) → 숏폼 고정댓글에 블로그 URL 역삽입 → `LINKED` |
| `ppiyak_kimmary` 🐱 삐약 김메리 | 유튜브 쇼츠 · 인스타 릴스 | 쇼츠 · 릴스 업로드 즉시 `LINKED` (블로그 · 클립 `SKIPPED`) |

## 지금 되는 것 (M1)

1. **브랜드 스위처** — 상단에서 🍺 대전 청년(4채널) ↔ 🐱 삐약 김메리(2채널) 전환. 목록 · 검수 · 승인 · 취재가 모두 그 브랜드 기준으로 바뀝니다.
2. **보드** — `DRAFT · GENERATING → REVIEW → READY → PUBLISHING/PUBLISHED → LINKED` 칸반 + `NEEDS_HUMAN/PARTIAL_FAIL` 격리 열. 카드를 누르면 상세(payload · 내부링크 후보 · 적용 규칙).
3. **10초 승인** — 폰에서 카드 1장(브랜드 · 상호 · 품질점수 · 핵심 3줄 · 단점 1줄)을 읽고 `[반려] [스킵] [✅ 승인]`. 승인 1탭 = `record_checklist(human_reviewed=true)` → `update_content(READY)`.
4. **검수** — F2 발행 전 체크리스트 10항목(100점). **80점 이상 + 사람 확인**이어야 READY 승격(서버가 `ERR_TOS_REVIEW_REQUIRED`로 재검증).
5. **취재 등록** — 상호 · 지역 · 키워드 · 플레이스 URL만으로 30초 안에 `DRAFT` 생성(`DY-YYYYMMDD-NNN` / `KM-…` 자동 채번).
6. **노하우 수집함** — 잘 된 글의 규칙을 적어 두고 JSON으로 내보내기(M3 `ingest_benchmark` 입력 형식 초안).
7. **운영 패널** — 헬스체크 · 수동 백업 · 무결성 점검 · 스냅샷 복구(2단 확인) · 토큰 회전 · 콜드스타트 온보딩, 백업 지연 · 쿼터 서킷 · NEEDS_HUMAN 적체 배너.
8. **연결 전 안내** — GAS URL·토큰이 없으면 가짜 데이터 없이 "⚙︎ 설정에서 GAS URL과 API 토큰을 연결하세요" 안내만 보여 줍니다. 연결하는 즉시 실제 시트를 읽습니다.

## 구조

```
index.html              # 앱 (CSP meta, 토큰 마스킹)
css/style.css           # 브랜드 테마(네이비·오렌지 / 코랄·크림), 상태 배지, 폰·PC 레이아웃
js/api.js               # 30s AbortController, 429/5xx만 3회 재시도, 멱등키, 오프라인 큐, 미설정 시 ERR_NO_CONFIG
js/quickApprove.js      # 폰 10초 승인 카드 스택
js/app.js               # 해시 라우터 · 브랜드 스위처 · 화면 6종 (렌더링 textContent 전용)
gas/Setup.gs            # 23시트 · Drive 폴더 · 토큰(비노출) · 시딩 · 트리거
gas/Auth.gs             # 상수시간 토큰 · 화이트리스트 · tryLock(1800) · 멱등 · 민감필드 차단 · 쿼터 서킷
gas/Backup.gs           # 일/주/월 스냅샷 · 80개 배치+이어하기 · manifest · 보존 · 복구 · 무결성 6종
gas/Code.gs             # doGet(liveness) / doPost 라우터 + M1 핸들러 12종
gas/Notify.gs           # 헬스 경보(Slack/메일, 4시간 쿨다운)
gas/Onboarding.gs       # 콜드스타트 위저드(훅·포맷·플레이스·키워드 + 2주 캘린더 10건)
appsscript.json         # timeZone Asia/Seoul, V8, WebApp(USER_DEPLOYING / ANYONE_ANONYMOUS)
DEPLOY_GUIDE.md         # 시트 + GAS 3분 배포 가이드
```

## 보안 원칙

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

M1(이 저장소)은 **프론트 6화면 + GAS 백엔드 12액션**입니다. 파이프라인 리스/재시도(`Pipeline.gs`), 트랙별 발행 전 린터(`QualityGate.gs`), 동일 경과일 아웃라이어(`AnalyticsEngine.gs`), 규칙 A/B(`BenchmarkEngine.gs`)는 M2~M3.
