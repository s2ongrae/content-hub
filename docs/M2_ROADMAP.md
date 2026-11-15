# M2 로드맵 — 시리즈·키워드팩·훅 A/B (2026-11-15 반영분)

> 이 문서는 **M2에서 서버(GAS)와 시트가 받아야 할 것**과, **이번에 프론트에서 먼저 끝낸 것**을 구분해 적는다.
> 시드 원본: `seeds/series_pack_2026w47.json` · 화면: `js/seriesView.js`(`#/series`) · 문서: `downloads/콘텐츠허브_시리즈10편_키워드팩.md`

---

## 1. 이번 반영(프론트 완료 · 배포됨)

| 항목 | 내용 | 파일 |
|---|---|---|
| 시리즈 10편 시드 | 2 시리즈 × 5편. 제목·커버·첫 2초 훅/자막·20초 대본(구간/화면/자막/소리)·해시태그 5·크로스 포인트·팩트 슬롯·다음 할 일 | `seeds/series_pack_2026w47.json` |
| 키워드팩 | 네이버 자동완성 22개 질의 실측, 클러스터 7개, 제목 공식 3종. **검색량 수치는 쓰지 않음** | 같은 파일 `keyword_pack` |
| 훅 A/B | 발행 전 체크리스트 11항(편별 localStorage 저장) + A/B 설계·지표·판정 규칙 | 같은 파일 `hook_ab` |
| 화면 | `#/series` — 시리즈(아코디언 상세 · 대본 복사 · **취재 보드에 DRAFT 생성**), 키워드팩, 훅 A/B | `js/seriesView.js` |
| 연결 장치 | 배지 N/5 · 중반 위치 앵커 · 숨긴 단서(오픈 루프) · 고정댓글 선택 질문 · 루프 | 시드 `connection` |
| 문서 | 위 시드에서 자동 생성(문서·앱이 어긋나지 않게) | `tools/render_series_pack.py` |

**왜 서버 없이 먼저 했나**: 시드는 읽기 전용 정적 JSON이라 GAS 배포·쿼터 없이도 폰에서 바로 열린다. 10편은 자주 바뀌지 않고(주 2~3편), 매번 시트를 왕복할 이유가 없다.

---

## 2. 서버(M2)에서 받아야 할 것

### 2-1. 스키마 추가 (Contents 29 → 32컬럼)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `series_id` | string | `SY-DY-01` / `SY-KM-01` |
| `episode_no` | number | 1~5 |
| `hook_variant` | string | `PROOF_FIRST` / `GAIN_LOSS` / `COVER_MATCH` / `SERIES_TEASE` |

> PRD v2 §4.1의 29컬럼에 3개만 더한다. `series_id + episode_no`로 시리즈 진행률(발행 n/5)을 시트에서 바로 센다.

### 2-2. 액션

| 액션 | 상태 | 내용 |
|---|---|---|
| `upsert_keyword` | M1 `ERR_NOT_IMPLEMENTED` | `keyword_pack`의 클러스터·키워드·자동완성 실측값을 `Keywords` 시트에 적재. `captured_at`을 함께 저장해 "언제 조회한 값인지" 남긴다 |
| `seed_series_pack` | **신규 제안** | `seeds/series_pack_2026w47.json`을 받아 Contents 10건(DRAFT) + Hooks + Formats에 멱등 적재(`pack_id` 플래그) |
| `record_same_age_metric` | M3 예정 | `hook_variant`별 24h/72h/7d 지표를 붙여 훅 유형 비교가 가능하게 |
| `log_rank` | M3 예정 | 블로그 글 발행 후 `봉명동 술집` 등 타깃 키워드 순위 기록 |

### 2-3. 품질 게이트(QualityGate)에 추가할 규칙

발행 전 린터 F2의 S1~S8에 **3개만** 더한다(전부 코드로 판정 가능):

1. `hook_subtitle` 1줄이 12자(한글 기준) 이내인가 — 초과 시 WARN
2. 커버 문구와 첫 2초 자막의 **숫자 집합이 같은가**(예: 커버 `69,466` ↔ 자막 `69,466`) — 다르면 FAIL
3. `series_id`가 있으면 `episode_no`와 `total`이 채워졌는가 — 없으면 FAIL
4. `fact_slots`가 남아 있는데 `status=READY`인가 — 남아 있으면 `ERR_TOS_REVIEW_REQUIRED` 후보(팩트 미확정 발행 차단)

---

## 3. 다음 순서 (권장)

1. **이번 주**: 시드대로 EP2·EP3 촬영 → 발행 → 훅 체크리스트를 폰에서 채우며 첫 3초 잔존율 기록.
2. **W48**: `upsert_keyword` 구현 → 키워드팩을 시트로 옮기고, 블로그 글 발행 시 타깃 키워드 순위를 `log_rank`로 기록.
3. **W49**: `seed_series_pack` 구현 → 새 시리즈(예: G80 유지비 5편)를 JSON만 추가하면 앱·시트가 같이 갱신되게.
4. **W50**: 10편 지표가 쌓이면 `record_same_age_metric`으로 **훅 유형별 3초 잔존율** 비교표를 만들고, 이기고 있는 훅 유형을 다음 시리즈 기본값으로 승격.

---

## 4. 유지보수 규칙

- 시리즈를 고칠 때는 **JSON → 렌더러 실행** 순서만 지킨다. 문서를 직접 고치면 앱과 어긋난다.
  ```
  python3 tools/render_series_pack.py            # 기본 출력: ../downloads/콘텐츠허브_시리즈10편_키워드팩.md
  python3 tools/render_series_pack.py --out /tmp/check.md
  ```
- 시드에 **토큰·계정·고객 실명·전화번호를 넣지 않는다**(공개 저장소다). 팩트 슬롯은 `[ ]`로 비워 둔다.
- 시리즈 JSON은 공개 페이지에서 `fetch`로 읽히므로, 공개되면 곤란한 값(영수증 이미지 URL, 계정 캡처)은 넣지 않는다.
