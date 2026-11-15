# 배포 가이드 — 시트 + GAS 백엔드 (약 3분)

웹앱은 이미 https://s2ongrae.github.io/content-hub/ 에 떠 있습니다.
이 문서는 **뒤에서 데이터를 저장할 Google Sheets + Apps Script**를 붙이는 순서입니다.
한 번만 하면 되고, 이후에는 시트 메뉴와 웹앱 설정만 씁니다.

준비물: 구글 계정(성래 님), 크롬 데스크톱. 소요 3~5분.

---

## 1. 스프레드시트 만들기 (30초)

1. <https://sheets.new> → 새 스프레드시트.
2. 이름을 `[ContentHubOS] MultiBrand_Creator_DB` 로 바꿉니다. (이름은 자유, 문서에만 쓰임)

## 2. Apps Script 열기 · 매니페스트 교체 (40초)

1. 시트 상단 메뉴 **확장 프로그램 → Apps Script**.
2. 왼쪽 톱니 **프로젝트 설정** → **"appsscript.json' 매니페스트 파일 표시"** 체크.
3. 왼쪽 **편집기** 로 돌아와 `appsscript.json` 파일을 열고, 내용을 이 저장소의
   [`appsscript.json`](appsscript.json) 으로 **전부 덮어쓰기**.

```json
{
  "timeZone": "Asia/Seoul",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.scriptapp"
  ],
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

> `timeZone` 이 없으면 백업 시각과 콘텐츠 ID 채번이 9시간 어긋납니다. 반드시 넣으세요.

## 3. 코드 6개 붙여넣기 (90초)

기본 `Code.gs` 파일 하나만 있는 상태에서, 아래 6개를 **파일명 그대로** 만들어 붙여넣습니다.
(＋ → 스크립트 → 이름 입력 → 내용 붙여넣기 → Ctrl/Cmd+S)

| 순서 | 파일 | 내용 출처 |
|---|---|---|
| 1 | `Setup.gs` | [`gas/Setup.gs`](gas/Setup.gs) |
| 2 | `Auth.gs` | [`gas/Auth.gs`](gas/Auth.gs) |
| 3 | `Backup.gs` | [`gas/Backup.gs`](gas/Backup.gs) |
| 4 | `Code.gs` | [`gas/Code.gs`](gas/Code.gs) — **기존 기본 파일에 덮어쓰기** |
| 5 | `Notify.gs` | [`gas/Notify.gs`](gas/Notify.gs) |
| 6 | `Onboarding.gs` | [`gas/Onboarding.gs`](gas/Onboarding.gs) |

각 파일 오른쪽 위 **⋯ → 다운로드**로 받은 파일을 열어 전체 선택 · 복사해도 됩니다.
저장 후 시트로 돌아가 **새로고침(F5)** 하면 상단에 **ContentHub OS** 메뉴가 생깁니다.

## 4. 초기 설치 (20초)

1. 시트 새로고침 → 메뉴 **ContentHub OS → 1. 초기 설치 실행 (Setup)**.
2. 처음 한 번 구글 권한 동의 창이 뜹니다 → **고급 → (안전하지 않음)으로 이동 → 허용**.
   (내가 만든 스크립트라 뜨는 기본 경고입니다.)
3. 실행 로그에 `ContentHubOS setup completed` 가 보이면 성공.

이 단계에서 만들어지는 것:

- **시트 23개**: `Contents` `Channel_Logs` `Metrics` `Config` `Brand_Config` `Benchmarks` `Prompt_Rules`
  `Keywords` `Rank_Log` `Metrics_Same_Age` `Hooks` `Formats` `Checklist_Runs` `Challenge_Missions`
  `Applications` `Experiments` `Places` `Outreach` `CTA_Log` `Content_Leases` `Ops_Queue`
  `System_Health` `Integrity_Logs`
- **Drive 폴더**: `ContentHubOS_Payloads/{daejeon_youth, ppiyak_kimmary, benchmarks}`, `ContentHubOS_Backups/{daily, weekly, monthly, restored}` (전부 **비공개**)
- **시드 행**: `Brand_Config` 2행(대전청년 · 삐약김메리), `Prompt_Rules` v1.0 2행, `Config` 8행
- **트리거 4개**: 매일 03:00 일일 백업+무결성 · 일 03:30 주간 · 1일 04:00 월간 · 15분 유지보수(리스 회수)

## 5. 토큰 복사 (15초)

메뉴 **ContentHub OS → 2. API 토큰 확인 (로그 미기록)** → 모달의 입력칸을 클릭하면 전체 선택됩니다.
**복사만 하고 어디에도 붙여넣지 마세요**(메모장 · 카톡 · 시트 금지). 바로 6단계로.

> 토큰은 스크립트 속성(PropertiesService)에만 저장되고 시트 · 로그 · 백업 사본에는 남지 않습니다.
> 잃어버리면 이 메뉴에서 다시 볼 수 있고, 유출이 의심되면 웹앱 운영 패널의 **토큰 회전**으로 즉시 교체하세요.

## 6. 웹 앱으로 배포 (40초)

1. 오른쪽 위 **배포 → 새 배포** → 유형 ⚙️ → **웹 앱**.
2. 설명: `ContentHub M1 API`
3. **다음 사용자로 실행**: `나`
4. **액세스 권한**: **모든 사용자** ← 이게 아니면 웹앱에서 호출이 막힙니다(익명 POST).
5. **배포** → **웹 앱 URL**(`https://script.google.com/macros/s/AKfy…/exec`) 복사.

> 배포는 반드시 **버전 지정**으로. 코드를 고친 뒤에는 **배포 관리 → 편집 → 새 버전**으로 올리면
> URL은 그대로 유지됩니다. 저장만 하고 배포를 안 하면 옛 코드가 계속 돕니다.

## 7. 웹앱에 연결 (20초)

1. <https://s2ongrae.github.io/content-hub/> 접속 → 상단 **⚙︎**.
2. **Web App URL** 에 `/exec` 주소, **API 토큰** 에 5단계 토큰 입력.
3. **연결 테스트** → 아래처럼 나오면 끝:

```
✓ 연결 성공
시트 23개 (누락 0)
브랜드 daejeon_youth, ppiyak_kimmary
payload 폴더 준비됨
토큰 SET
백업 기록 없음
```

4. **저장**. 상단 점이 초록(실서버)으로 바뀌고, 연결 전 안내 배너가 사라집니다.

## 8. 첫 데이터 만들기

1. **운영 → 콜드스타트 온보딩** → 훅 6 · 포맷 2 · 플레이스 3 · 키워드 5 시드 + 2주 캘린더 10건(DRAFT).
   이미 콘텐츠가 있으면 건너뜁니다(멱등).
2. **운영 → 지금 백업** → Drive `ContentHubOS_Backups/daily` 에 `SNAPSHOT_MANUAL_…` 확인.
3. 시트 `System_Health` 에 `BACKUP_MANUAL / SUCCESS` 1행이 생겼는지 확인.

---

## 배포 직후 5분 점검 (수동)

| 확인 | 방법 | 기대 결과 |
|---|---|---|
| 살아 있나 | 브라우저로 `/exec` 열기 | `{"ok":true,"action":"liveness","data":{"alive":true,…}}` |
| 인증 | 토큰 없이 POST | `ERR_UNAUTHORIZED` |
| GET 토큰 거부 | `/exec?auth_token=…` | `ERR_GET_TOKEN_FORBIDDEN` |
| 백업 | 운영 → 지금 백업 | `백업 완료 · 파일 N개` |
| 무결성 | 운영 → 무결성 점검 | `Integrity_Logs` 에 1행 |
| 복구 2단 확인 | 운영 → 복구(문구 틀리게) | 취소 · `ERR_VALIDATION_FAILED` |
| 모바일 승인 | 폰 375px 에서 승인 1탭 | 목록에서 사라지고 `Contents.status=READY`, `Checklist_Runs` 1행 |

## 자주 막히는 곳

| 증상 | 원인 · 해결 |
|---|---|
| `ERR_BAD_RESPONSE` | 배포 액세스가 "모든 사용자"가 아님 / 저장만 하고 **새 버전 배포**를 안 함 |
| `ERR_UNAUTHORIZED` | 토큰 오타 · 회전 후 옛 토큰. 5단계에서 다시 복사 |
| `ERR_SERVER_CONFIG` | Setup 미실행(폴더 · 토큰 없음). 4단계 재실행 |
| `시트 누락 N` | Setup 실행 후 새로고침. `sheets_missing` 목록을 보고 4단계 재실행 |
| 백업이 매번 `PARTIAL_CONTINUE` | payload 80개 배치 한도. 5분 뒤 이어하기 트리거가 이어서 마무리합니다 |
| 폰에서 승인이 `ERR_TOS_REVIEW_REQUIRED` | 검수 체크리스트 80점 미만. 검수 화면에서 먼저 통과 |
| 오프라인 저장이 계속 남음 | 하단 결과/토스트 확인. `ERR_UNAUTHORIZED`면 재시도하지 않고 큐에 남깁니다 |

## 운영 규칙 (지켜 주세요)

- 스프레드시트 · payload 폴더 · 백업 폴더는 **비공개**. 공개 공유가 감지되면 `Integrity_Logs` 에 CRITICAL 로 남습니다.
- `/exec` URL · 토큰은 **저장소 · 블로그 · 캡처에 올리지 않습니다**. 저장소에는 코드만 있습니다.
- 계정 비밀번호 · 쿠키 · 2FA 코드는 어디에도 저장 금지(서버가 거부). 캡차 · 2FA는 `NEEDS_HUMAN`.
- 복구는 원본을 덮어쓰지 않고 `RESTORED_…` 사본을 만듭니다. 복구 직전 안전 스냅샷이 자동으로 하나 더 생깁니다.

## 이미 운영 중인 시트에 새 컬럼만 더하기 (2026-11-16)

`Contents`가 29 → 35컬럼으로 늘었습니다(`series_id`·`episode_no`·`hook_variant`·`ig_feed_status`·`ig_feed_url`·`ig_carousel_count`).
이미 쓰는 시트는 **오른쪽 끝에 6칸만 덧붙이면** 되고, 기존 행은 건드리지 않습니다.

1. `Contents` 시트에서 AC 다음(AD)에 6칸을 넣고 1행에 위 6개 이름을 그대로 적습니다(또는 `gog sheets insert … cols 29 --after --count 6`).
2. 앱의 **보드 → 카드 상세**에서 새 항목이 보이면 읽기는 끝난 것입니다.
3. 새 컬럼에 **값을 쓰려면** `gas/Code.gs`를 다시 붙여넣고 **배포 → 배포 관리 → 편집 → 새 버전**까지 올려야 합니다(이 단계 전에는 읽기 전용).
