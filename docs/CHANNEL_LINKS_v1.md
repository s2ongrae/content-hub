# 4채널 발행 링크 — 기록·가드레일·시트 규칙 v1 (2026-11-26)

keyring 보고(Q-20261126-133433-06n9) 중 **4채널 기록·무결성** 항목의 구현 설명.
클립·유튜브(쇼츠)·인스타(릴스)·블로그에 올린 뒤 **주소를 시트에 적는 일**이 사람 손에 남아 있어,
① 주소만 붙여넣으면 채널을 알아서 고르고 ② '전 채널 발행 완료'를 누를 때 빈 채널을 먼저 알리고
③ 링크가 4채널 모두 찼을 때만 상태를 올리는 규칙을 넣었다.

## 1. 규칙은 한 곳 — `js/channelLinks.js` + `gas/Setup.gs`

| 채널 | 주소 열 | 상태 열 | 통과하는 주소 |
|---|---|---|---|
| 블로그 | `blog_url` | `blog_status` | `blog.naver.com/<아이디>/<글번호>`, `blog.naver.com/PostView.naver…`, `m.blog.naver.com` |
| 쇼츠 | `shorts_url` | `shorts_status` | `youtube.com/shorts/<id>`, `youtu.be/<id>`, `youtube.com/watch?v=<id>`, `m.youtube.com` |
| 릴스 | `reels_url` | `reels_status` | `instagram.com/reel/<code>`, `instagram.com/reels/<code>` |
| 클립 | `clip_url` | `clip_status` | `clip.naver.com/…` (발급 주소가 `/info`·`/shorts` 등으로 갈려 호스트만 본다) |

* 프론트 `LINK_RULES`(js)와 GAS `CONTENT_LINK_RULES`(gas)는 **같은 호스트·같은 정규식**이다.
  `test/run.js [13]` 이 두 구현을 주소 표로 대조한다 — 한쪽만 고치면 시험이 깨진다.
* 인스타 `instagram.com/p/…` 는 피드(카드뉴스) 주소로 본다. 인스타는 트랙 A 만 운영한다.
* 주소를 적는 대상은 **트랙 채널 중 `SKIPPED` 를 뺀 것**이다(김메리는 3채널).

## 2. 화면에서 하는 일

1. **여러 링크 한 번에** — 상세 → 성과 탭 → `4채널 링크 넣기` 접이식 상자에 주소를 줄 단위로 붙여넣고
   `[링크 넣기]`. 도메인으로 채널을 고르고, 같은 채널이 두 번 나오면 첫 줄만 쓰며,
   못 읽은 줄은 저장하지 않고 개수를 알려 준다.
2. **한 채널씩** — 채널 타일마다 `주소` 입력줄. 그 채널 주소가 아니면(예: 릴스 칸에 쇼츠 주소)
   저장하지 않고 어느 채널 주소인지 알려 준다.
3. **저장하면 상태도 남는다** — `*_status` 가 비어 있으면 `UPLOADED`(올림)로 함께 적는다.
   이미 올린 상태(`PUBLISHED`·`LINKED` 등)는 **내리지 않는다**.
4. **기록 미완료 배지** — 발행된 카드인데 채널 기록·주소가 비면
   상세 채널 줄에 `기록 미완료 N`, 보드 카드에 `기록 미완료 · 쇼츠(주소 없음)` 한 줄.
5. **발행 완료 가드레일** — `발행 완료로 넘기기`(상세·다음 할 일의 `[정리하기]`)를 누르면
   빈 채널 목록을 모달로 보여 준다. `[주소 넣으러 가기]` 또는 `[그래도 넘기기]`.
   * 넘기는 선택은 막지 않는다 — 사람이 알고 넘기는 경우가 있다.
   * 서버도 같은 판정을 한다: `status:'LINKED'` 에 기록이 비어 있으면 `ERR_LINK_INCOMPLETE`,
     `confirm_incomplete:true` 를 같이 보내야 통과한다(노트북·스크립트가 직접 부를 때도 같은 규칙).

## 3. 시트 쪽 규칙 (사람이 메뉴에서 누를 때만)

`ContentHub OS` 메뉴 → **5. 4채널 링크 규칙 적용**

* `blog_url`·`shorts_url`·`reels_url`·`clip_url` 열에 데이터 유효성 규칙
  `=OR(ISBLANK(<열>2),REGEXMATCH(TO_TEXT(<열>2),"<정규식>"))`
  — 빈 칸은 통과(아직 안 올린 채널), 값이 있으면 그 채널 주소만 통과. `allowInvalid=true` 라
  **이미 잘못 적힌 값을 지우지 않고 경고만** 남긴다.
* 조건부 서식 — 상태가 `PUBLISHED`/`LINKED` 인데 4채널 주소 중 하나라도 비면 그 행을 노랗게.

`ContentHub OS` 메뉴 → **6. 4채널 링크 점검 → 일부 발행을 발행으로**

* `syncPublishStatus_` — 4채널 주소가 **모두 찬** `PUBLISHING` 행만 `PUBLISHED` 로 올린다.
  내리는 일은 없고(DRAFT·REVIEW·LINKED 는 그대로), 기록이 모자란 행은 이유만 보고한다.
* 트리거로 자동 실행하지 않는다 — 시트 값을 말없이 바꾸지 않기 위해 메뉴에서만 돈다.

## 4. 응답·호환성

* `list_contents` 가 `blog_url`·`shorts_url`·`reels_url`·`clip_url` 도 함께 준다(추가 필드).
  보드 카드 배지가 목록만으로 판정할 수 있게 하기 위해서다.
* `update_content` 응답에 `link_audit` 이 붙는다(추가 필드) — 화면이 같은 판정을 다시 계산하지 않아도 된다.
* 시트 열은 **늘리지 않았다**(`SHEET_SCHEMAS` 그대로). 실제 시트 40칸과 어긋나지 않는다.

## 5. 시험

* `test/run.js [13]` — 채널 감지·여러 줄 파싱·중복·저장 patch·기록 점검·가드·GAS 대조·유효성 규칙 정의·
  상태 승격(dryRun)·화면 정적 확인.
* `gas/test/run.js [8m]` — 실제 핸들러로 `LINKED` 가드레일(거절 → `confirm_incomplete` 통과 →
  4채널이 찬 카드 통과 → 같은 요청에 주소를 실어 보내면 통과).
