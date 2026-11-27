/**
 * js/cardExport.js — 카드뉴스 PNG 여러 장 저장 (2026-11-27, 카드뉴스 2단계)
 *
 * 왜 만들었나 (docs/IG_CARD_NEWS_v1.md §8 · cue2 설계 Q-20261127-180332-v9ou)
 *  · 지금까지는 5~8장을 한 번에 연달아 내려받았다. 아이폰 사파리는 짧은 시간에 여러 파일을
 *    받으면 첫 장만 저장되는 사례가 보고돼 있어(실기기 확인은 아직 못 함), 장 사이에 간격을 두고
 *    순서대로 저장한다. 새 라이브러리(zip) 없이 지금 쓰는 canvas PNG 저장만 다시 쓴다.
 *  · 저장이 막혀도 막다른 길이 아니게: 한 장이 실패해도 나머지를 계속 저장하고,
 *    화면은 "카드마다 [저장]" 폴백을 늘 함께 보여 준다.
 *  · 브라우저가 실제로 저장했는지는 알 수 없다(다운로드 차단은 조용히 일어난다).
 *    그래서 결과는 '시도 결과'로만 말하고, 확인하지 못한 것은 문구에서 단정하지 않는다.
 *
 * 이 파일은 DOM 을 직접 만지지 않는다 — 그리기·저장 함수를 인자로 받는다(노드 시험 가능).
 */

/** 기본 간격(ms) — 실기기 확인 전 시험값이다. 확정 동작으로 약속하지 않는다. */
export const CARD_EXPORT_GAP_MS = 900;
export const CARD_EXPORT_GAP_MIN_MS = 400;
export const CARD_EXPORT_GAP_MAX_MS = 2500;
/** 인스타 카드뉴스 초안은 3~8장이다(gas/IgCardDraft.gs). 그 위는 받지 않는다. */
export const CARD_EXPORT_MAX = 8;

/** 간격 값 정리 — 모르는 값은 기본, 너무 짧거나 길면 경계로 맞춘다. */
export function exportGapMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return CARD_EXPORT_GAP_MS;
  return Math.min(CARD_EXPORT_GAP_MAX_MS, Math.max(CARD_EXPORT_GAP_MIN_MS, Math.round(n)));
}

/** 아이폰·아이패드 사파리인가(문구를 더 분명히 하기 위해서만 쓴다). */
export function isIosLike(ua) {
  const s = String(ua == null ? '' : ua);
  if (!s) return false;
  if (/iPhone|iPad|iPod/i.test(s)) return true;
  // 최근 아이패드 사파리는 Macintosh 로 보인다 — 터치가 있으면 아이패드로 본다.
  return /Macintosh/i.test(s) && /Mobile/i.test(s) && !/Chrome/i.test(s);
}

/** 저장 버튼 위에 붙는 안내 — 무엇을 하는지 + 막혔을 때 무엇을 누르는지. */
export function exportHintText(count, opts) {
  const n = Math.max(0, Number(count) || 0);
  const head = n > 0 ? '카드 ' + n + '장을 차례로 저장합니다' : '카드를 차례로 저장합니다';
  const tail = (opts && opts.ios)
    ? '아이폰 사파리는 여러 장이 한 번에 저장되지 않을 수 있어요 — 안 되면 카드마다 [저장]을 눌러 주세요.'
    : '브라우저가 여러 장 저장을 막으면 카드마다 [저장]을 눌러 주세요.';
  return head + ' — ' + tail;
}

/** 진행 표시 — '저장 중 2/5' */
export function exportProgressText(index, total) {
  const t = Math.max(0, Number(total) || 0);
  if (!t) return '저장 중';
  const i = Math.min(t, Math.max(1, Number(index) || 1));
  return '저장 중 ' + i + '/' + t;
}

/** 결과 한 줄 — 시도한 것만 말하고, 저장 여부는 브라우저가 확인해 주지 못한다는 것을 전제로 쓴다. */
export function exportResultText(result) {
  const r = result || {};
  const total = Math.max(0, Number(r.total) || 0);
  const saved = Math.max(0, Number(r.saved) || 0);
  const failed = Array.isArray(r.failed) ? r.failed.length : 0;
  if (!total) return '저장할 카드가 없어요';
  if (!saved) return '카드 ' + total + '장을 저장하지 못했어요 — 브라우저를 확인하거나 카드마다 [저장]을 눌러 주세요';
  if (failed) return '카드 ' + saved + '장을 저장했어요 — ' + failed + '장은 막혔습니다. 카드마다 [저장]을 눌러 주세요';
  if (r.cancelled) return '카드 ' + saved + '장을 저장했어요 (중간에 멈춤)';
  return '카드 ' + saved + '장을 모두 저장했어요';
}

/** 기다리기 — 시험에서는 갈아 끼운다. */
function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/**
 * 카드 여러 장을 순서대로 저장한다.
 *
 * options
 *   cards       [{ no, name, ... }]  저장할 카드(이름은 화면에서 만든 파일 이름)
 *   render      async (card, i) => Blob|null   카드 한 장을 PNG 로
 *   save        (blob, name) => boolean        다운로드 시작(지금 쓰는 downloadBlob)
 *   gapMs       장 사이 간격(기본 900ms, 경계 400~2500)
 *   wait        (ms) => Promise  기본 setTimeout — 시험이 갈아 끼운다
 *   onProgress  ({ index, total, no, name, status, saved, failed }) => void
 *   isCancelled () => boolean    중간에 그만두기
 *
 * 반환: { total, saved, failed:[{no,name,reason}], stopped, cancelled, gapMs }
 *   reason: 'render'(카드를 그리지 못함) | 'save'(다운로드가 시작되지 않음) | 'over-limit'
 */
export async function saveCardsInOrder(options) {
  const o = options || {};
  const list = Array.isArray(o.cards) ? o.cards : [];
  const gapMs = exportGapMs(o.gapMs);
  const wait = typeof o.wait === 'function' ? o.wait : defaultWait;
  const render = typeof o.render === 'function' ? o.render : null;
  const save = typeof o.save === 'function' ? o.save : null;
  const progress = typeof o.onProgress === 'function' ? o.onProgress : null;
  const cancelled = typeof o.isCancelled === 'function' ? o.isCancelled : null;

  const cards = list.slice(0, CARD_EXPORT_MAX);
  const result = {
    total: cards.length, saved: 0, failed: [], stopped: false, cancelled: false,
    gapMs: gapMs, skipped: Math.max(0, list.length - cards.length)
  };
  if (!render || !save) { result.stopped = true; return result; }
  if (result.skipped) {
    for (let i = cards.length; i < list.length; i++) {
      result.failed.push({ no: (list[i] || {}).no, name: (list[i] || {}).name || '', reason: 'over-limit' });
    }
  }

  for (let i = 0; i < cards.length; i++) {
    if (cancelled && cancelled()) { result.cancelled = true; result.stopped = true; break; }
    const card = cards[i] || {};
    const name = String(card.name || '');
    let blob = null;
    try { blob = await render(card, i); } catch (e) { blob = null; }
    let status = '';
    if (!blob) {
      status = 'render';
      result.failed.push({ no: card.no, name: name, reason: 'render' });
    } else {
      let saved = false;
      try { saved = save(blob, name) !== false; } catch (e) { saved = false; }
      if (saved) result.saved += 1;
      else { status = 'save'; result.failed.push({ no: card.no, name: name, reason: 'save' }); }
    }
    if (progress) {
      progress({
        index: i + 1, total: cards.length, no: card.no, name: name,
        status: status || 'saved', saved: result.saved, failed: result.failed.length
      });
    }
    // 다음 장을 받기 전에 쉬어 준다(마지막 장·중간 취소 뒤에는 기다리지 않는다).
    if (i < cards.length - 1) {
      if (cancelled && cancelled()) { result.cancelled = true; result.stopped = true; break; }
      await wait(gapMs);
    }
  }
  return result;
}
