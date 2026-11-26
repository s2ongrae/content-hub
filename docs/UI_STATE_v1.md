# 화면 공통 실패·기다림 안내 v1 (2026-11-26)

같은 실패가 화면마다 다른 말로 나오고, 어떤 곳은 `ERR_NETWORK` 같은 코드가 그대로 보였습니다.
로딩 표시도 `불러오는 중…` · `읽는 중…` · `확인 중…` 이 제각각이었고, 버튼을 잠갔다 푸는 코드를
화면마다 손으로 써서 실패 뒤 원래 글자를 잃는 곳도 있었습니다. 복사 버튼도 여섯 벌이었습니다.

이제 문장·패널·버튼 잠금·복사는 아래 두 모듈만 씁니다.

| 파일 | 하는 일 |
|---|---|
| `js/uiState.js` | 오류 코드 → 사람 말, `[다시 시도]` 판단, 기다림/실패 패널, 버튼 잠금(`withBusy`) |
| `js/clipboard.js` | 복사(`copyText` · `copyButton`) — 클립보드 API 가 막히면 textarea 로 한 번 더 |

## 규칙

1. **코드(ERR_XXX)는 화면에 쓰지 않는다.** 코드는 `title` 툴팁(`오류 코드: ERR_…`)과 console 에만 남긴다.
2. **같은 실패는 같은 문장.** 새 코드를 쓰는 기능을 만들면 `ERROR_SENTENCE` 에 문장을 넣는다.
   넣지 않아도 코드가 노출되지는 않는다 — 서버가 준 사유 → 일반 안내 순서로 내려간다.
3. **서버가 사유를 준 입력 오류는 서버 문장을 그대로** 쓴다(`ERR_VALIDATION_FAILED` 등). 사람이 고칠 수 있는 말이라서.
4. **`[다시 시도]` 는 다시 눌러 결과가 달라질 수 있는 실패에만** 붙인다.
   * 붙는다: `ERR_NETWORK` · `ERR_OFFLINE` · `ERR_TIMEOUT` · `ERR_BUSY` · `ERR_RATE_LIMITED` · `ERR_QUOTA_EXCEEDED` · 5xx
   * 붙지 않는다: 입력 오류 · 권한(`ERR_UNAUTHORIZED`) · 미배포(`ERR_NOT_IMPLEMENTED` 등) · `ERR_NOT_FOUND`
   * 예외: 시드 파일처럼 **파일을 다시 받아 오는** 화면은 `forceRetry: true`.
5. **미배포 코드는 재배포 안내로.** `ERR_NOT_IMPLEMENTED` · `ERR_UNKNOWN_ACTION` · `ERR_INVALID_ACTION` ·
   `ERR_ACTION_NOT_ALLOWED` · `ERR_SERVER_CONFIG` 는 "서버 업데이트가 필요해요" 로 묶고, 어느 `.gs` 인지는 `hint` 로 알린다.
6. **기다림은 `loadingPanel`**, **실패는 `errorPanel`** — 둘 다 `role`(`status`/`alert`)·`aria-live` 를 스스로 단다.
7. **버튼 잠금은 `withBusy(btn, '저장 중…', fn)`** — 성공·실패 모두 원래 글자로 돌아오고, 오류는 그대로 다시 던진다.
   결과를 기다리는 동안 글자를 남겨야 하는 화면(오더 접수 — 결과 기다리는 중)은 예외로 직접 쓴다.

## 쓰는 법

```js
import { loadingPanel, errorPanel, friendlyError, isDeployGap, withBusy } from './uiState.js?v=20261126a';

host.appendChild(loadingPanel(h, '목록을 불러오는 중이에요…'));

try {
  const res = await api.listContents({});
  …
} catch (err) {
  host.replaceChildren(errorPanel(h, err, {
    title: '목록을 불러오지 못했어요',
    hint: isDeployGap(err) ? 'gas/Blog.gs 를 배포하면 켜집니다.' : '',
    onRetry: () => ctx.renderRoute()
  }));
}

// 토스트 한 줄
toast(friendlyError(err), 'err');

// 저장 버튼
await withBusy(btn, '저장 중…', async () => { await api.updateContent(patch); toast('저장했어요', 'ok'); });
```

## API 요청 쪽 (js/api.js)

* 오프라인이면(`navigator.onLine === false`) fetch 전에 `ERR_OFFLINE` 으로 멈춘다 — 30초 타임아웃을 기다리지 않는다.
* 서버가 `details.retry_after_ms` 를 주면 그 간격으로 재시도한다(최대 8초). 없으면 기존 0.8 → 1.6 → 3.2초.
* 재시도 대상은 그대로다: `ERR_BUSY` · `ERR_RATE_LIMITED` · `ERR_QUOTA_EXCEEDED` · 5xx 3회. 입력·권한 오류는 재시도하지 않는다.

## 시험

`node test/run.js` 의 `[18] 공통 실패·기다림 안내` (48건):

* 문장: 코드가 문장에 없음 · 같은 실패는 같은 문장 · 서버 사유 우선 · 빈 값은 빈 문장 · 표에 문장 없는 코드도 안전
* 분류: 미배포 4별칭 · 재시도 여/부 · 제목(입력·연결) · 스튜디오 짧은 문구 3종
* 패널: `role`/`aria-live`/`aria-busy` · `[다시 시도]` 클릭 1회 · 입력 오류엔 버튼 없음 · `forceRetry` · `hint`/`extra`
* 잠금: 진행 중 disabled + 글자 + aria-busy · 성공/실패 뒤 원래 글자 · 동기 함수
* 복사: 성공 · 클립보드 거절 → textarea 폴백 · 끝내 실패하면 실패를 알림
* 승인 탭 실전(가짜 DOM): 실패 시 코드 대신 사유 + `[다시 시도]` → 누르면 목록이 채워짐 · 승인 실패도 같은 말
* 정적: app.js 가 자기 표를 버렸는지 · 화면마다 표/복사 구현이 다시 생기지 않았는지 · 쓰지 않는 import 0건 · import 경로 실재
