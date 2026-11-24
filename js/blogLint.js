/**
 * js/blogLint.js — 발행 전 블로그 린터 (2026w48 기준 9항목)
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

import { AI_TONE_DEFAULTS, lintAiTone } from './blogAiTone.js?v=20261123c';
import { toGroups, groupKind, RHYTHM } from './blogTone.js?v=20261124';

const RULES_URL = 'seeds/blog_lint_rules_2026w48.json';

/* 공개 표시 3항목(2026-11-24)의 판정·문구·자동 수정은 이 모듈 한 곳에 있다. */
import { analyzeCompliance, NATIVE_FEATURE_RE } from './blogCompliance.js?v=20261124b';

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
  { id: 'title_front', label: '제목 앞배치', weight: 12, fix: '제목 맨 앞에 [지역 + 메뉴]를 넣으세요.' },
  { id: 'title_len', label: '제목 길이', weight: 10, fix: '26~45자로 맞추세요.' },
  { id: 'first_screen', label: '첫 화면 정보', weight: 12, fix: '도입 3줄 뒤에 위치·영업·주차 정보 카드를 붙이세요.' },
  { id: 'body_len', label: '본문 분량', weight: 11, fix: '1,700~2,300자로 덜어내세요.' },
  { id: 'photo_density', label: '사진 밀도', weight: 12, fix: '사진 18~22장 · 장당 95~120자.' },
  { id: 'line_rhythm', label: '문단 호흡', weight: 11, fix: '문단 하나를 모바일 2줄(22~44자)로 끊으세요 — 20자 한 줄보다 "2줄 호흡"이 성래 님 실제 문체입니다.' },
  { id: 'short_lines', label: '짧은 호흡', weight: 11, fix: '2줄(44자) 이하 문단을 60개 이상으로.' },
  { id: 'hashtags', label: '해시태그', weight: 11, fix: '8~14개 유지 + 핵심 3개 포함.' },
  { id: 'line_layout', label: '줄바꿈 배치', weight: 10, fix: '한 줄 54자 이내 · 2~5줄을 빈 줄 없이 붙여 덩어리로 · 빈 줄은 덩어리 사이에만 · 📍⏰🚗 정보 줄은 붙여서.' }
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
      aiTone: json.aiTone || AI_TONE_DEFAULTS,          // AI 티 8패턴 · D.I.A.+ · 키워드 3~5회 (2026-11-21)
      benchmark: json.benchmark || null,
      version: json.version || '2026w48'
    };
  } catch (e) {
    cache = {
      targets: DEFAULT_TARGETS, coreTags: DEFAULT_CORE, titleLexicon: DEFAULT_LEXICON,
      rules: DEFAULT_RULES, aiTone: AI_TONE_DEFAULTS, benchmark: null, version: '기본값'
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

/* ── 글 종류 감지 (2026-11-24) ──
   린터의 9항목은 봉명동 맛집 글 24건을 실측해 만든 기준이라, 지역·메뉴가 있는 '장소 글'에만
   맞는 항목이 섞여 있다(제목 앞배치·첫 화면 정보·핵심 태그). 스마트스토어 개설기·주식 기록·
   앱 체험기 같은 정보 글에 그 항목을 그대로 들이대면 100점 만점에 30~50점이 나온다(2026-11-24 실측:
   DY-20261116-003 37점). 그래서 '장소 글'일 때만 지역·메뉴 기준을 강제하고,
   아니면 같은 항목을 안내(near)로 낮춘다 — 경고(warn)로 발행을 막지는 않는다. */
const FOOD_HINT_RE = /(맛집|고기|술집|카페|식당|삼겹|오겹|국수|칼국수|해장|제육|혼밥|주차|야장|꼬치|찜|탕|분식|베이|디저트|와인|호프|파스타)/;

function looksLikePlacePost(m, lexicon) {
  if (m && typeof m.isPlacePost === 'boolean') return m.isPlacePost;
  const text = String((m && m.title) || '') + ' ' + String((m && m.keywords) || '');
  const region = (lexicon || []).some((w) => text.indexOf(w) >= 0);
  return region && FOOD_HINT_RE.test(text);
}

/** 키워드 문구 전체가 아니라 낱말 단위로도 본다 — "스마트스토어 개인판매자 개설" → "스마트스토어". */
function keywordTokens(keywords) {
  const out = [];
  String(keywords || '').split(',').forEach((k) => {
    const t = String(k || '').trim();
    if (!t) return;
    out.push(t);
    t.split(/\s+/).forEach((w) => { if (chars(w) >= 2 && out.indexOf(w) < 0) out.push(w); });
  });
  return out;
}

const st = (state, value, note) => ({ state, value, note });

const RHYTHM_WRAP = 20;        // 모바일 360px 한 줄 글자수
const SHORT_BLOCK_MAX = 44;    // 2줄 이하 문단 = 짧은 호흡

/* ───────────── 판정 ───────────── */

function judgeTitleFront(m, t, lexicon) {
  const win = [...String(m.title || '')].slice(0, t.title_window).join('');
  if (!win) return st('warn', '제목 없음', '제목을 넣어 주세요');
  const kws = keywordTokens(m.keywords);
  const hitKw = kws.filter((k) => win.indexOf(k) >= 0);
  if (hitKw.length) return st('pass', win, '앞 ' + t.title_window + '자에 "' + hitKw[0] + '"');
  const place = looksLikePlacePost(m, lexicon);
  const hit = lexicon.filter((w) => win.indexOf(w) >= 0);
  if (hit.length) return st('pass', win, '앞 ' + t.title_window + '자에 "' + hit[0] + '"');
  const later = lexicon.filter((w) => String(m.title || '').indexOf(w) >= 0);
  if (later.length) return st('near', win, '지역·메뉴가 "' + later[0] + '" 뒤쪽에 있음 — 앞으로 당기세요');
  if (!place) return st('near', win, '주제어를 앞 14자에 — 지역·메뉴 글이 아니어서 경고는 아니에요');
  return st('warn', win, '지역명·메뉴명이 앞 14자에 없음');
}

function judgeTitleLen(m, t) {
  const n = chars(m.title);
  const [lo, hi] = t.title_len;
  if (n >= lo && n <= hi) return st('pass', n + '자', lo + '~' + hi + '자');
  if (n === 0) return st('warn', '0자', '제목을 넣어 주세요');
  return st('warn', n + '자', n < lo ? (lo - n) + '자 부족' : (n - hi) + '자 초과');
}

function judgeFirstScreen(m, t, lexicon) {
  const head = [...String(m.body || '')].slice(0, t.first_screen_chars).join('');
  if (!head.trim()) return st('warn', '본문 없음', '본문을 넣어 주세요');
  const hit = INFO_PATTERNS.filter((p) => p.re.test(head)).map((p) => p.k);
  if (hit.length >= 2) return st('pass', hit.join('·'), '앞 ' + t.first_screen_chars + '자에 ' + hit.length + '종');
  if (hit.length === 1) return st('pass', hit[0], '앞 ' + t.first_screen_chars + '자에 1종(권장 3종: 위치·영업·주차)');
  if (!looksLikePlacePost(m, lexicon)) return st('near', '해당 없음', '장소 글이 아니어서 위치·영업 정보는 필요 없습니다');
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
  /* 문단 호흡 v5(2026-11-21): 한 문단이 모바일에서 몇 줄로 보이는지(20자/줄)로 환산한다.
     32~44자 문단 = 2줄 — 성래 님 발행글 실측(평균 33~42자)과 제미니 확정안 A. */
  const wrap = lines.reduce((s, l) => s + Math.max(1, Math.ceil(chars(l) / RHYTHM_WRAP)), 0);
  const avg = Math.round((total / wrap) * 10) / 10;
  if (avg <= t.avg_line_max) return st('pass', avg + '자', '모바일 줄 환산 평균 ' + avg + '자 · 문단 ' + lines.length + '개');
  return st('warn', avg + '자', '평균 목표 15~20자 — 문단 하나를 2줄(22~44자)로');
}

function judgeShortLines(m, t) {
  const lines = proseLines(m.body);
  /* 짧은 호흡 v5: '16자 이하 한 줄' 대신 '2줄(44자) 이하 문단'을 센다 — 사용자의 실제 호흡 단위. */
  const short = lines.filter((l) => chars(l) <= SHORT_BLOCK_MAX).length;
  if (short >= t.short_lines_min) return st('pass', short + '개', SHORT_BLOCK_MAX + '자 이하(2줄) 문단 ' + short + '개');
  if (short >= t.short_lines_warn) return st('near', short + '개', (t.short_lines_min - short) + '개 부족');
  return st('warn', short + '개', SHORT_BLOCK_MAX + '자 이하 문단이 ' + short + '개뿐 — 목표 ' + t.short_lines_min + '개');
}

function judgeHashtags(m, t, core, lexicon) {
  const tags = hashtagsOf(m.body, m.tags);
  const n = tags.length;
  const [lo, hi] = t.hashtag_count;
  const explicit = Array.isArray(m.requiredTags) && m.requiredTags.length;
  const required = (explicit ? m.requiredTags : core).slice(0, t.core_tags_required);
  const missing = required.filter((c) => tags.indexOf(c) < 0);
  const place = looksLikePlacePost(m, lexicon);
  const label = n + '개' + (missing.length && (explicit || place) ? ' · 빠진 핵심 ' + missing.length : '');
  if (n > t.hashtag_warn_over) return st('warn', label, '15개 초과 — 무관 태그는 스팸 필터 위험');
  /* 장소 글이 아니고 카드가 핵심 태그를 지정하지 않았으면 개수만 본다(지역·메뉴 태그를 강요하지 않는다) */
  if (missing.length >= 2 && (explicit || place)) return st('warn', label, '핵심 태그 ' + missing.join('·') + ' 빠짐');
  if (n === 0) return st('warn', label, '본문 끝에 해시태그를 붙이세요');
  if (n >= lo && n <= hi && (!missing.length || (!explicit && !place))) {
    return st('pass', n + '개' + (explicit ? ' · 핵심 OK' : ''), explicit ? '권장 10~12개 · 핵심 ' + required.length + '개 포함' : '권장 10~12개');
  }
  if (!explicit && !place && n >= lo && n <= hi) return st('pass', label, '권장 10~12개');
  return st('near', label, n < lo ? (lo - n) + '개 부족' : (n > hi ? (n - hi) + '개 초과' : '핵심 태그 1개 빠짐'));
}

/* ── 링크 카드 3항목 (2026-11-18, 스펙 §7) — 점수 계산에는 넣지 않는다 ── */
const LINK_CARD_RE = /\[LINK_CARD:\s*([^\]\s]+)\s*\]/g;
const LINK_FORBIDDEN = /여기|링크|클릭|참고|바로가기/;

function judgeLinkCard(m) {
  const body = String((m && m.body) || '');
  const stripped = body.replace(LINK_CARD_RE, '');
  const cards = (body.match(LINK_CARD_RE) || []).length;
  if (/https?:\/\//.test(stripped)) return st('warn', '줄글 URL 있음', '링크 카드로 바꾸세요');
  if (cards === 0) return st('near', '카드 0개', '관련 내 글 1개를 링크 카드로 넣으세요');
  if (cards > 2) return st('warn', cards + '개', '링크 카드는 1~2개를 권장합니다');
  return st('pass', cards + '개', '카드 1개 = URL 1개');
}

function judgeLinkAnchor(m) {
  const body = String((m && m.body) || '');
  const re = /\[LINK_CARD:[^\]]*\]/g;
  let hit;
  let n = 0;
  const bad = [];
  while ((hit = re.exec(body))) {
    n += 1;
    const before = body.slice(0, hit.index).split('\n').map((s) => s.trim()).filter(Boolean);
    const prev = before.length ? before[before.length - 1].replace(/^[>*\-\s]+/, '') : '';
    if (prev.length < 5 || LINK_FORBIDDEN.test(prev)) bad.push(prev || '(설명 없음)');
  }
  if (!n) return st('near', '카드 없음', '카드 앞에 글 제목을 그대로 쓴 한 줄을 두세요');
  if (bad.length) return st('warn', bad.length + '건', '카드 앞 설명에 글 핵심 주제를 적으세요');
  return st('pass', 'OK', '카드 앞 한 줄 설명 있음');
}

function judgeEmbedHint(m) {
  const body = String((m && m.body) || '');
  const n = (body.match(/\[LINK_CARD:[^\]]*\]/g) || []).length;
  if (!n) return st('near', '—', '카드가 없으면 안내도 필요 없습니다');
  return st('pass', '안내 표시', 'URL 붙여넣고 Enter → 카드만 남기기');
}

const LINK_RULES = [
  { id: 'link_card', label: '링크 카드', weight: 0, fix: '줄글 주소 대신 링크 카드로 바꾸세요 — 카드 1개 = URL 1개, 1~2개 권장.' },
  { id: 'link_anchor', label: '링크 문구', weight: 0, fix: '카드 앞 한 줄에 글 제목을 그대로 쓰세요(여기·링크·클릭 금지).' },
  { id: 'link_embed_hint', label: '붙이는 순서', weight: 0, fix: 'URL을 붙여넣고 Enter → 카드가 뜨면 남은 URL 글자를 지우세요.' }
];

/* ── 공개 표시 3항목 (2026-11-24, docs/BLOG_NATIVE_FEATURES_v1.md) ──
   근거: 네이버 블로그 운영정책(내돈내산·표시광고) + 보도자료 2023-09-21.
   사람이 판단할 영역이라 자동 수정은 하지 않는다. own_money_conflict·disclosure_paid 는
   실제 제재(노출 제한·시정 요청)로 이어지는 조합이라 warn, native_features 는 안내(near).
   판정·문구·자동 수정은 js/blogCompliance.js 한 곳에 있다(화면·키트도 같은 것을 쓴다). */
function judgeDisclosurePaid(m) {
  const a = analyzeCompliance(String((m && m.body) || ''));
  if (a.paid) {
    if (a.noticeTop) return st('pass', '상단 표기 있음', '앞 400자에 경제적 대가 표기');
    if (a.noticeAnywhere) return st('near', '본문 뒤쪽 표기', '표시는 본문 맨 위(앞 400자)에 두세요 — [대가 문구 넣기]를 누르면 자동 배치됩니다');
    return st('warn', '표기 없음', '대가를 받은 글은 본문 맨 위에 “경제적 대가를 제공받아 작성” 문구(텍스트)를 넣으세요 — [대가 문구 넣기]로 자동 배치');
  }
  if (a.profitNotice) return st('pass', '제휴 고지 있음', '쇼핑 커넥트·파트너스 고지 문구 — 수수료 고지라서 ‘대가 표시’는 따로 필요 없습니다');
  return st('near', '대가 표현 없음', '체험·협찬 글에만 표시가 필요합니다');
}

function judgeOwnMoneyConflict(m) {
  const a = analyzeCompliance(String((m && m.body) || ''));
  if (a.conflict) return st('warn', '내돈내산 ' + a.ownMoney + '회 + 수익 링크 ' + a.profitLinks.length + '개', '한 글에 함께 쓰면 운영정책·표시광고법 위반입니다 — 내돈내산 인증을 빼거나 수익 링크를 제거하세요([수익 링크 걷어내기])');
  if (a.profitLinks.length) return st('near', '수익 링크 ' + a.profitLinks.length + '개', '제휴 링크 글은 내돈내산 인증을 붙이지 마세요');
  if (a.ownMoney) return st('pass', '내돈내산만', '수익 링크가 없어 함께 쓰기 위험 없음');
  return st('near', '해당 없음', '내돈내산 인증을 붙일 글인지 한 번 확인하세요(네이버페이 구매확정 6개월·예약 방문 1년 이내)');
}

function judgeNativeFeatures(m) {
  const body = String((m && m.body) || '');
  if (NATIVE_FEATURE_RE.test(body)) return st('pass', '흔적 있음', '네이티브 기능(내돈내산·글감·블로그씨·위젯) 중 하나를 씁니다');
  return st('near', '없음', '발행 전 확인: 내돈내산 인증 · 글감 카드 · 블로그씨 주제 · 미션위젯 — 조건은 docs/BLOG_NATIVE_FEATURES_v1.md');
}

const DISCLOSURE_RULES = [
  { id: 'disclosure_paid', label: '대가 표시', weight: 0, fix: '대가를 받은 글은 본문 맨 위에 “경제적 대가를 제공받아 작성했습니다”를 텍스트로 넣으세요(이미지 표기 금지).' },
  { id: 'own_money_conflict', label: '내돈내산·제휴', weight: 0, fix: '내돈내산 인증과 수익형 링크(커넥트·쿠팡파트너스 등)는 한 글에 같이 쓰지 마세요.' },
  { id: 'native_features', label: '네이버 기능', weight: 0, fix: '내돈내산·글감·블로그씨·미션위젯 중 하나를 발행 전에 확인하세요.' }
];



/**
 * 줄바꿈 배치 (2026-11-22) — 성래 님 실측: 한 줄 22~44자 · 2~5줄을 붙여 덩어리 · 빈 줄은 덩어리 사이에만.
 * 종전 자동화는 모든 줄 사이에 빈 줄을 넣어 모바일에서 두 배로 벌어졌다.
 *
 * 2026-11-24 보정 — 글자 길이·고아 판정에서 **구조 줄을 뺀다**:
 *   · 해시태그 줄: 12개를 한 줄에 쓰면 54자를 넘는 게 정상이고, 마지막 한 덩어리로 두는 규칙이다(docs/LINE_BREAK_v1 §5).
 *   · 링크 카드 표시([LINK_CARD: …])와 사진 자리([사진: …]): 네이버에서는 카드·사진 한 장이 되어 글자 줄이 아니다.
 *   · 소제목(▍ ■ ◆ ▶ ** 1. 1) ①)·구분선(━)·인용(괄호로 시작)은 한 줄 덩어리가 정상이다(docs/LINE_BREAK_v1 §4 예외).
 *   이 보정 전에는 6건 중 4건이 해시태그 한 줄 때문에 '54자 초과'로, 소제목 때문에 '한 줄 덩어리'로 감점됐다.
 */
const HASHTAG_ONLY_RE = /^#[^\s#]+(?:\s+#[^\s#]+)*$/;
const LINK_CARD_ONLY_RE = /^\[LINK_CARD:[^\]]*\]$/;
const PHOTO_LINE_RE = /^\[(?:사진|📸)[^\]]*\]$/;
const SUBHEAD_RE = /^(?:[▍■◆▶▸]|\*\*|#{1,6}\s|\d{1,2}[.)]\s|[①-⑳]|※)/;

function isStructuralLine(l) {
  const s = String(l || '').trim();
  if (!s) return true;
  return HASHTAG_ONLY_RE.test(s) || LINK_CARD_ONLY_RE.test(s) || PHOTO_LINE_RE.test(s)
    || SUBHEAD_RE.test(s) || /^[━─╌]/.test(s);
}

function judgeLineLayout(m, t) {
  const body = String(m.body || '');
  const groups = toGroups(body);
  const kinds = groups.map(groupKind);
  const lines = proseLines(body);
  if (!lines.length) return st('warn', '—', '본문을 넣어 주세요');
  const lineMax = Number(t.layout_line_max) > 0 ? Number(t.layout_line_max) : RHYTHM.blockMax;
  const blankMax = Number(t.layout_blank_ratio_max) > 0 ? Number(t.layout_blank_ratio_max) : RHYTHM.blankRatioMax;
  const over = lines.filter((l) => !isStructuralLine(l) && chars(l) > lineMax).length;
  const infoGap = kinds.filter((k, i) => i > 0 && k === 'info' && kinds[i - 1] === 'info').length;
  const orphans = groups.filter((g, i) => g.length === 1 && kinds[i] === 'prose'
    && !isStructuralLine(g[0]) && !/^[([（]/.test(g[0].trim())).length;
  const allLines = body.replace(/\r\n?/g, '\n').split('\n');
  const blankRatio = allLines.length ? allLines.filter((l) => !l.trim()).length / allLines.length : 0;
  const bad = [];
  if (over) bad.push(lineMax + '자 초과 ' + over + '줄');
  if (infoGap) bad.push('정보 줄이 빈 줄로 끊김 ' + infoGap + '곳');
  if (lines.length >= 8 && blankRatio > blankMax) bad.push('빈 줄 ' + Math.round(blankRatio * 100) + '%');
  if (lines.length >= 6 && orphans >= 2) bad.push('한 줄 덩어리 ' + orphans + '개');
  if (!bad.length) return st('pass', groups.length + '덩어리', '덩어리 ' + groups.length + '개 · 줄 ' + lines.length + '개');
  if (bad.length === 1) return st('near', bad[0], '줄을 붙여 덩어리로 만들면 한 번에 해결됩니다');
  return st('warn', bad.slice(0, 2).join(' · '), '한 줄 ' + lineMax + '자 이내 · 2~5줄을 붙여 덩어리 · 빈 줄은 덩어리 사이에만.');
}

const JUDGES = {
  title_front: judgeTitleFront,
  title_len: judgeTitleLen,
  first_screen: judgeFirstScreen,
  body_len: judgeBodyLen,
  photo_density: judgePhotoDensity,
  line_rhythm: judgeLineRhythm,
  short_lines: judgeShortLines,
  line_layout: judgeLineLayout,
  hashtags: judgeHashtags
};

/** 규칙별로 참조하는 자료가 다르다(제목은 지역·메뉴 사전, 해시태그는 핵심 태그). */
function runJudge(id, m, t, lexicon, core) {
  if (id === 'disclosure_paid') return judgeDisclosurePaid(m);
  if (id === 'own_money_conflict') return judgeOwnMoneyConflict(m);
  if (id === 'native_features') return judgeNativeFeatures(m);
  if (id === 'link_card') return judgeLinkCard(m);
  if (id === 'link_anchor') return judgeLinkAnchor(m);
  if (id === 'link_embed_hint') return judgeEmbedHint(m);
  if (id === 'title_front') return judgeTitleFront(m, t, lexicon);
  if (id === 'first_screen') return judgeFirstScreen(m, t, lexicon);
  if (id === 'hashtags') return judgeHashtags(m, t, core, lexicon);
  const fn = JUDGES[id];
  return fn ? fn(m, t) : st('warn', '—', '알 수 없는 규칙');
}

/**
 * 9항목 판정.
 * @param {{title?:string, body?:string, photoCount?:number, tags?:string|string[], keywords?:string|string[]}} input
 * @param {{targets:object, rules:object[], coreTags:string[], titleLexicon:string[]}} [ruleSet] loadLintRules() 결과
 * @returns {{score:number, pass:boolean, items:object[], stats:object, version:string}}
 */
export function lintBlog(input, ruleSet) {
  const m = input || {};
  const set = ruleSet || {
    targets: DEFAULT_TARGETS, rules: DEFAULT_RULES, coreTags: DEFAULT_CORE,
    titleLexicon: DEFAULT_LEXICON, aiTone: AI_TONE_DEFAULTS, version: '기본값'
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

  /* 링크 카드 3항목은 뒤에 덧붙인다(가중치 0 — 점수·통과 판정에 영향 없음) */
  LINK_RULES.forEach((r) => {
    const res = runJudge(r.id, m, t, lexicon, core);
    items.push({ id: r.id, label: r.label, weight: 0, state: res.state, value: res.value, note: res.note, fix: r.fix });
  });

  /* 공개 표시 3항목(2026-11-24) — 점수에는 넣지 않는다. 다만 제재로 이어지는 조합
     (대가 표기 누락 · 내돈내산+수익링크)은 pass 를 막는다. */
  DISCLOSURE_RULES.forEach((r) => {
    const res = runJudge(r.id, m, t, lexicon, core);
    items.push({ id: r.id, label: r.label, weight: 0, policy: true, state: res.state, value: res.value, note: res.note, fix: r.fix });
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

  /* AI 티 8패턴 · 첫 400자 D.I.A.+ · 키워드 3~5회 — 점수(9항목)에는 넣지 않는다.
     이유: 7패턴 중 2개↑ 적발은 '발행 보류 경고'(hold)로 따로 보여주고, 점수는 실측 상위권 기준 그대로 둔다. */
  const aiTone = lintAiTone(m, set.aiTone);

  return {
    score,
    pass: items.every((it) => !(it.state === 'warn' && (it.weight > 0 || it.policy))),
    items,
    stats,
    aiTone,
    hold: aiTone.hold,
    holdReasons: aiTone.holdReasons,
    version: set.version || '2026w48'
  };
}

/* 콘솔·기타 화면에서 쓰기 쉽게 전역에도 올린다 */
if (typeof window !== 'undefined') {
  window.BlogLint = { lintBlog, loadLintRules };
}
