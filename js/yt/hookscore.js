/**
 * js/yt/hookscore.js — 훅 채점기 (한국어판)
 *
 * 원본: Jakeschincariol/youtube-agent-skill (MIT) skills/yt-script/hookscore.py
 *   5속성(0~100) → 최종점수 = 평균 60% + 최약 40%. 최약 가중은 의도적이다.
 *   속성 넷이 세고 하나가 죽은 훅은 그 하나에서 새므로, 평균은 그걸 숨긴다.
 *
 * 한국어 보정(원본은 영어 단어 목록 기반):
 *   · 어절 단위로 센다. 한국어 말하기 속도(~150어절/분)에서 7~20어절이 첫 2초~10초 대역.
 *   · 숫자·고유명사·'너/당신'·손실어·의문어를 한국어 어휘로 잡는다.
 *   · 공식 21개는 seeds/skills/hook_formulas_ko.json 에 있고, 규칙은 여기 없다(데이터).
 *
 * 이 도구가 말할 수 있는 것과 없는 것: 영어판은 실제 숏폼 훅 74개로 보정됐고, 일부러 나쁜 훅과
 * 진짜 훅은 잘 갈랐지만 한 크리에이터의 성공/실패는 거의 못 갈랐다. 한국어판은 그 보정을
 * 그대로 물려받지 못했다. 낮은 점수는 '다시 보라'는 신호이고, 높은 점수는 약속이 아니다.
 */

const FORMULAS_URL = 'seeds/skills/hook_formulas_ko.json';

const VAGUE = new Set(['최고', '최강', '완벽', '미친', '대박', '역대급', '찐', '레전드', '엄청', '굉장', '엄청난', '모든', '유일무이', '혁명', '꿀', '갓', '사기급']);
const FILLER = new Set(['그냥', '진짜', '너무', '되게', '약간', '일단', '그래서', '그니까', '뭔가', '좀', '정말', '완전', '이제', '여기', '저기', '그거', '이거', '저거', '같은', '근데', '그런데', '아무튼', '어쨌든']);
// '당신'은 번역투라 한국어 숏폼에서 오히려 이탈을 부른다(제미니 검토) — 가산하지 않는다.
const YOU_RE = /(?:^|[\s,.!?"'“”‘’])(너|너는|너가|네가|니가|너도|너만|여러분|본인)(?=[\s,.!?"'“”‘’]|$|[은는이가를도만한테])/g;
const NUM_RE = /\d[\d,.]*\s?(%|퍼센트|명|개|곳|번|분|초|원|만원|천원|배|잔|인분|그램|g|kg|위|시간|일|주|개월|년|팀|가지|컷|인)|(\d+분의\s?\d+)/g;
const AUD_RE = /(대전|유성|봉명동|갈마동|은행동|둔산|관평동|궁동|청년|20대|30대|직장인|혼밥|혼술|커플|집사|퇴근|점심|저녁|주말|아침)/g;
const POLITE_RE = /(하세요|보세요|가세요|드세요|세요|시죠|습니다|해요|예요|이에요)/;
const COND_RE = /(면|때|전에|까지|뿐)/;
const REVEAL_RE = /(이유|비결|정체|차이|실험|재봤|바꿨|뿐|알고\s?보니)/;
const STAKE_RE = /(손해|망했|망한|망한다|후회|비싸|비쌌|비싼|돈|시간|실패|위험|놓치|아깝|늦|날리|사기|줄었|없어졌|올랐|깨졌|걸렸)/g;
const CURIOSITY_RE = /(왜|어떻게|뭐|무슨|어디|언제|얼마|누가|근데|그런데|이유|비결|사실|까지|전에|아무도|혹시|정체)/g;
const PROPER_RE = /[가-힣]{2,}(동|구|역|로|집|바|관|시장|골목|아파트)/;
const NUM_ONLY = /\d/;
const YOU_ONE = new RegExp(YOU_RE.source);
const CLOSED_RE = /(왜냐하면|그래서|즉|때문에|결론은)/;

const FIX = {
  SPECIFICITY: '형용사 하나를 숫자·이름·날짜로 바꾸세요',
  ADDRESS: '첫 여섯 어절 안에 \'너/여러분/대전 20대\'처럼 대상을 부르세요',
  STAKES: '그대로 두면 무엇을 잃는지(돈·시간·한 끼)를 말하세요',
  CURIOSITY: '스스로 답해 버리는 반쪽 문장을 잘라내세요',
  BREVITY: '7~20어절. 소리 내어 읽고 숨이 차는 곳에서 자르세요'
};

const LABELS = { SPECIFICITY: '특정성', ADDRESS: '호명', STAKES: '손실', CURIOSITY: '호기심', BREVITY: '간결' };

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);
const countMatches = (t, re) => (String(t).match(re) || []).length;

function specificity(t) {
  const w = words(t);
  if (!w.length) return 0;
  const nums = countMatches(t, NUM_RE);
  const vague = w.filter((x) => VAGUE.has(x.replace(/[.,!?"'“”‘’]/g, ''))).length;
  const filler = w.filter((x) => FILLER.has(x.replace(/[.,!?"'“”‘’]/g, ''))).length;
  let s = 40 + nums * 18 - vague * 14 - filler * 5;
  // 문장 첫머리가 아닌 고유명사(동·구·역·집 이름)는 '이름 있는 것'으로 읽는다.
  const proper = w.slice(1).filter((x) => PROPER_RE.test(x)).length;
  s += Math.min(14, proper * 7);
  return clamp(s);
}

function address(t) {
  const n = countMatches(t, YOU_RE);
  const head = words(t).slice(0, 6).join(' ');
  const first = YOU_ONE.test(head) ? 25 : 0;
  const aud = Math.min(30, countMatches(t, AUD_RE) * 10);
  const polite = POLITE_RE.test(t) ? 8 : 0;
  return clamp(40 + n * 18 + first + aud + polite);
}

function stakes(t) {
  const n = countMatches(t, STAKE_RE);
  const cond = COND_RE.test(t) ? 8 : 0;
  return clamp(30 + n * 24 + (NUM_ONLY.test(t) ? 12 : 0) + cond);
}

function curiosity(t) {
  const n = countMatches(t, CURIOSITY_RE);
  const q = /\?\s*$/.test(String(t).trim()) ? 18 : 0;
  const closed = CLOSED_RE.test(t) ? -18 : 0;
  const reveal = REVEAL_RE.test(t) ? 10 : 0;
  return clamp(32 + n * 15 + q + closed + reveal);
}

function brevity(t) {
  const n = words(t).length;
  if (!n) return 0;
  if (n >= 7 && n <= 20) return 100;
  if (n < 7) return Math.max(30, 100 - (7 - n) * 12);
  return Math.max(10, 100 - (n - 20) * 6);
}

const PROPS = [['SPECIFICITY', specificity], ['ADDRESS', address], ['STAKES', stakes], ['CURIOSITY', curiosity], ['BREVITY', brevity]];

export function band(v) {
  // 한국어 보정 기준 65/50 (영어 원본 72/55). 실제 시드 훅 24개 분포를 보고 내렸다.
  return v >= 65 ? '튼튼' : v >= 50 ? '쓸 만함' : '약함';
}

export function classify(text, formulas) {
  let best = null;
  let hits = 0;
  for (const f of formulas || []) {
    const n = (f.match || []).filter((p) => {
      try { return new RegExp(p, 'i').test(text); } catch (e) { return false; }
    }).length;
    if (n > hits) { best = f; hits = n; }
  }
  return { formula: best ? (best.ko_name || best.name) : '분류 없음', id: best ? best.id : null, matched: hits };
}

export function scoreHook(text, formulas) {
  const t = String(text || '').trim();
  const properties = {};
  for (const [key, fn] of PROPS) properties[key] = fn(t);
  const vals = Object.values(properties);
  const verdict = Math.round(0.6 * (vals.reduce((a, b) => a + b, 0) / vals.length) + 0.4 * Math.min(...vals));
  const weakestKey = Object.keys(properties).reduce((a, b) => (properties[a] <= properties[b] ? a : b));
  const cls = classify(t, formulas);
  return {
    hook: t,
    properties,
    labels: LABELS,
    verdict,
    band: band(verdict),
    formula: cls.formula,
    formula_id: cls.id,
    matched: cls.matched,
    weakest: weakestKey,
    weakest_label: LABELS[weakestKey],
    fix: FIX[weakestKey],
    words: words(t).length
  };
}

export function rankHooks(list, formulas) {
  return list.map((t) => scoreHook(t, formulas)).sort((a, b) => b.verdict - a.verdict);
}

let cache = null;
export async function loadFormulas(force) {
  if (cache && !force) return cache;
  const res = await fetch(`${FORMULAS_URL}?v=1`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`훅 공식 파일을 불러오지 못했습니다 (HTTP ${res.status})`);
  const data = await res.json();
  cache = data.hooks || [];
  return cache;
}
