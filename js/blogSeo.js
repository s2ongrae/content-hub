/**
 * js/blogSeo.js — '오늘의 추천 제목 10' 화면 계산 (화면 없이 시험할 수 있게 따로 둔다)
 *
 * 서버(gas/BlogSeo.gs)가 아침에 만든 줄을 화면에 맞게 다듬고,
 * 제목을 눌렀을 때 초안 스튜디오(#/create/blog)로 넘길 씨앗(시드)을 만든다.
 *
 * 지키는 것
 *  · 숫자는 서버가 준 것만 쓴다(화면에서 다시 계산해 다른 말을 하지 않는다).
 *  · 데이터랩 값은 '그 키워드 안에서의 상대지수'라 키워드끼리 크기를 비교하지 않는다 → 증감률·성수기만 말한다.
 *  · 시드는 sessionStorage 에 잠깐만 둔다(새 탭에 남지 않게). 저장이 막힌 브라우저에서는 이 모듈의 기억으로 넘긴다.
 */

const SEED_KEY = 'contenthub.seoSeed.v1';
const SEED_VERSION = 1;

/** 카드에 보이는 2자 배지 — 서버가 준 긴 이름을 화면 폭에 맞게 줄인다. */
const AXIS_SHORT = { food: '맛집', life: '생활', store: '재테크', cat: '반려묘' };

export function axisShort(axis) {
  return AXIS_SHORT[String(axis || '')] || String(axis || '').slice(0, 4);
}

/** ▲+28% / ▼−12% / 그대로 / 표본 적음 / — */
export function trendChip(row) {
  if (!row) return '—';
  const state = String(row.trend_state || '');
  if (state === '표본 적음' || state === '표본 없음') return state;
  const n = Number(row.trend_pct);
  if (row.trend_pct == null || row.trend_pct === '' || !Number.isFinite(n)) return '—';
  if (n === 0) return '그대로';
  const v = Math.round(Math.abs(n));
  return (n > 0 ? '▲+' : '▼−') + v + '%';
}

/** 오르는지 내리는지 — 색을 고르는 데 쓴다 */
export function trendTone(row) {
  const n = Number(row && row.trend_pct);
  if (!row || row.trend_pct == null || !Number.isFinite(n)) return '';
  if (n >= 15) return ' up';
  if (n <= -15) return ' down';
  return '';
}

/** 내 14위 / 신규 */
export function rankChip(row) {
  const r = Number(row && row.my_rank);
  return r >= 1 ? '내 ' + r + '위' : '신규';
}

/** 문서 12만 — 경쟁 강도(네이버 블로그 검색 결과 수) */
export function docChip(row) {
  const n = Number(row && row.doc_total);
  if (!row || row.doc_total == null || !Number.isFinite(n) || n <= 0) return '';
  if (n >= 10000) return '문서 ' + Math.round(n / 10000) + '만';
  return '문서 ' + n;
}

/** 360px 에서 카드가 길어지지 않게 처음엔 4줄(축별 1위), 나머지는 펼쳐서 본다. */
export const FIRST_COUNT = 4;
export function splitRows(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  return { first: list.slice(0, FIRST_COUNT), rest: list.slice(FIRST_COUNT) };
}

/** 제목 길이 — 모바일 목록에서 잘리지 않는 18~34자 */
export const TITLE_MIN = 18;
export const TITLE_MAX = 34;
export function titleLen(title) {
  const n = Array.from(String(title || '')).length;
  return { len: n, ok: n >= TITLE_MIN && n <= TITLE_MAX, over: n > TITLE_MAX };
}

/** 축별 메모 뼈대 — 서버가 준 axes 를 그대로 쓴다 */
export function skeletonText(axes, axis) {
  const a = axes && axes[axis];
  if (!a || !Array.isArray(a.skeleton) || !a.skeleton.length) return '';
  return a.skeleton.join('\n');
}

/* ───────────── 초안 스튜디오로 넘기는 씨앗 ───────────── */

let memorySeed = null;

function storage() {
  try {
    return (typeof window !== 'undefined' && window.sessionStorage) ? window.sessionStorage : null;
  } catch (e) { return null; }
}

export function makeSeoSeed(row, axes, day) {
  if (!row || !row.title) return null;
  return {
    v: SEED_VERSION,
    day: String(day || row.day || ''),
    title: String(row.title),
    keyword: String(row.keyword || ''),
    axis: String(row.axis || ''),
    axis_label: String(row.axis_label || ''),
    skeleton: skeletonText(axes, row.axis)
  };
}

export function putSeoSeed(seed) {
  const s = seed && typeof seed === 'object' ? seed : null;
  memorySeed = s;
  const st = storage();
  if (!st) return !!s;
  try {
    if (s) st.setItem(SEED_KEY, JSON.stringify(s));
    else st.removeItem(SEED_KEY);
    return true;
  } catch (e) { return !!s; }
}

/** 지우지 않고 보기만 — 스튜디오가 다시 그려져도 씨앗이 남아 있게. */
export function peekSeoSeed() {
  if (memorySeed) return normalizeSeed(memorySeed);
  const st = storage();
  if (!st) return null;
  try {
    const raw = st.getItem(SEED_KEY);
    if (!raw) return null;
    return normalizeSeed(JSON.parse(raw));
  } catch (e) { return null; }
}

export function clearSeoSeed() {
  memorySeed = null;
  const st = storage();
  if (!st) return;
  try { st.removeItem(SEED_KEY); } catch (e) { /* 저장소가 막혀도 화면은 산다 */ }
}

export function normalizeSeed(raw) {
  const s = raw && typeof raw === 'object' ? raw : null;
  if (!s) return null;
  const title = String(s.title || '').trim().slice(0, 120);
  if (!title) return null;
  return {
    v: SEED_VERSION,
    day: String(s.day || '').slice(0, 10),
    title: title,
    keyword: String(s.keyword || '').trim().slice(0, 40),
    axis: String(s.axis || '').slice(0, 20),
    axis_label: String(s.axis_label || '').slice(0, 30),
    skeleton: String(s.skeleton || '').slice(0, 400)
  };
}
