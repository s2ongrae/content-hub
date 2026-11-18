/**
 * js/blogLint.js — 발행 전 블로그 린터 (2026w48 기준 8항목)
 *
 * 근거: 네이버 블로그 '관련도순' 상위 24건 실측(2026-11-18) → docs/BLOG_STANDARD_v4.md
 * 규칙·임계치는 seeds/blog_lint_rules_2026w48.json 하나를 웹앱·파이썬 CLI가 같이 읽는다.
 *
 * 쓰는 법
 *   import { lintBlog, loadLintRules } from './blogLint.js';
 *   const rules = await loadLintRules();
 *   const r = lintBlog({ title, body, photoCount, tags, keywords }, rules);
 *   // r = { score, pass, items:[{id, label, weight, state, judge, fix}] }
 *
 * window.BlogLint 로도 열어 둔다(콘솔·다른 화면에서 바로 호출).
 * 판정은 기계적으로 센 값만 쓴다. 사람이 봐야 하는 것은 이 린터가 판정하지 않는다.
 */

const RULES_URL = 'seeds/blog_lint_rules_2026w48.json';

/* 시드 파일을 못 읽어도 검사는 계속 돌아야 한다 — 아래 값은 시드와 같은 기본값이다. */
const DEFAULT_TARGETS = {
  title_window: 14,
  title_len: [26, 45],
  first_screen_chars: 400,
  body_len: [1700, 2300],
  body_warn: [1500, 2500],
  photos_min: 16,
  chars_per_photo: [85, 130],
  chars_per_photo_max: 140,
  avg_line_max: 20,
  short_lines_min: 60,
  short_lines_warn: 50,
  hashtag_count: [8, 14],
  hashtag_warn_over: 15,
  core_tags_required: 3,
  short_line_max_chars: 16
};
const DEFAULT_CORE = ['대전맛집', '유성맛집', '봉명동맛집'];
const DEFAULT_LEXICON = ['대전', '유성', '봉명동', '어은동', '궁동', '온천', '관평동', '둔산',
  '삼겹살', '칼국수', '고기', '맛집', '술집', '해장', '제육', '혼밥', '주차'];
const DEFAULT_RULES = [
  { id: 'title_front', label: '제목 앞배치', weight: 14, fix: '제목 맨 앞에 [지역 + 메뉴]를 넣으세요.' },
  { id: 'title_len', label: '제목 길이', weight: 10, fix: '26~45자로 맞추세요.' },
  { id: 'first_screen', label: '첫 화면 정보', weight: 14, fix: '도입 3줄 뒤에 위치·영업·주차 정보 카드를 붙이세요.' },
  { id: 'body_len', label: '본문 분량', weight: 12, fix: '1,700~2,300자로 덜어내세요.' },
  { id: 'photo_density', label: '사진 밀도', weight: 14, fix: '사진 18~22장 · 장당 95~120자.' },
  { id: 'line_rhythm', label: '문단 호흡', weight: 12, fix: '한 줄에 한 정보만, 평균 15~18자.' },
  { id: 'short_lines', label: '짧은 줄', weight: 12, fix: '16자 이하 줄을 65개 이상으로.' },
  { id: 'hashtags', label: '해시태그', weight: 12, fix: '8~14개 유지 + 핵심 3개 포함.' }
];

let cache = null;

/** 시드 규칙을 읽는다. 실패하면 내장 기본값(같은 수치)으로 돌아간다. */
export async function loadLintRules(force = false) {
  if (cache && !force) return cache;
  try {
    const res = await fetch(`${RULES_URL}?v=2026w48`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    cache = {
      targets: Object.assign({}, DEFAULT_TARGETS, json.targets || {}),
      coreTags: json.coreTags || DEFAULT_CORE,
      titleLexicon: json.titleLexicon || DEFAULT_LEXICON,
      rules: (json.rules && json.rules.length ? json.rules : DEFAULT_RULES),
      benchmark: json.benchmark || null,
      version: json.version || '2026w48'
    };
  } catch (e) {
    cache = {
      targets: DEFAULT_TARGETS, coreTags: DEFAULT_CORE, titleLexicon: DEFAULT_LEXICON,
      rules: DEFAULT_RULES, benchmark: null, version: '기본값'
    };
  }
  return cache;
}

/* ───────────── 계산 도구 ───────────── */

const chars = (s) => [...String(s == null ? '' : s)].length;   // 코드포인트 기준(이모지 1자)

function bodyLines(body) {
  return String(body || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** 사진·HTML만 있는 줄은 글자·문단 통계에서 뺀다(마크다운 초안 대응). */
function proseLines(body) {
  return bodyLines(body).filter((l) => !/^!\[[^\]]*\]\([^)]*\)$/.test(l)
    && !/^<\/?(img|br|div|p|figure|figcaption)\b/i.test(l));
}

function countPhotos(body, given) {
  const n = Number(given);
  if (Number.isFinite(n) && n >= 0) return n;
  const md = (String(body || '').match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
  return md;
}

function hashtagsOf(body, extra) {
  const found = (String(body || '').match(/#[^\s#.,!?()\[\]{}"'<>]+/g) || []).map((t) => t.slice(1));
  const list = found.concat(Array.isArray(extra) ? extra : String(extra || '').split(','));
  const out = [];
  list.forEach((t) => {
    const clean = String(t || '').trim().replace(/^#/, '');
    if (clean && out.indexOf(clean) < 0) out.push(clean);
  });
  return out;
}

const INFO_PATTERNS = [
  { k: '동', re: /[가-힣]{2,}동/ },
  { k: '도로명', re: /[가-힣]{2,}로\s?\d|[가-힣]{2,}로\b/ },
  { k: '시·구', re: /[가-힣]{2,}(시|구)\s/ },
  { k: '시간', re: /\d{1,2}\s?:\s?\d{2}/ },
  { k: '전화', re: /0\d{1,2}[-)\s]\s?\d{3,4}\s?-\s?\d{4}/ },
  { k: '영업', re: /영업\s?시간|l오픈|라스트\s?오더|브레이크\s?타임/ }
];

const st = (state, value, note) => ({ state, value, note });

/* ───────────── 판정 ───────────── */

function judgeTitleFront(m, t, lexicon) {
  const win = [...String(m.title || '')].slice(0, t.title_window).join('');
  if (!win) return st('warn', '제목 없음', '제목을 넣어 주세요');
  const kws = String(m.keywords || '').split(',').map((s) => s.trim()).filter(Boolean);
  const hitKw = kws.filter((k) => win.indexOf(k) >= 0);
  if (hitKw.length) return st('pass', win, '앞 ' + t.title_window + '자에 "' + hitKw[0] + '"');
  const hit = lexicon.filter((w) => win.indexOf(w) >= 0);
  if (hit.length) return st('pass', win, '앞 ' + t.title_window + '자에 "' + hit[0] + '"');
  const later = lexicon.filter((w) => String(m.title || '').indexOf(w) >= 0);
  if (later.length) return st('near', win, '지역·메뉴가 "' + later[0] + '" 뒤쪽에 있음 — 앞으로 당기세요');
  return st('warn', win, '지역명·메뉴명이 앞 14자에 없음');
}

function judgeTitleLen(m, t) {
  const n = chars(m.title);
  const [lo, hi] = t.title_len;
  if (n >= lo && n <= hi) return st('pass', n + '자', lo + '~' + hi + '자');
  if (n === 0) return st('warn', '0자', '제목을 넣어 주세요');
  return st('warn', n + '자', n < lo ? (lo - n) + '자 부족' : (n - hi) + '자 초과');
}

function judgeFirstScreen(m, t) {
  const head = [...String(m.body || '')].slice(0, t.first_screen_chars).join('');
  if (!head.trim()) return st('warn', '본문 없음', '본문을 넣어 주세요');
  const hit = INFO_PATTERNS.filter((p) => p.re.test(head)).map((p) => p.k);
  if (hit.length >= 2) return st('pass', hit.join('·'), '앞 ' + t.first_screen_chars + '자에 ' + hit.length + '종');
  if (hit.length === 1) return st('pass', hit[0], '앞 ' + t.first_screen_chars + '자에 1종(권장 3종: 위치·영업·주차)');
  return st('warn', '없음', '주소·영업시간·전화가 첫 화면에 없음');
}

function judgeBodyLen(m, t) {
  const n = chars(String(m.body || '').trim());
  const [lo, hi] = t.body_len;
  const [wLo, wHi] = t.body_warn;
  if (n >= lo && n <= hi) return st('pass', n + '자', lo + '~' + hi + '자');
  if (n < wLo) return st('warn', n + '자', (wLo - n) + '자 모자람');
  if (n > wHi) return st('warn', n + '자', (n - wHi) + '자 넘음');
  return st('near', n + '자', n < lo ? '목표보다 ' + (lo - n) + '자 짧음' : '목표보다 ' + (n - hi) + '자 김');
}

function judgePhotoDensity(m, t) {
  const p = countPhotos(m.body, m.photoCount);
  const n = chars(String(m.body || '').trim());
  if (!p) return st('warn', '사진 0장', '사진 수를 넣어 주세요');
  const per = Math.round(n / p);
  const [lo, hi] = t.chars_per_photo;
  if (p >= t.photos_min && per >= lo && per <= hi) return st('pass', p + '장 · 장당 ' + per + '자', '목표 ' + t.photos_min + '장↑ · 장당 ' + lo + '~' + hi + '자');
  if (p >= t.photos_min && per > hi && per <= t.chars_per_photo_max) return st('near', p + '장 · 장당 ' + per + '자', '글자 덩어리가 아직 큼 — 목표 장당 110자');
  if (p >= t.photos_min) return st('warn', p + '장 · 장당 ' + per + '자', '사진을 더 넣거나 글자를 줄이세요');
  if (p >= Math.round(t.photos_min * 0.75) && per <= t.chars_per_photo_max) return st('near', p + '장 · 장당 ' + per + '자', (t.photos_min - p) + '장 모자람');
  return st('warn', p + '장 · 장당 ' + per + '자', '사진 ' + (t.photos_min - p) + '장 이상 부족');
}

function judgeLineRhythm(m, t) {
  const lines = proseLines(m.body);
  if (!lines.length) return st('warn', '—', '본문을 넣어 주세요');
  const total = lines.reduce((s, l) => s + chars(l), 0);
  const avg = Math.round((total / lines.length) * 10) / 10;
  if (avg <= t.avg_line_max) return st('pass', avg + '자', '평균 ' + avg + '자 · ' + lines.length + '줄');
  return st('warn', avg + '자', '평균 목표 15~18자 — 한 줄에 한 정보만');
}

function judgeShortLines(m, t) {
  const lines = proseLines(m.body);
  const short = lines.filter((l) => chars(l) <= t.short_line_max_chars).length;
  if (short >= t.short_lines_min) return st('pass', short + '개', t.short_line_max_chars + '자 이하 줄 ' + short + '개');
  if (short >= t.short_lines_warn) return st('near', short + '개', (t.short_lines_min - short) + '개 부족');
  return st('warn', short + '개', '16자 이하 줄이 ' + short + '개뿐 — 목표 65개');
}

function judgeHashtags(m, t, core) {
  const tags = hashtagsOf(m.body, m.tags);
  const n = tags.length;
  const [lo, hi] = t.hashtag_count;
  const required = (Array.isArray(m.requiredTags) && m.requiredTags.length ? m.requiredTags : core).slice(0, t.core_tags_required);
  const missing = required.filter((c) => tags.indexOf(c) < 0);
  const label = n + '개' + (missing.length ? ' · 빠진 핵심 ' + missing.length : ' · 핵심 OK');
  if (n > t.hashtag_warn_over) return st('warn', label, '15개 초과 — 무관 태그는 스팸 필터 위험');
  if (missing.length >= 2) return st('warn', label, '핵심 태그 ' + missing.join('·') + ' 빠짐');
  if (n >= lo && n <= hi && !missing.length) return st('pass', label, '권장 10~12개 · 핵심 ' + required.length + '개 포함');
  if (n === 0) return st('warn', label, '본문 끝에 해시태그를 붙이세요');
  return st('near', label, n < lo ? (lo - n) + '개 부족' : (n > hi ? (n - hi) + '개 초과' : '핵심 태그 1개 빠짐'));
}

const JUDGES = {
  title_front: judgeTitleFront,
  title_len: judgeTitleLen,
  first_screen: judgeFirstScreen,
  body_len: judgeBodyLen,
  photo_density: judgePhotoDensity,
  line_rhythm: judgeLineRhythm,
  short_lines: judgeShortLines,
  hashtags: judgeHashtags
};

/** 규칙별로 참조하는 자료가 다르다(제목은 지역·메뉴 사전, 해시태그는 핵심 태그). */
function runJudge(id, m, t, lexicon, core) {
  if (id === 'title_front') return judgeTitleFront(m, t, lexicon);
  if (id === 'hashtags') return judgeHashtags(m, t, core);
  const fn = JUDGES[id];
  return fn ? fn(m, t) : st('warn', '—', '알 수 없는 규칙');
}

/**
 * 8항목 판정.
 * @param {{title?:string, body?:string, photoCount?:number, tags?:string|string[], keywords?:string|string[]}} input
 * @param {{targets:object, rules:object[], coreTags:string[], titleLexicon:string[]}} [ruleSet] loadLintRules() 결과
 * @returns {{score:number, pass:boolean, items:object[], stats:object, version:string}}
 */
export function lintBlog(input, ruleSet) {
  const m = input || {};
  const set = ruleSet || {
    targets: DEFAULT_TARGETS, rules: DEFAULT_RULES, coreTags: DEFAULT_CORE,
    titleLexicon: DEFAULT_LEXICON, version: '기본값'
  };
  const t = Object.assign({}, DEFAULT_TARGETS, set.targets || {});
  const rules = (set.rules && set.rules.length) ? set.rules : DEFAULT_RULES;
  const lexicon = set.titleLexicon || DEFAULT_LEXICON;
  const core = set.coreTags || DEFAULT_CORE;

  const items = rules.map((r) => {
    const res = runJudge(r.id, m, t, lexicon, core);
    return {
      id: r.id, label: r.label, weight: Number(r.weight) || 0,
      state: res.state, value: res.value, note: res.note, fix: r.fix || ''
    };
  });

  const score = Math.round(items.reduce((s, it) => s
    + (it.state === 'pass' ? it.weight : it.state === 'near' ? it.weight / 2 : 0), 0));

  const lines = proseLines(m.body);
  const stats = {
    titleChars: chars(m.title),
    bodyChars: chars(String(m.body || '').trim()),
    photos: countPhotos(m.body, m.photoCount),
    lines: lines.length,
    shortLines: lines.filter((l) => chars(l) <= t.short_line_max_chars).length,
    avgLine: lines.length ? Math.round((lines.reduce((s, l) => s + chars(l), 0) / lines.length) * 10) / 10 : 0,
    hashtags: hashtagsOf(m.body, m.tags).length
  };

  return {
    score,
    pass: items.every((it) => it.state !== 'warn'),
    items,
    stats,
    version: set.version || '2026w48'
  };
}

/* 콘솔·기타 화면에서 쓰기 쉽게 전역에도 올린다 */
if (typeof window !== 'undefined') {
  window.BlogLint = { lintBlog, loadLintRules };
}
