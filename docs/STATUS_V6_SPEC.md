# 상태 6단계 · 작성본(임시저장) 계약 — v6 (2026-11-17)

이 문서는 **화면(app.js / draftView.js)** 과 **글을 쓰는 쪽(피클·클로드·노트북 파이프라인)** 이 함께 지키는 약속이다.
시트·GAS 스키마는 그대로다. 새 열도, 새 액션도 없다.

## 1) 상태값 (시트 `Contents.status`)

| 칸 | 라벨 | 코드값 | 들어가는 때 |
|---|---|---|---|
| 1 | 초안 | `DRAFT` | 글감만 적었다. 본문 없음 |
| 2 | 작성 중 | `DRAFTING` (또는 옛 `GENERATING`) | 본문·대본을 쓰는 중 |
| 3 | 확인 대기 | `REVIEW` | 다 썼다. 대표가 읽고 승인할 차례 |
| 4 | 수정 중 | `EDITING` | 반려·수정 지시를 반영하는 중 |
| 5 | 발행 완료 | `READY` → `PUBLISHING` → `PUBLISHED` | 승인 끝. 올리는 중·일부 올라감 포함 |
| 6 | 최종 | `LINKED` | 역링크(고정댓글·본문 링크)까지 끝 |

- `NEEDS_HUMAN`·`PARTIAL_FAIL`은 **단계가 아니라 막힘**이다. 칸에 넣지 않고 보드 위 "사람 손 필요" 띠에 모은다.
- 되돌리기: 막힘을 풀면 `payload.prev_status`(없으면 `REVIEW`)로 돌아간다. 반려(`quickReject`)는 `EDITING`으로 보내고 `prev_status: 'REVIEW'`를 남긴다.
- `READY` 승격 게이트(체크리스트 80점 + 사람 검수)는 그대로다.

## 2) 작성본(payload) 모양

Drive payload JSON의 **채널 키를 그대로** 쓴다: `blog`, `shorts`, `reels`, `ig_feed`, `clip`.
(`ig_feed`는 처음 쓸 때 patch가 키를 만든다.)

```json
{
  "blog": {
    "title": "[대전 봉명동] 미미삼겹 솔직후기",
    "body": "첫 문단…\n\n두 번째 문단…",
    "hashtags": ["#대전맛집", "#봉명동"],
    "draft_url": "https://blog.naver.com/GoBlogWrite.naver",
    "updated_at": "2026-11-17T16:10:00+09:00",
    "note": "대표 요청: 첫 문단에 결론 먼저"
  }
}
```

- `body`는 문단 구분을 빈 줄(`\n\n`)로 둔다. 화면이 문단으로 나눠 보여 준다.
- `draft_url`은 **선택**. 없으면 [본문 복사]만 보인다.

## 3) 글을 넣는 방법 (API 그대로)

```js
// 1) 최신 버전을 먼저 읽는다
const d = await api.getContentDetail(contentId);      // d.data.version
// 2) 채널 키 하나를 통째로 바꾼다(최상위 키 교체)
await api.updateContent({
  content_id: contentId,
  expected_version: d.data.version,
  patch: { blog: { title, body, hashtags, draft_url, updated_at: new Date().toISOString() } },
  status: 'REVIEW'                                     // 다 썼으면 확인 대기로
});
```

- `patch`는 **최상위 키 단위 교체**다. `blog`를 넣을 때 그 안의 이전 값은 사라지므로 항상 완전한 객체를 보낸다.
- `expected_version`이 어긋나면 `ERR_VERSION_CONFLICT`가 난다. 다시 읽고 재시도한다.
- 화면에서 직접 넣을 수도 있다: 카드 → `작성본` 탭 → [작성본 넣기].

## 4) 임시저장 링크의 실제 사정

| 채널 | 링크 | 비고 |
|---|---|---|
| 네이버 블로그 | `https://blog.naver.com/GoBlogWrite.naver` | 임시저장 **글 하나**의 고유 URL은 없다. 글쓰기 화면을 열고 저장 버튼 옆 숫자(임시저장 목록)에서 고른다. `draft_url`에는 글쓰기 화면이나 블로그 주소를 넣는다 |
| 유튜브 쇼츠 | `https://studio.youtube.com/video/{VIDEO_ID}/edit` | 초안도 영상 ID가 있다. **PC 전용**(폰 크롬에서는 스튜디오가 안 열린다) |
| 인스타 릴스·피드 | 없음 | 초안은 앱 안에만 있다. 화면은 [본문 복사]로 대신한다 |
| 네이버 클립 | `https://clipcreators.naver.com/web` | 업로드 화면까지만 |

그래서 폰에서는 **링크보다 복사가 실제로 쓰인다**. 화면의 기본 버튼이 [본문 복사]인 이유다.

## 5) 화면이 하는 일

- 카드 상세 탭: `작성본` · `분석` · `원문·메타`. 초안·작성 중·확인 대기·수정 중 카드는 `작성본`으로 바로 열린다.
- `작성본`: 채널 칩(작성본 있는 채널에 ●), 제목·저장시각·글자수, 본문 문단, 해시태그, [본문 복사] [임시저장 열기] [작성본 넣기/고치기].
- 상태 버튼: `확인 대기로 보내기`(초안·작성 중·수정 중) / `고칠 점 적기`(확인 대기 → 수정 중, 한 줄 메모) / `막힘 풀기`(막힘 → 원래 단계).
- 승인 화면(빠른 승인): 카드마다 상세를 한 번 읽어 본문 첫 3줄과 타깃 키워드를 보여 준다(최대 3장).

## 6) 검증

```bash
node tools/patch_v6.js     # PATCHED … / ALREADY (두 번 돌려도 안전)
```
배포 뒤: `https://s2ongrae.github.io/content-hub/` 에서 카드 → `작성본` 탭 → [작성본 넣기] → 저장 → 보드 새로고침.
