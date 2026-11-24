# 상품 링크 → 이미지 자동 수집 → 숏폼 (v2)

2026-11-24. v1(`4f7626c`, `docs/PRODUCT_SHORTS_v1.md`)의 빈 칸을 채운 문서.
사용자 지적: **"상품 링크 주면 거기 있는 이미지 읽어서 자동으로 만들어주고 해야지 내가 사진을 넣어야 해?"**

## 0. 결론

링크 하나로 ① 사실표 ② **이미지 1~6장 자동 수집·리사이즈·적재** ③ 5비트 대본·설명란 ④ 카드 저장 ⑤ (선택) 렌더 예약까지 간다.
사람이 사진을 올리던 자리는 없어졌다 — 사진이 5장 이상 모이면 [바로 숏츠 만들기]가 렌더 오더까지 넣는다(렌더는 승인 뒤 실행).

| 단계 | 무엇 | 어디 |
|---|---|---|
| ① 링크 | URL 검사(https·허용 몰 9곳) | `js/productShorts.js normalizeProductUrl` |
| ② 1차 추출 | 서버가 JSON-LD/og를 펴서 사실표 | `gas/Product.gs handleProductFetch_` (`product_fetch`) |
| ②-2차 | **집 노트북이 주거 IP로 HTTP** → 같은 해석 규칙 | `hub-agent/lib/product_page.js` + `product_extract.js fetchHtml` |
| ②-3차 | **실사용 Chrome**(playwright-core, channel:'chrome')으로 JS 렌더·lazy 이미지 | `product_extract.js fetchWithBrowser` |
| ②-폴백 | 그래도 막히면 사람 3칸(상품명·가격·소구점) | `js/productView.js` |
| ③ 이미지 | 최대 6장 · 장변 1,080 · JPEG q85 → `1.jpg`~`6.jpg` | `product_extract.js collectImages` |
| ④ 대본 | 5비트(hook→info→build→climax→payoff) 토큰 0 | `hub-agent/lib/product_shots.js` (허브 규칙과 동일) |
| ⑤ 카드 | `studio.product`·`media`·`formats.video.draft`·`production` | `product_extract.js buildCardPatch → update_content(deep)` |
| ⑥ 렌더 | 사진 5장 이상이면 `content_render` 예약(HIGH·승인) | `product_extract.js` + `gas.enqueue` |

## 1. 왜 3단 추출인가 (실측)

2026-11-24 v1 실측: 스마트스토어 상세에 JSON-LD `Product`(name·image·offers.price·aggregateRating)가 있고
DOM 에 평점 4.86·리뷰 2,554·정가 298,100→227,100원이 있다. 그런데 **서버 IP로는 막힌다** —
naver 429, 무신사·올리브영·오늘의집·쿠팡 403.

그래서 순서를 이렇게 둔다.

1. GAS 가 성공하면 그 사실·이미지 주소를 **오더에 실어** 보낸다 → 노트북은 브라우저를 열지 않고 이미지만 받는다(가장 빠름).
2. GAS 가 막히면 노트북이 **주거 IP**로 평범한 HTTPS GET 을 한다 — 데이터센터 IP 차단은 여기서 풀린다.
3. 그것도 안 되면(자바스크립트 렌더·안티봇) 설치된 Chrome 으로 연다. `playwright-core` 가 없으면 **있는 척하지 않고**
   `playwright-core 없음 — npm i playwright-core` 를 결과에 남긴다.

이미지 CDN(shop-phinf.pstatic.net 등)은 보통 IP 를 가리지 않는다 — 사실표만 확보되면 사진은 잘 받힌다.

## 2. 오더 계약 — `product_extract`

새 오더 타입 하나(LOW·멱등·needsWorkspace false). v1 확정안은 `content_draft format:'product'` 확장이었지만,
`content_draft` 는 **텍스트 전용**(원문 블록 해시·AI 엔진)이라 이미지 다운로드·드라이브 업로드·카드 사진 쓰기를 얹으면
그 계약이 흐려진다. 새 타입은 화이트리스트 **두 곳**(`hub-agent/gas/CommandQueue.gs`·`content-hub/gas/Orders.gs`)만 늘린다 —
새 키를 네 계층에 흩는 것이 아니라서 v1 확정안의 우려(키 1개 = 4곳 수정)와 다르다.

```json
{
  "type": "product_extract",
  "content_id": "DY-20261124-001",
  "brand": "daejeon_youth",
  "url": "https://smartstore.naver.com/…/products/…",
  "facts": { "name": "…", "price": 227100, "original_price": 298100, "rating": 4.86, "reviews": 2554,
             "shipping": "무료배송", "category": "주얼리", "key_points": ["…", "…"] },
  "images": ["https://shop-phinf.pstatic.net/…jpg", "…"],
  "max_images": 6,
  "seconds": 20,
  "auto_render": true
}
```

- `facts`·`images` 는 **힌트**다. 없어도 된다(노트북이 링크로 다시 읽는다).
- 큐 payload 3,500자를 넘으면 허브 GAS 가 `facts` → `images` 순으로 빼고 링크만 보낸다(조용히 다른 상품을 만들지 않는다).
- 허용 몰은 `gas/Product.gs PRODUCT_ALLOWED_HOSTS_` 한 곳(9곳: 스마트스토어·브랜드스토어·무신사·올리브영·오늘의집·쿠팡·naver.me).
- 이미지 주소는 **https 만**, 12개까지(실제로 받는 것은 `max_images` 1~6장).

## 3. 이미지 규약

| 항목 | 값 | 이유 |
|---|---|---|
| 장수 | 1~6장(`max_images`) | 숏폼 20초에 5~6컷이면 충분. 렌더 최소는 5장(kenburns MIN_IMAGES) |
| 크기 | 장변 1,080px | 1080×1920 캔버스에 켄번즈로 들어간다 |
| 형식 | JPEG q85 (`1.jpg`~`6.jpg`) | 렌더의 IMAGE_RE(jpg/png/webp)와 이름 규칙을 맞춘다 |
| 저장 | 로컬 `RENDER_INBOX/<content_id>/` + 허브 드라이브 `ContentHubOS_Uploads/<content_id>/` | 렌더는 `upload_video_list/fetch` 로 드라이브 조각을 받아 inbox 에 붙인다 — **이름만 맞으면 그대로 이어진다** |
| 중복 | 같은 사진의 다른 크기·재다운로드는 sha1 로 한 번만 | 상세 페이지는 같은 컷을 여러 크기로 반복한다 |
| 제외 | 로고·아이콘·평점 배지·리뷰 썸네일·`type=f80_80` 축소본·8KB 미만·20MB 초과·비이미지(content-type/매직넘버) | 아이콘이 첫 컷으로 들어가면 영상이 망가진다 |
| 리사이즈 | ffmpeg(렌더 노트북에 이미 있음) → sharp(있으면) → 원본 | 새 의존을 강제하지 않는다 |
| 다시 돌리면 | 같은 `1.jpg`… 이름을 덮어쓴다 | 사진이 두 벌 쌓이지 않는다(멱등) |

## 4. 카드에 쓰는 것

```
studio.product   = 사실표 + url·host·image_files·collected_at
studio.media     = [{ name:'1.jpg', kind:'photo', role:'대표'|'상세', order:1..N }]
studio.place.name= 상품명
studio.content   = { category, price_menu:'227,100원', memo:'소구점 / 브랜드 / 배송 / 평점' }
studio.concept   = { kind:'review', tone:'plain', hint:'상품 링크 숏폼 — 확인된 사실만' }
studio.formats.video = { length_sec:30, draft:{captions,narration,script,hook,hook_sub,description,source:'product_extract'} }
production       = { images, captions, narration, script, hook, hook_sub, description, from:'product_extract' }
```

`update_content` + `patch_mode:'deep'` — 다른 포맷·남의 동시 편집 키를 덮지 않는다. 버전 충돌은 최신본을 다시 읽어 한 번 더.

## 5. 화면 흐름 (`#/create/product`)

1. 링크 입력 → **[🔎 상품 불러오기]** = GAS 1차(2초). 성공하면 사실 카드가 채워진다.
   막히면: "쇼핑몰이 서버 수집을 막았어요 — [이미지까지 자동 수집]을 누르면 집 노트북(실사용 브라우저)이 대신 읽습니다."
2. **[📸 이미지까지 자동 수집]** = 카드 확보 → `product_extract` 오더 → 15초 폴링.
3. **[🎬 바로 숏츠 만들기]** = 같은 오더에 `auto_render:true`. 사진 5장 이상이면 노트북이 `content_render` 를 예약한다(승인 대기).
4. 결과 패널: 사진 장수·이름, 상품·가격, 5비트 자막 큐, 설명란 5블록 + **[영상 스튜디오 열기]**(`#/create/video?card=…`)·
   **[이 사진으로 렌더 (승인)]**(브라우저가 직접 content_render 오더를 넣는 길도 남겨 둔다).
5. 카드 번호는 브라우저에 남는다 — 다시 눌러도 같은 카드에 덮어쓴다.

## 6. 실패·폴백

| 상황 | 결과 | 화면 |
|---|---|---|
| GAS 429/403 | `ERR_PRODUCT_BLOCKED` | "노트북이 대신 읽습니다" 안내(자동 수집 버튼) |
| 노트북 HTTP 403/429 + Chrome 없음 | 오더 FAILED, 사유 `playwright-core 없음` | 3칸 수동 + `npm i playwright-core` 안내 |
| 상품명을 못 찾음 | 오더 FAILED | 3칸 수동 |
| 사실은 됐고 사진 0장 | 오더 DONE(카드·대본 저장), 사진 0장 명시 | "스튜디오에서 사진을 올리면 렌더할 수 있어요" |
| 사진 1~4장 | 렌더 예약 안 함(이유를 결과에 남김) | 렌더 문턱 5장 안내 |
| 렌더 오더 | `content_render` HIGH → 승인 카드(15분) | 승인하면 노트북이 렌더 |

**페이지에 없는 숫자는 쓰지 않는다** — 가격·할인율·평점이 없으면 "미확인", 할인율은 정가·판매가가 둘 다일 때만.

## 7. 법·표시

- 설명란 5블록에 제휴 표기를 **행동 유도 다음·해시태그 앞**에 자동 삽입(허브 `descriptionBlocks` 와 같은 문구·같은 위치).
- `내돈내산` 문구와 동시에 쓰지 않는다(블로그 운영정책·표시광고법 — `docs/BLOG_NATIVE_FEATURES_v1.md` §1).

## 8. 제미니 고정방 기록 (2026-11-24)

방: `3cc80699c40a29c1` (콘텐츠 허브 프로젝트 관리 · 새 방 만들지 않음).
확정받은 것: 3단 추출 · `inbox/<content_id>/1.jpg~6.jpg`(장변 1,080·q85) · 5비트 스키마 · 미확인 숫자 규칙 ·
오더 분할 O1(`lib/product_extract.js`+`draft.js`) / O2(`createStudio.js`+`gas/Orders.gs`).

우리가 바꾼 두 가지(이유를 남긴다):
1. **오더는 새 타입 `product_extract`** — `content_draft format:'product'` 확장 대신. 텍스트 전용 계약(원문 해시·AI 엔진)을
   이미지 IO 와 섞지 않으려고. 화이트리스트는 두 파일만 는다.
2. **비트 이름은 `build`·`payoff`** — 확정안의 `buildup`·`outro` 대신 저장소의 `lib/story.js`·`js/productShorts.js` 와 동일하게.
   렌더·검수·화면이 이미 그 이름을 쓴다. 또 확정안 예시 문구 중 "쓰면서 느낀 핵심 차이" 같은 **페이지에 없는 단언**은 넣지 않았다.

## 9. 시험

- `content-hub`: `node test/run.js` — `[P] 상품 링크 → 숏폼`(v1 25 + v2 13) + GAS `[8k] product_extract` 20여 항목.
- `hub-agent`: `node test/run.js` — `test/product.js` 75항목(파싱·5비트·설명란·payload·deps 주입 실행·렌더 예약·이미지 가드),
  `gas/test/run.js` — 큐 타입·위험도·접수.

## 10. 남은 것

1. **실제 몰 스모크**: 집 노트북에서 `playwright-core` 설치 후 무신사·올리브영 1건씩 실제 수집(403 회피 확인). 서버 IP 로는 확인 불가.
2. **GAS 이미지 직송**: GAS 가 성공한 몰은 이미지도 GAS 가 드라이브에 바로 넣으면 노트북이 아예 필요 없다 — 지금은 노트북이 받는다
   (리사이즈를 GAS 가 못 해서 품질·용량 손해가 있어 보류).
3. **12시간 중복 억제**: 같은 (brand+url) 을 하루에 여러 번 돌리면 매번 새로 받는다(같은 카드면 덮어씀). 필요해지면 카드에 `collected_at` 을 보고 건너뛰게.
