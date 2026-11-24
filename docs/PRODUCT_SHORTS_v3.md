# 상품 링크 → 클립 (v3) — 공식 문구 · 트랙 · 12시간 중복 억제

2026-11-24. `docs/PRODUCT_SHORTS_v2.md`(링크 → 이미지 자동 수집) 위에 얹은 **v3 P1 세 가지**.
근거: `downloads/네이버클립_쇼핑커넥트_수익화_기획안_20261124.md` §2·§3·§9 (사용자 "진행해" 승인).

## 0. 결론

| 항목 | 전 | 후 (v3) |
|---|---|---|
| 대가성 문구 | `AFFILIATE_NOTICE` 한 문장을 설명란에 삽입 | **클립 공식 문장 `SC_NOTICE_CLIP`** 을 따로 두고 **첫 고정댓글**로 분리. 설명란 본문에는 넣지 않는다(위치 위반 방지) |
| 트랙 | 없음 | 카드·오더에 `track: 'challenge' \| 'commerce'`. 대본 마지막 자막·설명란 CTA·해시태그·필수/금지 안내가 트랙을 따른다 |
| 중복 | 같은 링크를 누를 때마다 새로 수집 | 같은 `(brand + url)` 을 **12시간** 안에 다시 요청하면 오더를 만들지 않고 **기존 카드**로 안내. 강제 재수집은 `force:true` 하나 |

## 1. 클립 공식 대가성 문구

```js
SC_NOTICE_CLIP = '이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.'
```

- **한 글자도 바꾸지 않는다.** 변형("수수료를 받을 수 있습니다"), 본문 중간·해시태그 사이 배치, 맨 끝 배치는 모두 가이드 위반이다(브랜드커넥트 「링크 삽입 가이드: 클립 편」, 고객센터 24394).
- 위치는 **첫 번째 고정댓글**. 본문 첫 부분 `[광고]` 는 2025.12 부터 태그 부착 시 자동 표시되므로 설명란에 넣지 않는다. 안 보이면 사람이 첫 줄에 직접 넣는다(화면이 그렇게 안내한다).
- `AFFILIATE_NOTICE`("본 영상에는 제휴 링크가…")는 **블로그·자체 표기용**으로 남긴다. 클립 수익화 트랙 설명란에는 쓰지 않는다.
- `내돈내산` 과 동시 출력 금지 규칙은 그대로다(표시광고법·블로그 운영정책). 트랙 검사(`trackWarnings`)가 수익화 트랙에서 이 조합을 잡는다.

코드
- `js/productShorts.js` — `SC_NOTICE_CLIP`, `AFFILIATE_NOTICE`, `descriptionBlocks({track})` → `{ text, notice, pinned_comment, ad_label, warnings }`
- `hub-agent/notebook-agent/lib/product_shots.js` — 같은 문장·같은 규칙(노트북이 만든 카드도 같은 문구)
- 카드 저장 위치 `studio.formats.video.draft.pinned_comment` (기획안 §9 P1 데이터 필드)
- 화면 `#/create/product` 결과 패널·대본 패널에 **[고정댓글 문구 복사]** 버튼(v3). 스튜디오(`#/create/video?card=…`)도 카드의 draft 를 먼저 읽어 같은 버튼을 보여 준다.

## 2. 트랙 A/B

| | A `challenge` | B `commerce` (기본) |
|---|---|---|
| 해시태그 1번 | `#오늘클립챌린지` | 상품명(띄어쓰기 제거) |
| 필수 | `#오늘클립챌린지` · 내용에 맞는 정보 태그 1개 이상 · 전체공개 | 쇼핑커넥트 상품 태그 1개(동영상) · 첫 고정댓글 공식 문구 · `[광고]`(자동) |
| 금지 | 쇼핑커넥트 상품 태그 | `#오늘클립챌린지` · `내돈내산` |
| 마지막 자막(payoff) | 결론(값 판단) | **행동 한 줄** "상품 태그 확인" |
| 설명란 행동 2줄 | 댓글·저장 안내 | 댓글·"상품 태그 확인하고 조건 비교해 보세요" |
| 고정댓글 | 없음(협찬이면 본문 맨 앞에 대가 표기) | `SC_NOTICE_CLIP` |

- 트랙 값은 `studio.product.track` 에 저장하고 `product_extract` payload 로 노트북까지 간다(허브 GAS `track` 허용 키).
- 모르는 값은 **수익화로 떨어뜨린다**(문구를 빠뜨리는 쪽이 더 위험하다).
- `trackWarnings({track, text, pinned})` — 금지 조합이 있으면 문장으로 알린다(화면 '트랙 검사' 패널).
- 챌린지 트랙이 공식 미션으로 집계되려면 **정보 태그**가 필요하다. 해시태그만으로는 인정되지 않는다(고객센터 25051). 화면은 그 사실만 안내하고, 태그 부착은 사람이 클립 에디터에서 한다.

## 3. 12시간 중복 억제

같은 `(brand + url)` — 정규화 주소(쿼리·해시·끝 슬래시 제거)의 FNV-1a 32bit 해시 `url_hash` — 을 12시간 안에 다시 요청하면 **새로 받지 않는다**.

세 겹으로 막는다(같은 규칙, 같은 해시).

| 층 | 무엇을 막나 | 실패했을 때 |
|---|---|---|
| 화면 `js/productView.js` | 브라우저 기록(`localStorage contenthub.product.dedup.v1`)으로 오더를 만들기 전에 막고 기존 카드로 안내 | 서버가 최종 판단 |
| 허브 GAS `gas/Orders.gs` | 오더 생성 시 스크립트 속성 색인(`PRODUCT_DEDUP_INDEX`, 최근 80건)으로 막고 `ERR_PRODUCT_DUPLICATE` + 기존 `card_id`·`collected_at`·남은 분 | 오더를 만들지 않는다 |
| 노트북 `lib/product_extract.js` | 같은 카드에 이미 받아 둔 상품(사진 1장 이상, 12시간 안)이면 네트워크를 열지 않고 `reused:true` 로 DONE | 오더가 다른 길로 와도 중복 실행 없음 |

- 강제 재수집은 **`force:true`** 하나뿐이다. 화면에는 [강제로 다시 수집] 버튼이 있고, 사진이 바뀌었거나 앞 수집이 모자랐을 때 쓴다.
- 앞 수집이 **사진 0장**이면 중복으로 보지 않고 다시 받는다(빈 카드가 12시간 묶이면 안 된다).
- 남는 카드 필드: `studio.product.url_hash`, `collected_at`, `track`, `image_files`.
- 색인은 시트를 훑지 않는다(스크립트 속성 JSON 한 칸). 12시간이 지난 기록은 읽을 때·쓸 때 버린다.

## 4. 카드에 쓰는 것 (v2 + v3)

```
studio.product = { …사실표, url, host, image_files, source,
                   track:'challenge'|'commerce', url_hash, collected_at }
studio.formats.video.draft = { captions, narration, script, hook, hook_sub, description,
                               pinned_comment, track, ad_label, source:'product_extract' }
production     = { images, captions, narration, script, hook, hook_sub, description, from:'product_extract' }
```

`update_content` + `patch_mode:'deep'` — 다른 포맷·다른 키는 건드리지 않는다(v2 그대로).

## 5. 시험

- `content-hub`: `node test/run.js` — `[P] 상품 링크 → 숏폼` v3 추가(공식 문장 일치·트랙 규칙·설명란 분리·중복 경계 11:59/12:00·오더 필드·화면 검사).
- `content-hub/gas/test/run.js` — `[8k]` 중복이면 `ERR_PRODUCT_DUPLICATE` + 기존 카드, `force` 통과, 쿼리 달라도 같은 상품, 다른 브랜드는 따로, 12시간 뒤 통과, 색인 정리.
- `hub-agent`: `node test/run.js` — `test/product.js` v3 23항목(문구·트랙·카드 필드·해시·중복 재사용/force/만료/사진 0장).

## 6. 남은 것

1. **실제 몰 스모크**(v2 §10-1 그대로) — 집 노트북에서 `playwright-core` 로 무신사·올리브영 1건씩.
2. **트랙별 업로드 체크**는 아직 사람 몫이다 — 고정댓글은 클립 앱에서 직접 달아야 하고, 화면은 문구를 복사해 줄 뿐 올리지 않는다.
3. 쇼핑커넥트 **실적**(클릭·주문·수수료)은 P3(`Commerce_Stats`) 전까지 수동 기록이다. 이 문서는 실적 수집을 다루지 않는다.
