/**
 * js/clipboard.js — 복사 버튼 한 곳 (2026-11-26)
 *
 * 같은 일을 하는 copyText/copyButton 이 여섯 곳에 흩어져 있었고, 실패 문구·폴백 방식이 조금씩 달랐다.
 *  · navigator.clipboard 가 있으면 먼저 쓰고, 막히면(권한·http·구형) textarea + execCommand 로 한 번 더.
 *  · 모든 경우에 사용자에게 결과를 알린다(조용히 실패하지 않는다).
 * 문구는 부르는 쪽이 바꿀 수 있다(opts.okText / opts.failText).
 */

function okMessage(o) {
  if (o.okText) return o.okText;
  return (o.label || '복사') + ' 완료';
}

function failMessage(o) {
  return o.failText || '복사에 실패했습니다 — 길게 눌러 선택하세요';
}

function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = String(text);
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

/**
 * 글자를 클립보드로. opts 는 문자열(라벨) 또는 { label, okText, failText }.
 * toast(message, kind) 는 각 화면의 토스트.
 */
export function copyText(text, toast, opts = {}) {
  const o = typeof opts === 'string' ? { label: opts } : (opts || {});
  const done = () => toast(okMessage(o), 'ok');
  const fail = () => toast(failMessage(o), 'err');
  const fallback = () => (legacyCopy(text) ? done() : fail());

  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      navigator.clipboard.writeText(String(text)).then(done, fallback);
      return;
    } catch (e) { /* 아래 폴백 */ }
  }
  fallback();
}

/** 복사 버튼 하나 — h 는 화면의 createElement 도우미. */
export function copyButton(h, text, toast, opts = {}) {
  const o = typeof opts === 'string' ? { label: opts } : (opts || {});
  return h('button', {
    class: 'ghost-btn sm', type: 'button',
    text: '⧉ ' + (o.buttonText || o.label || '복사'),
    onclick: () => copyText(text, toast, o)
  });
}
