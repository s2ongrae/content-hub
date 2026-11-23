/**
 * js/igAudit.js — 인스타 계정 100점 진단 (2026-11-23)
 *
 * 근거
 *  · 인스타 @reelbuilder_ 릴스(DfOXiNqztFp) — '클로드 인스타 마케터'가 보여 준 프로필 점수 화면
 *    (바이오 변경 추천 · 하이라이트 제작 필요 · 피드 그리드 3일 이내 업로드 · 프로필 링크 없음 → 16점)
 *  · 제미니 새 방 「성래 님 콘텐츠 시스템 기획 확정」(2026-11-23) 2) 1순위 — "#/perf 인스타 탭에 진단 스코어 카드"
 *  · 우리 판단: 프로필을 자동으로 긁지 않는다(약관·세션 위험). 사람이 확인한 값만 넣고 기계적으로 채점한다.
 *    게시 주기·편수는 자동 수집 행(js/analyticsView.js)이 있으면 그 값으로 미리 채워 준다.
 *
 * 규칙·가중치는 seeds/ig_audit_rules.json 한 곳에서 온다(웹앱·시험 공용).
 * 점수 = (얻은 점수 합 / 그 트랙 항목의 가중치 합) × 100 — 트랙 B(피드 없음)는 캐러셀 항목을 빼고 환산한다.
 *
 * 쓰는 법
 *   import { auditInstagram, renderInstagramAudit } from './igAudit.js';
 *   const r = auditInstagram({ brand:'daejeon_youth', bio:'…', linkKind:'blog', highlights:3, lastPostDays:2 }, rules);
 *   // r = { score, grade, label, items:[…], todo:[…], usedWeight }
 */

const STORE_KEY = 'contenthub.ig_audit.v1';

/** 시드 파일을 못 읽어도 화면이 돌도록 두는 기본값(시드와 같은 값). */
export const IG_AUDIT_DEFAULTS = {
  version: '2026w52',
  grades: [
    { min: 90, grade: 'A', label: '그대로 밀어도 됩니다' },
    { min: 75, grade: 'B', label: '한 두 곳만 고치면 됩니다' },
    { min: 60, grade: 'C', label: '구멍이 보입니다' },
    { min: 0, grade: 'D', label: '프로필부터 손봐야 합니다' }
  ],
  tracks: {
    daejeon_youth: { account: '@daejeon_daily', role: '대전 맛집 카드뉴스·릴스',
      bioKeywords: ['대전', '유성', '맛집', '술상', '청년'],
      items: ['upload_7d', 'volume_30d', 'bio', 'link', 'highlights', 'hook', 'first_comment', 'carousel'] },
    ppiyak_kimmary: { account: '@m2ow.mari', role: '메리 릴스 전용 (피드 사진 없음)',
      bioKeywords: ['메리', '고양이', '집사', '냥'],
      items: ['upload_7d', 'volume_30d', 'bio', 'link', 'highlights', 'hook', 'first_comment'] }
  },
  items: [
    { id: 'upload_7d', label: '최근 7일 안에 릴스 1편', weight: 16, fix: '오늘 올릴 소재 하나를 정해 릴스를 먼저 올리세요.' },
    { id: 'volume_30d', label: '30일 안에 릴스 4편', weight: 10, fix: '한 소재를 릴스·쇼츠·클립으로 나눠 3편을 채우세요.' },
    { id: 'bio', label: '바이오에 지역·정체 + 링크 문구', weight: 14, fix: '첫 줄에 무엇을 하는 계정인지와 지역을 넣으세요.' },
    { id: 'link', label: '프로필 링크', weight: 12, fix: '프로필 링크를 블로그나 스레드로 걸어 두세요.' },
    { id: 'highlights', label: '하이라이트 3개', weight: 10, fix: '메뉴·주차·웨이팅 주제로 하이라이트를 3개 만드세요.' },
    { id: 'hook', label: '캡션 첫 줄 후킹', weight: 12, fix: '첫 줄을 질문이나 숫자로 바꾸세요.' },
    { id: 'first_comment', label: '첫 댓글에 링크·해시태그', weight: 10, fix: '해시태그와 블로그 주소를 첫 댓글에 넣으세요.' },
    { id: 'carousel', label: '피드 캐러셀 운영 (대전 청년만)', weight: 8, fix: '블로그 글을 5~8장 카드뉴스로 만들어 올리세요.' }
  ]
};

const STATE_LABEL = { pass: '통과', near: '주의', warn: '고칠 것' };

/** 시드의 rules 객체를 받아 항목 정의·트랙을 채운다. 일부만 와도 기본값으로 메운다. */
export function resolveIgRules(cfg) {
  const c = Object.assign({}, IG_AUDIT_DEFAULTS, cfg || {});
  if (!Array.isArray(c.items) || !c.items.length) c.items = IG_AUDIT_DEFAULTS.items;
  if (!Array.isArray(c.grades) || !c.grades.length) c.grades = IG_AUDIT_DEFAULTS.grades;
  c.tracks = Object.assign({}, IG_AUDIT_DEFAULTS.tracks, (cfg && cfg.tracks) || {});
  Object.keys(IG_AUDIT_DEFAULTS.tracks).forEach((k) => {
    c.tracks[k] = Object.assign({}, IG_AUDIT_DEFAULTS.tracks[k], (cfg && cfg.tracks && cfg.tracks[k]) || {});
  });
  return c;
}

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const hasAny = (text, words) => (words || []).some((w) => w && String(text).indexOf(w) >= 0);

/** 항목 하나의 판정 — 기계적으로 셀 수 있는 값만 본다. */
function judgeItem(id, m, track) {
  const kw = track.bioKeywords || [];
  if (id === 'upload_7d') {
    const d = num(m.lastPostDays);
    if (d == null) return { state: 'near', value: '모름', note: '마지막 릴스가 며칠 전인지 넣으면 판정합니다' };
    if (d <= 7) return { state: 'pass', value: d + '일 전', note: '일주일 안에 올렸습니다' };
    if (d <= 14) return { state: 'near', value: d + '일 전', note: '2주 안이지만 7일을 넘겼습니다' };
    return { state: 'warn', value: d + '일 전', note: '2주 넘게 쉬었습니다 — 추천이 식습니다' };
  }
  if (id === 'volume_30d') {
    const n = num(m.reels30);
    if (n == null) return { state: 'near', value: '모름', note: '30일 안에 올린 릴스 편수를 넣으면 판정합니다' };
    if (n >= 4) return { state: 'pass', value: n + '편', note: '한 달 4편 이상 — 꾸준합니다' };
    if (n >= 2) return { state: 'near', value: n + '편', note: '권장 4편보다 적습니다' };
    return { state: 'warn', value: n + '편', note: '한 달에 1편 이하면 계정이 잠깁니다' };
  }
  if (id === 'bio') {
    const s = String(m.bio == null ? '' : m.bio).replace(/\s+/g, ' ').trim();
    const len = [...s].length;
    if (!len) return { state: 'warn', value: '비어 있음', note: '바이오가 비어 있습니다' };
    const ok = hasAny(s, kw);
    if (len <= 80 && ok) return { state: 'pass', value: len + '자 · 키워드 있음', note: '첫 화면에서 정체가 보입니다' };
    if (len > 80) return { state: 'warn', value: len + '자', note: '80자를 넘어 잘립니다 — 줄이세요' };
    return { state: 'near', value: len + '자 · 키워드 없음', note: '지역·정체 키워드(' + kw.slice(0, 3).join('·') + ')를 넣으세요' };
  }
  if (id === 'link') {
    const k = String(m.linkKind || '');
    if (k === 'blog' || k === 'threads' || k === 'youtube') return { state: 'pass', value: k, note: '프로필에서 바로 넘어갈 곳이 있습니다' };
    if (k === 'other') return { state: 'near', value: '링크만 있음', note: '블로그나 스레드로 바꾸세요' };
    return { state: 'warn', value: '없음', note: '프로필 링크가 없습니다 — 인스타 앱에서만 고칠 수 있습니다' };
  }
  if (id === 'highlights') {
    const n = num(m.highlights);
    if (n == null) return { state: 'near', value: '모름', note: '하이라이트 개수를 넣으면 판정합니다' };
    if (n >= 3) return { state: 'pass', value: n + '개', note: '3개 이상 — 처음 온 사람이 볼 거리가 있습니다' };
    if (n >= 1) return { state: 'near', value: n + '개', note: '3개까지 더 만드세요' };
    return { state: 'warn', value: '0개', note: '하이라이트가 없습니다' };
  }
  if (id === 'hook') {
    const s = String(m.firstLine == null ? '' : m.firstLine).trim();
    if (!s) return { state: 'warn', value: '없음', note: '캡션 첫 줄을 넣어 보세요' };
    const q = /[?？]|까|나요|인가요|을까/.test(s);
    const digit = /[0-9]/.test(s);
    const place = hasAny(s, kw);
    if (q || digit || place) return { state: 'pass', value: (q ? '질문 · ' : '') + (digit ? '숫자 · ' : '') + (place ? '지역' : '') || '후킹 있음', note: '더보기 전 두 줄 안에 걸리는 말이 있습니다' };
    return { state: 'warn', value: '밋밋함', note: '질문·숫자·지역명 중 하나를 첫 줄에 넣으세요' };
  }
  if (id === 'first_comment') {
    if (m.firstComment === 'yes') return { state: 'pass', value: '달았음', note: '해시태그·블로그 주소가 첫 댓글에 있습니다' };
    if (m.firstComment === 'no') return { state: 'warn', value: '없음', note: '해시태그는 첫 댓글에 다는 게 우리 규칙입니다' };
    return { state: 'near', value: '모름', note: '첫 댓글에 링크·해시태그를 달았는지 표시해 주세요' };
  }
  if (id === 'carousel') {
    if (m.carousel === 'yes') return { state: 'pass', value: '3장 이상', note: '카드뉴스를 돌리고 있습니다' };
    if (m.carousel === 'feed_only') return { state: 'near', value: '피드만', note: '캐러셀로 묶으면 저장이 붙습니다' };
    if (m.carousel === 'no') return { state: 'warn', value: '없음', note: '피드 캐러셀을 아직 안 돌립니다' };
    return { state: 'near', value: '모름', note: '최근 피드에 캐러셀이 있는지 표시해 주세요' };
  }
  return { state: 'near', value: '—', note: '판정 규칙이 없습니다' };
}

/**
 * 계정 하나를 100점으로 채점한다.
 * @param {{brand?:string, bio?:string, linkKind?:string, highlights?:number|string,
 *          lastPostDays?:number|string, reels30?:number|string, firstLine?:string,
 *          firstComment?:string, carousel?:string}} input
 * @param {object} [cfg] seeds/ig_audit_rules.json
 * @returns {{score:number, grade:string, label:string, items:object[], todo:object[], usedWeight:number, version:string, track:object}}
 */
export function auditInstagram(input, cfg) {
  const c = resolveIgRules(cfg);
  const m = input || {};
  const brand = c.tracks[m.brand] ? m.brand : 'daejeon_youth';
  const track = c.tracks[brand];
  const items = [];
  let got = 0;
  let usedWeight = 0;
  (track.items || []).forEach((id) => {
    const def = c.items.find((x) => x.id === id);
    if (!def) return;
    const weight = Number(def.weight) || 0;
    const j = judgeItem(id, m, track);
    const points = j.state === 'pass' ? weight : j.state === 'near' ? weight / 2 : 0;
    got += points;
    usedWeight += weight;
    items.push({
      id, label: def.label, weight, state: j.state,
      value: j.value, note: j.note, fix: def.fix || '',
      points: Math.round(points * 10) / 10
    });
  });
  const score = usedWeight ? Math.round((got / usedWeight) * 100) : 0;
  const g = c.grades.find((x) => score >= Number(x.min)) || c.grades[c.grades.length - 1];
  const todo = items
    .filter((i) => i.state !== 'pass')
    .sort((a, b) => (a.state === b.state ? b.weight - a.weight : a.state === 'warn' ? -1 : 1));
  return {
    score, grade: g.grade, label: g.label, items, todo, usedWeight,
    account: track.account, role: track.role, version: c.version
  };
}

/* ───────────── 화면(#/perf 인스타 탭) ───────────── */

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
}

function writeStore(all) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch (e) { /* 저장 실패는 조용히 */ }
}

/**
 * 인스타 서브탭 아래에 붙는 진단 카드. ctx 는 channelView 가 넘기는 { h, state, api }.
 * 자동 수집 행(rows)이 있으면 마지막 릴스 경과일과 30일 편수를 미리 채운다.
 */
export function renderInstagramAudit(host, ctx, opts = {}) {
  const h = ctx.h;
  const brand = (ctx.state && ctx.state.brand) || 'daejeon_youth';
  const savedAll = readStore();
  const saved = savedAll[brand] || {};
  const auto = opts.auto || {};

  const form = {
    bio: saved.bio != null ? saved.bio : '',
    linkKind: saved.linkKind || '',
    highlights: saved.highlights != null ? saved.highlights : '',
    lastPostDays: saved.lastPostDays != null ? saved.lastPostDays : (auto.lastPostDays != null ? auto.lastPostDays : ''),
    reels30: saved.reels30 != null ? saved.reels30 : (auto.reels30 != null ? auto.reels30 : ''),
    firstLine: saved.firstLine || '',
    firstComment: saved.firstComment || '',
    carousel: saved.carousel || ''
  };

  const panel = h('div', { class: 'panel ig-audit', id: 'ig-audit' });

  const head = h('div', { class: 'ig-audit-head' },
    h('h3', null, '🔎 인스타 계정 진단',
      h('span', { class: 'tag', text: '100점' })),
    h('p', { class: 'hint', text: '프로필을 자동으로 긁지 않습니다. 성래 님이 확인한 값만 넣으면 기계적으로 채점합니다. 값은 이 브라우저에만 저장됩니다.' }));
  panel.appendChild(head);

  const grid = h('div', { class: 'ig-audit-form' });

  const field = (label, node, hint) => h('label', { class: 'ig-field' },
    h('span', { class: 'ig-label', text: label }),
    node,
    hint ? h('span', { class: 'ig-hint', text: hint }) : null);

  const bioInput = h('textarea', { rows: '2', maxlength: '200', placeholder: '프로필 소개글 그대로 붙여넣기' });
  bioInput.value = form.bio;

  const linkSel = h('select', null,
    h('option', { value: '', text: '없음' }),
    h('option', { value: 'blog', text: '블로그' }),
    h('option', { value: 'threads', text: '스레드' }),
    h('option', { value: 'youtube', text: '유튜브' }),
    h('option', { value: 'other', text: '다른 링크' }));
  linkSel.value = form.linkKind;

  const hlInput = h('input', { type: 'number', min: '0', max: '30', inputmode: 'numeric' });
  hlInput.value = form.highlights;

  const daysInput = h('input', { type: 'number', min: '0', max: '365', inputmode: 'numeric', placeholder: '예: 3' });
  daysInput.value = form.lastPostDays;

  const reelsInput = h('input', { type: 'number', min: '0', max: '200', inputmode: 'numeric', placeholder: '예: 4' });
  reelsInput.value = form.reels30;

  const lineInput = h('input', { type: 'text', maxlength: '80', placeholder: '예: 여기 몇 시에 가야 안 기다려요?' });
  lineInput.value = form.firstLine;

  const commentSel = h('select', null,
    h('option', { value: '', text: '모름' }),
    h('option', { value: 'yes', text: '달았음' }),
    h('option', { value: 'no', text: '안 달았음' }));
  commentSel.value = form.firstComment;

  const carouselSel = h('select', null,
    h('option', { value: '', text: '모름' }),
    h('option', { value: 'yes', text: '3장 이상' }),
    h('option', { value: 'feed_only', text: '피드만' }),
    h('option', { value: 'no', text: '없음' }));
  carouselSel.value = form.carousel;

  grid.appendChild(field('바이오', bioInput, '80자 이내 + 지역·정체 키워드'));
  grid.appendChild(field('프로필 링크', linkSel));
  grid.appendChild(field('하이라이트 개수', hlInput));
  grid.appendChild(field('마지막 릴스 (일 전)', daysInput, auto.lastPostDays != null ? '자동 수집값으로 채웠습니다' : ''));
  grid.appendChild(field('30일 릴스 편수', reelsInput, auto.reels30 != null ? '자동 수집값으로 채웠습니다' : ''));
  grid.appendChild(field('캡션 첫 줄', lineInput));
  grid.appendChild(field('첫 댓글 링크·해시태그', commentSel));
  if (brand === 'daejeon_youth') grid.appendChild(field('피드 캐러셀', carouselSel));
  panel.appendChild(grid);

  const out = h('div', { class: 'ig-audit-out' });
  const btn = h('button', { class: 'btn primary', type: 'button', text: '진단하기' });

  const collect = () => ({
    brand,
    bio: bioInput.value,
    linkKind: linkSel.value,
    highlights: hlInput.value,
    lastPostDays: daysInput.value,
    reels30: reelsInput.value,
    firstLine: lineInput.value,
    firstComment: commentSel.value,
    carousel: carouselSel.value
  });

  const draw = (res) => {
    while (out.firstChild) out.removeChild(out.firstChild);
    out.appendChild(h('div', { class: 'ig-score', 'data-grade': res.grade },
      h('span', { class: 'ig-score-v', text: String(res.score) }),
      h('span', { class: 'ig-score-k', text: '/100 · ' + res.grade }),
      h('span', { class: 'ig-score-l', text: res.label })));
    const list = h('div', { class: 'blint-list' });
    res.items.forEach((it) => {
      list.appendChild(h('div', { class: 'lr-row', 'data-state': it.state },
        h('span', { class: 'lr-badge', text: STATE_LABEL[it.state] || it.state }),
        h('div', { class: 'lr-main' },
          h('div', { class: 'lr-title', text: it.label + '  ·  ' + it.value }),
          h('div', { class: 'lr-note', text: it.note || '' }),
          it.state === 'pass' ? null : h('div', { class: 'lr-fix', text: it.fix })),
        h('span', { class: 'lr-w', text: it.points + '/' + it.weight })));
    });
    out.appendChild(list);
    if (res.todo.length) {
      out.appendChild(h('p', { class: 'hint', text: '먼저 할 것: ' + res.todo.slice(0, 2).map((t) => t.label).join(' → ') }));
    }
  };

  btn.addEventListener('click', () => {
    const input = collect();
    const all = readStore();
    all[brand] = input;
    writeStore(all);
    draw(auditInstagram(input, opts.rules));
  });
  panel.appendChild(h('div', { class: 'ig-audit-actions' }, btn));
  panel.appendChild(out);

  /* 마지막에 저장한 값이 있으면 열자마자 보여 준다(빈 폼만 두지 않는다). */
  const hasSaved = Object.keys(saved).length > 0;
  if (hasSaved) draw(auditInstagram(Object.assign({}, form, { brand }), opts.rules));

  host.appendChild(panel);
  return panel;
}

/* ───────────── 自動 수집 행 → 미리 채울 값 ───────────── */

/** KST 기준 오늘(YYYY-MM-DD). */
function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function daysSince(dateStr) {
  const raw = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const a = Date.parse(raw + 'T00:00:00+09:00');
  const b = Date.parse(kstToday() + 'T00:00:00+09:00');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * 자동 수집 행에서 '마지막 릴스 경과일'과 '30일 안 릴스 편수'를 뽑는다.
 * 게시일(published_at)이 없는 행이면 둘 다 null — 화면은 직접 입력을 받는다.
 * 같은 영상은 external_id 하나로 센다(매일 수집한 같은 영상을 여러 번 세지 않음).
 * @param {object[]} rows js/analyticsView.js 가 정규화한 행
 * @param {string} brand
 * @returns {{lastPostDays:number|null, reels30:number|null}}
 */
export function autoFactsFromRows(rows, brand) {
  const surfaces = ['reels'];
  const seen = new Map();
  (rows || []).forEach((r) => {
    if (!r || r.source !== 'instagram') return;
    if (surfaces.indexOf(r.channel) < 0) return;
    if (r.brand && brand && r.brand !== brand) return;
    if (!r.external_id || !r.published_at) return;
    const prev = seen.get(r.external_id);
    if (!prev || String(r.published_at) > String(prev)) seen.set(r.external_id, r.published_at);
  });
  if (!seen.size) return { lastPostDays: null, reels30: null };
  let newest = null;
  let in30 = 0;
  seen.forEach((date) => {
    const d = daysSince(date);
    if (d == null) return;
    if (newest == null || d < newest) newest = d;
    if (d <= 30) in30 += 1;
  });
  return { lastPostDays: newest, reels30: in30 };
}

if (typeof window !== 'undefined') {
  window.IgAudit = { auditInstagram, resolveIgRules, renderInstagramAudit, autoFactsFromRows, IG_AUDIT_DEFAULTS };
}
