# 상품 링크 → 숏폼 (v1)

2026-11-24. 제미니 고정방(콘텐츠 허브 프로젝트 관리) 확정안 + 실측을 옮긴 문서.
사용자 지시: "상품 링크만 줘도 숏츠 영상 만들어주고 그러기도 하게 툴을 만들더라? 이것도 제미니랑 기획하고 개발해보자."

## 0. 결론

**상품 URL 하나로 ① 사실 카드 ② 5비트 대본 ③ 설명란 5블록까지 자동**, 렌더는 기존 `content_render` 파이프라인을 그대로 쓴다.
새 오더 타입·유료 API·새 서버는 만들지 않는다.

| 단계 | 무엇 | 어디 |
|---|---|---|
| ① 링크 | URL 검사(https·허용 몰 8곳) | `js/productShorts.js normalizeProductUrl` |
| ② 추출 | GAS가 JSON-LD/og를 펴서 사실표로 | `gas/Product.gs handleProductFetch_` (`product_fetch`) |
| ②-폴백 | 막히면 사람이 3칸(상품명·가격·소구점) | `js/productView.js` |
| ③ 대본 | 5비트(hook→info→build→climax→payoff) 토큰 0 생성 | `js/productShorts.js productScript` |
| ④ 설명란 | 5블록 + 제휴 표기(행동유도 다음·해시태그 앞) | `descriptionBlocks` |
| ⑤ 렌더 | 사실표를 스튜디오 재료로 옮겨 기존 영상 파이프라인 | `factsToMaterials` → `#/create/video` |

## 1. 왜 3단 추출인가 (실측)

2026-11-24 실측:
- 스마트스토어 상세에는 **JSON-LD `Product`** 가 있다 — name·image·category·offers.price·availability. og:title/og:image/og:description도 있다. DOM에 평점 4.86·리뷰 2,554건·정가 298,100→227,100원·무료배송.
- **서버 IP로는 막힌다**: 봇 차단으로 naver 429, 무신사·올리브영·오늘의집·쿠팡 403. → GAS `product_fetch` 는 성공하면 자동, 막히면 `ERR_PRODUCT_BLOCKED` 로 **분명히 실패**하고 화면이 3칸으로 넘어간다(빈 값으로 조용히 넘기지 않는다).
- 다음 단계(2차 경로): 집 노트북 Playwright(실사용 Chrome·주거 IP)로 같은 사실표를 채우는 오더 — `hub-agent/lib/product_extract.js`, `content_draft` `format:'product'` 확장으로 붙인다(4계층 수정 최소).

## 2. 대본 규칙 (토큰 0)

- 5비트 비율은 `hub-agent/lib/story.js` 와 같다: 훅 15% · 정보 25% · 빌드업 25% · 클라이맥스 25% · 결론 10%.
- **페이지에 없는 숫자는 쓰지 않는다.** 가격이 없으면 정보 비트는 "가격 미확인", 할인율은 정가·판매가가 둘 다 있을 때만 계산.
- 훅은 질문형 우선(`{종류} 이거 실화?`), 보조 글자 6자 이내.
- 마지막 자막은 반드시 한 줄 결론(payoff) — 장면 인사·마무리 중계 금지(2026-11-23 지적).

## 3. 법·표시

- 상품 링크 숏폼은 **제휴 표기**가 기본: "본 영상에는 제휴 링크가 포함될 수 있으며, 구매 시 일정 수수료를 받을 수 있습니다."
- 위치: 설명란 5블록의 **행동 유도 다음, 해시태그 앞**.
- **제휴 표기와 내돈내산 문구는 동시에 쓰지 않는다**(블로그 운영정책·표시광고법 — `docs/BLOG_NATIVE_FEATURES_v1.md` §1).

## 4. 아직 (다음 오더)

1. **노트북 추출기**(2차 경로): `product_extract.js` + `content_draft format:'product'` — Playwright 없으면 `BLOCKED: NEED playwright` 로 끝나고 화면은 3칸 유지.
2. **이미지 자동 적재**: 지금은 자동 추출한 이미지 *주소*만 보여 준다. 렌더에 쓰려면 `inbox/<content_id>/1.jpg…` 로 저장돼야 한다(노트북 추출기가 그 일을 한다).
3. **카드 연결**: `#/create/product` → 스튜디오로 재료를 넘긴 뒤, 대본 AI(`content_draft`)에 `format:'product'` 로 상품 사실을 함께 보내는 분기.

## 5. 시험

`node test/run.js` — `[P] 상품 링크 → 숏폼` 24항목(URL 검사·사실 정규화·5비트·설명란·재료 변환·렌더 게이트) + GAS `product_fetch` 12항목(파싱·429/403·도메인 거부·빈 링크).
