/**
 * js/wrapKo.js — 한국어 의미 단위 줄바꿈 (2026-11-23, 성래 님 v5 지적)
 *
 * "자막 줄바꿈도 이상하고" — 기존 허브 검사는 글자 수만 봤다.
 * 이 파일은 노트북 hub-agent/notebook-agent/lib/wrap_ko.js 와 **같은 규칙**이다
 * (한쪽만 바꾸면 허브는 통과·노트북은 WARN 이 된다). 시험 test/run.js [줄바꿈] 이 두 구현을 같은 표본으로 대조한다.
 *
 * 규칙
 *   ① 어절(공백) 단위로만 나눈다. 낱말 중간은 자르지 않는다.
 *   ② 의존명사·보조용언은 줄 첫머리에 홀로 서지 않는다(예: "대기 / 중" 금지).
 *   ③ 둘째 줄이 4자 미만인 고아 줄을 피한다.
 *   ④ 문장은 고치지 않는다 — 줄바꿈만 한다.
 */

export const NO_START = [
  '중', '것', '거', '건', '걸', '게', '수', '줄', '때', '데', '듯', '만큼', '뿐', '채', '척', '김', '터', '판', '법', '양', '체',
  '나름', '지경', '대로', '때문', '적', '바', '지', '등', '및', '쪽', '간', '후', '전', '내', '외', '위', '아래',
  '앞', '뒤', '옆', '안', '밖', '사이', '동안', '부터', '까지', '보다', '처럼', '만', '조차', '마저', '밖에',
  '이나', '나', '든지', '이든', '든', '이랑', '랑', '하고', '이라도', '라도', '이라고', '라고', '이라', '라',
  '이라는', '라는', '이라서', '라서', '이므로', '므로', '이라면', '라면', '이며', '며', '이면', '면', '이고',
  '이지만', '지만', '는데', '은데', '다', '요', '죠', '네요', '거든', '거든요', '는데요'
];
const NO_START_SET = new Set(NO_START);
const PUNCT_ONLY = /^[?!.,~…·、。！？]+$/;

function core(token) {
  return String(token == null ? '' : token)
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '');
}

/** 이 어절이 줄 첫머리에 서면 안 되는가. */
export function isNoStart(token) {
  const c = core(token);
  if (!c) return true;
  return NO_START_SET.has(c);
}

/** 글 → 어절 그룹 [{text, spaceBefore}] (문장부호만 있는 어절은 앞에 붙인다). */
export function group(text) {
  const clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const out = [];
  let spaceBefore = false;
  clean.split(' ').forEach((w) => {
    if (!w) return;
    if (out.length && !spaceBefore && PUNCT_ONLY.test(w)) { out[out.length - 1].text += w; return; }
    out.push({ text: w, spaceBefore: spaceBefore });
    spaceBefore = true;
  });
  return out;
}

export function lengthOf(groups) {
  return groups.reduce((a, g, i) => a + g.text.length + (i > 0 && g.spaceBefore ? 1 : 0), 0);
}

/** 두 줄로 끊는 자리(그룹 수) — 없으면 -1. */
export function chooseBreak(groups, cpl) {
  const n = groups ? groups.length : 0;
  if (n < 2) return -1;
  const limit = Number(cpl) > 0 ? Number(cpl) : 12;
  let best = -1, bestScore = Infinity;
  for (let i = 1; i < n; i++) {
    const left = lengthOf(groups.slice(0, i));
    const right = lengthOf(groups.slice(i));
    if (left > limit || right > limit) continue;
    let score = Math.abs(left - right);
    if (isNoStart(groups[i].text)) score += 100;
    if (right < 4) score += 40;
    if (score < bestScore) { best = i; bestScore = score; }
  }
  return best;
}

export function wrapGroups(groups, cpl, maxLines) {
  const list = (groups || []).slice();
  const limit = Number(cpl) > 0 ? Number(cpl) : 12;
  const max = Math.max(1, Number(maxLines) || 2);
  if (!list.length) return [];
  if (list.length === 1 || lengthOf(list) <= limit) return [list];
  const lines = [];
  let rest = list;
  while (rest.length > 1 && lines.length < max - 1) {
    const cut = chooseBreak(rest, limit);
    if (cut <= 0 || cut >= rest.length) break;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length) lines.push(rest);
  return lines;
}

export function wrapText(text, cpl, maxLines, hardSplit) {
  const limit = Number(cpl) > 0 ? Number(cpl) : 12;
  const groups = group(text);
  if (!groups.length) return [];
  if (groups.length === 1 && groups[0].text.length > limit && hardSplit !== false) {
    const chars = groups[0].text;
    const out = [];
    for (let i = 0; i < chars.length && out.length < Math.max(1, Number(maxLines) || 2); i += limit) out.push(chars.slice(i, i + limit));
    return out;
  }
  return wrapGroups(groups, limit, maxLines).map((line) => line.map((g, i) => (i > 0 && g.spaceBefore ? ' ' : '') + g.text).join(''));
}

/** 나뉜 줄들의 문제 — [{line, code:'orphan_start'|'short_tail'|'over_cpl', token, msg}] */
export function lintLines(lines, cpl, opts) {
  const limit = Number(cpl) > 0 ? Number(cpl) : 12;
  const o = opts || {};
  const list = Array.isArray(lines) ? lines.map((l) => String(l == null ? '' : l)) : [];
  const issues = [];
  list.forEach((line, i) => {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (i > 0 && words.length && isNoStart(words[0])) {
      issues.push({ line: i + 1, code: 'orphan_start', token: words[0], msg: (i + 1) + '번째 줄이 "' + words[0] + '"로 시작해요 — 앞 낱말과 붙여 주세요' });
    }
    if (line.length > limit) issues.push({ line: i + 1, code: 'over_cpl', token: '', msg: (i + 1) + '번째 줄이 ' + line.length + '자예요(최대 ' + limit + '자)' });
  });
  if (o.shortTail !== false && list.length === 2 && list[0].trim() && list[1].trim().length < 4) {
    issues.push({ line: 2, code: 'short_tail', token: list[1].trim(), msg: '둘째 줄이 "' + list[1].trim() + '" 하나만 남았어요 — 앞 줄에서 낱말을 내려 주세요' });
  }
  return issues;
}
