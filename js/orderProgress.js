/**
 * js/orderProgress.js — 오더 6단계 진행 표시 규칙 한 곳 (2026-11-28 · 쇼핑쇼츠 v4 P1-1)
 *
 * 왜 따로 있나
 *   상품 링크 화면(productView)과 제작 스텝퍼(produceView)가 같은 말로 진행을 보여 줘야 한다.
 *   노트북(hub-agent lib/order_progress.js)이 단계가 바뀔 때만 카드(studio.progress)에 남기고,
 *   허브 GAS 의 hub_order_status 가 step_code·step_pct 두 필드로 돌려준다. 이 파일은 계산만 한다(네트워크 없음).
 *
 * 규칙 (제미니 확정안 · 포털 오더 Q-20261128-135325-peeq)
 *   · 단계 고정 매핑: 01 추출 → 02 대본 → 03 세로 → 04 TTS → 05 자막·합성 → 06 커버
 *   · 화면 문구: 'n/6 단계 · pct%'
 *   · 값이 없으면 '진행 전' — 0/100 을 꾸며 내지 않는다(아직 보고가 없다는 뜻이다).
 *   · step_pct 는 "그 단계에 들어설 때 앞 단계까지 끝난 비율" 이다(1/6=0% · 3/6=33% · 6/6=83%).
 */

export const ORDER_STEP_TOTAL = 6;
export const ORDER_STEP_LABELS = Object.freeze({
  '01': '추출', '02': '대본', '03': '세로', '04': 'TTS', '05': '자막·합성', '06': '커버'
});

/** '1' · 1 · '01' → '01'. 1~6 밖이거나 숫자가 아니면 '' (노트북·GAS 와 같은 규칙). */
export function normalizeStepCode(code) {
  const s = String(code == null ? '' : code).trim();
  if (!s) return '';
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > ORDER_STEP_TOTAL) return '';
  return String(n).padStart(2, '0');
}

/** 오더 응답의 두 값 → 화면 한 줄. '3/6 단계 · 33%' / 단계를 모르면 '진행 전'. */
export function stepProgressText(stepCode, stepPct) {
  const id = normalizeStepCode(stepCode);
  if (!id) return '진행 전';
  const n = Number(id);
  const p = (stepPct === null || stepPct === undefined || stepPct === '') ? NaN : Number(stepPct);
  const shown = Number.isFinite(p)
    ? Math.max(0, Math.min(100, Math.round(p)))
    : Math.round(((n - 1) / ORDER_STEP_TOTAL) * 100);
  return n + '/' + ORDER_STEP_TOTAL + ' 단계 · ' + shown + '%';
}

/** 단계 이름('세로' 등) — 모르면 ''. */
export function stepLabel(stepCode) {
  const id = normalizeStepCode(stepCode);
  return id ? (ORDER_STEP_LABELS[id] || '') : '';
}

/** 끝난 오더에는 진행을 붙이지 않는다 — 폴링을 멈추는 상태와 같은 목록. */
export const ORDER_DONE_STATUS = Object.freeze(['DONE', 'FAILED', 'REJECTED', 'EXPIRED', 'TIMEOUT_REVIEW', 'REVIEW_NEEDED']);
export function isOrderDone(status) {
  return ORDER_DONE_STATUS.indexOf(String(status == null ? '' : status).toUpperCase()) >= 0;
}
