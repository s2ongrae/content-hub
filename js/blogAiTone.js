/**
 * js/blogAiTone.js — 블로그 'AI 티 8패턴' + 첫 400자 D.I.A.+ 게이트 (2026-11-21, #44584 · 2026-11-23 번역투 추가)
 *
 * 근거
 *  · 수집·기획서 downloads/스레드_꿀팁_수집_및_제미니_디벨롭_20261121.md §1-3(B1~B9) · §3-2 · §4
 *  · 제미니 고정방 확정: 7패턴 기계 판정표 + '7패턴 중 2개↑ 적발 시 발행 보류 경고'
 *  · 2026-11-23 추가(8패턴 '번역투'): 인스타 @reelbuilder_ 의 'humanizer 스킬(번역투 제거)' +
 *    @lazy_owen 클로드 세팅 영상에서 본 'AI 문체 잡기' 계열을 우리 린터에 옮겼다.
 *    문장을 고치지는 않고 세기만 한다 — 고치는 사람은 레이 님이다.
 *  · 우리 판단(§4-3·4): 소제목은 `###`가 아니라 **굵은 한 줄**이라 전처리로 인식하고,
 *    1인칭 부재는 FAIL이 아니라 WARN(톤 프리셋별 임계값)으로 낮춘다 — 레이 님 자조·정보 톤 보호.
 *  · 추가 판단 1: '균일 문장길이'(패턴 4)를 문단(블록)이 아니라 **문장** 단위로 잰다.
 *    우리 2줄 호흡 표준(v5)이 "문단 32~44자"로 블록 길이를 일부러 고르게 만들기 때문에,
 *    블록 SD로 재면 정상 글도 매번 걸린다. 패턴의 의도(문장이 다 비슷비슷하다)는 문장 단위가 맞다.
 *  · 추가 판단 2: 키워드 과반복(B3)은 6회↑를 FAIL로 두어 '발행 보류'에 넣는다(제미니 PASS 기준).
 *
 * 판정은 기계적으로 센 값만 쓴다. 무엇을 고칠지는 글쓴이가 정한다.
 * 규칙·임계치는 seeds/blog_lint_rules_2026w48.json 의 aiTone 한 곳을 웹앱·파이썬 CLI가 같이 읽는다.
 *
 * 쓰는 법
 *   import { lintAiTone, AI_TONE_DEFAULTS } from './blogAiTone.js';
 *   const r = lintAiTone({ title, body, keywords, tonePreset: 'jajo' }, rules.aiTone);
 *   // r = { patterns[7], hits, count, hold, holdReasons, dia, keywords, stats, summary, version }
 */

export const AI_TONE_DEFAULTS = {
  version: '2026w48',
  hold_at: 2,                 // 8패턴 중 이만큼 적발되면 '발행 보류' 경고
  intro_chars: 150,           // 패턴 1(일반론 서론)을 보는 앞부분
  first_chars: 400,           // D.I.A.+ 첫 화면
  sd_min: 6.0,                // 패턴 4: 문장 길이 표준편차가 이보다 작으면 '균일'
  sentence_min: 8,            // 문장이 이보다 적으면 길이 분포를 판정하지 않는다
  number_ratio_min: 0.15,     // 패턴 5: 숫자가 든 문단 비율 하한
  number_blocks_min: 8,       // 문단이 이보다 적으면 비율 판정을 보류
  headings_min: 3,            // 패턴 2: 소제목이 이만큼 있어야 '대칭'을 본다
  heading_spread_max: 4,      // 패턴 2: 소제목 글자수 최대-최소 차(±2자)
  first_person_min: 2,        // 패턴 6: 1인칭 기본 하한(프리셋이 덮어쓴다)
  over_polite_max: 4,         // 패턴 7: 과잉 친절 표현 상한
  translationese_min: 4,      // 패턴 8: 번역투 표현이 이만큼이면 '고칠 것'
  translationese_near: 2,     // 패턴 8: 이만큼이면 '주의'
  translationese_min_chars: 300, // 패턴 8: 본문이 이보다 짧으면 판정하지 않는다
  translationese_terms: [
    { label: '~에 대해(서)', pattern: '에 대해' },
    { label: '~에 대한', pattern: '에 대한' },
    { label: '~에 있어(서)', pattern: '에 있어' },
    { label: '~를 통해(서)', pattern: '를 통해' },
    { label: '~에 의해', pattern: '에 의해' },
    { label: '~로 인해', pattern: '로 인해' },
    { label: '~할 수 있습니다', pattern: '할 수 있' },
    { label: '~것이 중요합니다', pattern: '것이 중요하' },
    { label: '~가지고 있다', pattern: '가지고 있' },
    { label: '~라는 점에서', pattern: '라는 점에서' },
    { label: '~경향이 있다', pattern: '경향이 있' },
    { label: '결론적으로', pattern: '결론적으로' }
  ],
  first_person_min_by_preset: { jajo: 1, review: 2, info: 1 },
  keyword_count: [3, 5],      // B3: 본문 등장 권장 범위
  keyword_fail: 6,            // B3: 이 이상이면 과반복(발행 보류)
  regex: {
    first_person: '(?<![가-힣])(?:나|내|제|저|우리)(?=[는가도만한걸게에선를의]|[\\s,.!?~…]|$)',
    experience: '(?:직접|실제로|써보니|써 보고|가보니|가 봤|먹어보니|먹어 봤|앉아보니|느꼈|느낀|개인적으로|내 기준|솔직히)',
    cliche: '(?:도움이 되셨|도움이 되었|기대해 봅니다|기대해봅니다|응원합니다|응원하겠습니다|마치겠습니다|마무리하겠습니다|알아보았습니다|이상으로 (?:마치|정리)|그럼 다음에)',
    over_polite: '(?:물론|다만|참고로|혹시라도|부담 없이|부담없이|편하게|편한 마음)',
    translationese: '(?:에 대해|에 대한|에 있어|를 통해|에 의해|로 인해|할 수 있|것이 중요하|가지고 있|라는 점에서|경향이 있|결론적으로)',
    proper: '(?:[가-힣]{2,}(?:동|구|시|역|점|로|길)|[A-Za-z]{2,})',
    number: '[0-9]',
    dia_question: '(?:\\?|까\\?|나요|인가요|을까|ㄹ까|궁금|고민|헷갈|모르겠|찾는다면|고를 때|정할 때|알아야)',
    dia_answer: '(?:답(?:이다|입니다|이에요)|정답|결론(?:은|부터|적)|바로 (?:이|그|여기)|추천(?:한다|합니다|해요|드립니다|이에요)|괜찮(?:다|습니다|아요|네요)|낫(?:다|습니다|아요)|만족|좋(?:다|습니다|았|네요))',
    dia_condition: '(?:면 |라면|경우|때 |한정|평일|주말|점심|저녁|예약|주차|가격|가성비|웨이팅|대기|영업)',
    dia_target: '(?:분들|분께|분이|분에게|초보|직장인|커플|혼밥|가족|친구|학생|손님|혼자|야근|퇴근|위한|하는 사람)',
    dia_conclusion: '(?:추천|비추|재방문|또 갈|다시 갈|괜찮|좋았|만족|아쉬|결론|정리|총평|한 줄|다음에|다음엔|또 오)'
  },
  patterns: [
    { id: 'generic_intro', no: 1, label: '일반론 서론', judge: '앞 150자에 1인칭·숫자·고유명사가 0개',
      fix: '첫 150자에 내 경험(1인칭)이나 숫자·장소명을 하나 넣으세요. 인사말·일반론 3문장은 지웁니다.' },
    { id: 'symmetric_headings', no: 2, label: '대칭 소제목', judge: '소제목 3개↑ · 글자수 편차 ±2자 또는 같은 어미 100%',
      fix: '소제목 하나를 질문이나 단언으로 바꾸고 길이를 들쭉날쭉하게 두세요.' },
    { id: 'cliche_ending', no: 3, label: '결말 상투어', judge: '마지막 2문단에 "도움이 되셨/기대해 봅니다/마치겠습니다" 류',
      fix: '마지막 문단은 인사 대신 결론·다음 행동 한 줄로 끝내세요(예: "다음엔 평일 6시에 가볼 생각입니다").' },
    { id: 'uniform_sentences', no: 4, label: '균일 문장 길이', judge: '문장 길이 표준편차 SD < 6.0 (문장 8개 이상)',
      fix: '짧은 한 문장을 섞으세요. 3~5자 단문 하나가 AI 문체를 가장 크게 지웁니다.' },
    { id: 'no_numbers', no: 5, label: '수치 없는 주장', judge: '숫자가 든 문단 비율 15% 미만 (문단 8개 이상)',
      fix: '가격·대기시간·영업시간·걸음 수 같은 숫자를 문단마다 하나씩 넣으세요.' },
    { id: 'first_person_absent', no: 6, label: '1인칭 부재', judge: '경험 표현(직접·써보니·가보니·느낀)이 하한 미만 — WARN',
      fix: '내가 본 것 한 줄을 넣으세요. 정보 정리 글은 1개면 충분합니다.' },
    { id: 'over_polite', no: 7, label: '과잉 친절', judge: '"물론·다만·참고로·부담 없이" 4회 초과',
      fix: '양보·배려 접속사를 덜어내세요. 한 글에 두 번까지면 충분합니다.' },
    { id: 'translationese', no: 8, label: '번역투', judge: '"~에 대해·~를 통해·~할 수 있습니다·결론적으로" 류가 4회 이상',
      fix: '"~를 통해 알 수 있습니다" → "보니 알겠더라", "~에 대한 정보" → "가격·주차 정보"처럼 능동형·명사형으로 바꾸세요.' }
  ],
  dia: {
    label: '첫 400자 D.I.A.+',
    elements: [
      { id: 'question', label: '질문·문제', regex: 'dia_question', fix: '첫 문장을 질문이나 고민으로 시작하세요(예: "봉명동에서 늦게까지 여는 곳 찾는다면").' },
      { id: 'answer', label: '답', regex: 'dia_answer', fix: '첫 3줄 안에 답을 먼저 쓰세요("○○이 답입니다"). 답을 끝으로 미루지 않습니다.' },
      { id: 'condition', label: '조건', regex: 'dia_condition', fix: '조건을 붙이세요(가격대·시간·주차·예약).' },
      { id: 'target', label: '대상', regex: 'dia_target', fix: '누구에게 맞는지 쓰세요(혼밥러·야근 끝 직장인·커플).' },
      { id: 'conclusion', label: '결론', regex: 'dia_conclusion', fix: '첫 400자에 한 줄 결론을 넣거나, 마지막 문단을 단정으로 끝내세요.' }
    ]
  }
};

const DIA_PASS_AT = 4;   // 5요소 중 이만큼 있으면 통과
const DIA_NEAR_AT = 3;   // 이만큼이면 주의

/* ───────────── 도구 ───────────── */

export const cp = (s) => [...String(s == null ? '' : s)].length;

/**
 * 본문을 '줄(문단)' 단위로 나눈다 — 네이버 에디터의 문단과 1:1.
 *   2026-11-22: 블로그 호흡을 '덩어리(빈 줄 묶음)'로 바꾸면서, AI 티 통계는 계속 줄 단위로
 *   세도록 여기서는 한 줄 = 한 블록으로 나눈다(종전과 같은 분모를 유지한다).
 */
export function toBlocks(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);
}

/** 사진·캡션·HTML만 있는 블록은 글 통계에서 뺀다. */
export function proseBlocks(text) {
  return toBlocks(text).filter((b) => !/^!\[[^\]]*\]\([^)]*\)$/.test(b)
    && !/^<\/?(img|br|div|p|figure|figcaption)\b/i.test(b)
    && !/^\[사진/.test(b)
    && !/^▲/.test(b));
}

const EMOJI_HEAD = /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

/**
 * 소제목 찾기 — 우리 에디터는 `###`가 아니라 **굵은 한 줄**을 쓴다.
 *   강한 소제목: `**…**` · `# …` · 이모지로 시작
 *   약한 소제목: 22자 이하 · 문장부호로 끝나지 않고 · 쉼표 없고 · 서술 어미가 아닌 줄
 * 강한 것이 3개 이상이면 그것만 쓴다(캡션·짧은 감탄 줄이 섞이는 것을 막는다).
 */
export function headingsOf(blocks) {
  const list = [];
  const total = blocks.length;
  blocks.forEach((b, i) => {
    const s = String(b).trim();
    if (!s) return;
    if (/^\*\*[^*].*\*\*$/.test(s) || /^#{1,6}\s/.test(s) || EMOJI_HEAD.test(s)) {
      list.push({ text: s.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').trim(), kind: 'strong' });
      return;
    }
    if (i === 0 || i === total - 1) return;
    if (cp(s) > 22 || cp(s) < 3) return;
    if (/[.!?。？！]$/.test(s)) return;
    if (s.indexOf(',') >= 0 || /^[-*•·>▲▸]/.test(s) || s.charAt(0) === '#') return;
    if (/(?:다|요|까|죠|네|음|함|임|겠|습니다|해요|었다|았다)$/.test(s)) return;
    list.push({ text: s, kind: 'weak' });
  });
  const strong = list.filter((h) => h.kind === 'strong');
  return strong.length >= 3 ? strong : list;
}

/** 문장 단위로 나눈다(문장 6자 미만은 버린다 — '네.' 같은 파편). */
export function sentencesOf(text) {
  const raw = String(text == null ? '' : text).replace(/\n+/g, ' ').match(/[^.!?。？！]+[.!?。？！]?/g) || [];
  return raw.map((s) => s.trim()).filter((s) => cp(s) >= 6);
}

function stdev(nums) {
  const n = nums.length;
  if (n < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
}

const round1 = (x) => Math.round(x * 10) / 10;
const re = (src) => { try { return new RegExp(src, 'g'); } catch (e) { return /$^/g; } };
const countRe = (text, src) => (String(text || '').match(re(src)) || []).length;
const hasRe = (text, src) => { try { return new RegExp(src).test(String(text || '')); } catch (e) { return false; } };

export function resolveAiTone(cfg) {
  const c = Object.assign({}, AI_TONE_DEFAULTS, cfg || {});
  c.regex = Object.assign({}, AI_TONE_DEFAULTS.regex, (cfg && cfg.regex) || {});
  c.dia = Object.assign({}, AI_TONE_DEFAULTS.dia, (cfg && cfg.dia) || {});
  if (!Array.isArray(c.patterns) || !c.patterns.length) c.patterns = AI_TONE_DEFAULTS.patterns;
  if (!Array.isArray(c.dia.elements) || !c.dia.elements.length) c.dia.elements = AI_TONE_DEFAULTS.dia.elements;
  c.first_person_min_by_preset = Object.assign({}, AI_TONE_DEFAULTS.first_person_min_by_preset,
    (cfg && cfg.first_person_min_by_preset) || {});
  return c;
}

/* ───────────── AI 티 7패턴 ───────────── */

function patternResult(def, state, value, note) {
  return { id: def.id, no: def.no, label: def.label, judge: def.judge, state, value, note, fix: def.fix };
}

export function aiToneScan(input, cfg) {
  const c = resolveAiTone(cfg);
  const m = input || {};
  const blocks = proseBlocks(m.body);
  const text = blocks.join('\n\n');
  const total = cp(text);
  const preset = String(m.tonePreset || '').trim();
  const patterns = [];
  const stats = {
    blocks: blocks.length, chars: total, headings: 0, headingSpread: 0,
    sentences: 0, sentenceSd: 0, firstPerson: 0, experience: 0,
    numberBlocks: 0, numberRatio: 0, introChars: 0, overPolite: 0, translationese: 0
  };
  const def = (id) => c.patterns.find((p) => p.id === id) || { id, no: 0, label: id, judge: '', fix: '' };

  /* 본문이 없으면 판정하지 않는다(빈 초안에 '보류'가 뜨면 소음). */
  if (!total) {
    c.patterns.forEach((p) => patterns.push(patternResult(p, 'near', '—', '본문을 넣으면 검사합니다')));
    return { patterns, hits: [], count: 0, hold: false, holdReasons: [], stats,
      summary: '본문 없음', version: c.version };
  }

  /* ① 일반론 서론 — 앞 150자에 1인칭·숫자·고유명사가 모두 0 */
  {
    const intro = [...text].slice(0, c.intro_chars).join('');
    const fp = countRe(intro, c.regex.first_person);
    const num = countRe(intro, c.regex.number);
    const proper = countRe(intro, c.regex.proper) + keywordHits(intro, m.keywords);
    stats.introChars = cp(intro);
    const d = def('generic_intro');
    if (stats.introChars < 40) patterns.push(patternResult(d, 'near', '앞 ' + stats.introChars + '자', '서론이 짧아 판정하지 않습니다'));
    else if (fp + num + proper === 0) patterns.push(patternResult(d, 'warn', '1인칭 0 · 숫자 0 · 고유명사 0', '앞 150자가 일반론입니다 — 첫 문장에 내 경험이나 숫자를 넣으세요'));
    else patterns.push(patternResult(d, 'pass', '1인칭 ' + fp + ' · 숫자 ' + num + ' · 고유명사 ' + proper, '앞 150자에 근거가 있음'));
  }

  /* ② 대칭 소제목 — 3개↑ 에서 글자수 편차 ±2자 또는 같은 어미 100% */
  {
    const heads = headingsOf(blocks);
    const lens = heads.map((h) => cp(h.text));
    const spread = lens.length ? Math.max.apply(null, lens) - Math.min.apply(null, lens) : 0;
    const ends = heads.map((h) => h.text.slice(-2));
    const sameEnd = heads.length >= 3 && ends.every((e) => e === ends[0]);
    stats.headings = heads.length;
    stats.headingSpread = spread;
    const d = def('symmetric_headings');
    if (heads.length < c.headings_min) patterns.push(patternResult(d, 'near', '소제목 ' + heads.length + '개', '소제목 ' + c.headings_min + '개 이상이어야 판정합니다'));
    else if (spread <= c.heading_spread_max || sameEnd) {
      const why = spread <= c.heading_spread_max ? '글자수 편차 ' + spread + '자' : '모든 소제목이 같은 어미';
      patterns.push(patternResult(d, 'warn', '소제목 ' + heads.length + '개 · ' + why, '소제목이 대칭입니다 — 하나를 질문·단언으로 바꾸세요'));
    } else patterns.push(patternResult(d, 'pass', '소제목 ' + heads.length + '개 · 편차 ' + spread + '자', '소제목 길이가 들쭉날쭉 — 사람이 쓴 모양'));
  }

  /* ③ 결말 상투어 — 마지막 2문단 */
  {
    const tail = blocks.slice(-2).join('\n');
    const hit = (tail.match(re(c.regex.cliche)) || [])[0];
    const d = def('cliche_ending');
    if (hit) patterns.push(patternResult(d, 'fail', hit, '마지막 문단이 인사말입니다 — 결론·다음 행동으로 끝내세요'));
    else if (!blocks.length) patterns.push(patternResult(d, 'near', '—', '본문이 없습니다'));
    else patterns.push(patternResult(d, 'pass', '없음', '결말에 상투어 없음'));
  }

  /* ④ 균일 문장 길이 — 문장 SD < 6.0 (문장 8개 이상일 때만) */
  {
    const sent = sentencesOf(text);
    const sd = round1(stdev(sent.map(cp)));
    stats.sentences = sent.length;
    stats.sentenceSd = sd;
    const d = def('uniform_sentences');
    if (sent.length < c.sentence_min) patterns.push(patternResult(d, 'near', '문장 ' + sent.length + '개', '문장 ' + c.sentence_min + '개 이상이어야 판정합니다'));
    else if (sd < c.sd_min) patterns.push(patternResult(d, 'warn', '문장 ' + sent.length + '개 · SD ' + sd, '문장 길이가 고릅니다(SD ' + sd + ' < ' + c.sd_min + ') — 단문 하나를 섞으세요'));
    else patterns.push(patternResult(d, 'pass', '문장 ' + sent.length + '개 · SD ' + sd, '문장 길이 편차가 있음'));
  }

  /* ⑤ 수치 없는 주장 — 숫자가 든 문단 비율 15% 미만 */
  {
    const withNum = blocks.filter((b) => hasRe(b, c.regex.number)).length;
    const ratio = blocks.length ? round1((withNum / blocks.length) * 100) / 100 : 0;
    stats.numberBlocks = withNum;
    stats.numberRatio = ratio;
    const d = def('no_numbers');
    if (blocks.length < c.number_blocks_min) patterns.push(patternResult(d, 'near', '문단 ' + blocks.length + '개', '문단 ' + c.number_blocks_min + '개 이상이어야 비율을 봅니다'));
    else if (ratio < c.number_ratio_min) patterns.push(patternResult(d, 'warn', Math.round(ratio * 100) + '%', '숫자가 든 문단이 ' + Math.round(ratio * 100) + '% — 가격·시간·대기 같은 수치를 넣으세요'));
    else patterns.push(patternResult(d, 'pass', Math.round(ratio * 100) + '%', '숫자가 든 문단 ' + withNum + '/' + blocks.length));
  }

  /* ⑥ 1인칭 부재 — FAIL이 아니라 WARN(톤 프리셋별 하한) */
  {
    const fp = countRe(text, c.regex.first_person);
    const exp = countRe(text, c.regex.experience);
    const min = c.first_person_min_by_preset[preset] != null ? c.first_person_min_by_preset[preset] : c.first_person_min;
    stats.firstPerson = fp;
    stats.experience = exp;
    const d = def('first_person_absent');
    if (fp + exp >= min) patterns.push(patternResult(d, 'pass', '1인칭 ' + fp + ' · 경험 ' + exp, '하한 ' + min + '회' + (preset ? ' (' + preset + ')' : '')));
    else patterns.push(patternResult(d, 'warn', '1인칭 ' + fp + ' · 경험 ' + exp, '내가 본 것 한 줄을 넣으세요(하한 ' + min + '회' + (preset ? ' · ' + preset : '') + ')'));
  }

  /* ⑦ 과잉 친절 — 4회 초과 */
  {
    const polite = countRe(text, c.regex.over_polite);
    stats.overPolite = polite;
    const d = def('over_polite');
    if (polite > c.over_polite_max) patterns.push(patternResult(d, 'warn', polite + '회', '양보 접속사가 ' + polite + '회 — 2회 이하로 덜어내세요'));
    else patterns.push(patternResult(d, 'pass', polite + '회', '상한 ' + c.over_polite_max + '회 이내'));
  }

  /* ⑧ 번역투 — '~에 대해·~를 통해·~할 수 있습니다·결론적으로'가 4회 이상 (2026-11-23) */
  {
    const d = def('translationese');
    const terms = (Array.isArray(c.translationese_terms) && c.translationese_terms.length)
      ? c.translationese_terms
      : AI_TONE_DEFAULTS.translationese_terms;
    const counts = terms
      .map((t) => ({ label: t.label, n: countRe(text, t.pattern) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    const hit = counts.reduce((a, b) => a + b.n, 0);
    stats.translationese = hit;
    const top = counts.slice(0, 2).map((x) => x.label + ' ' + x.n).join(' · ');
    if (total < c.translationese_min_chars) {
      patterns.push(patternResult(d, 'near', '본문 ' + total + '자', '본문이 짧아 번역투를 판정하지 않습니다'));
    } else if (hit >= c.translationese_min) {
      patterns.push(patternResult(d, 'warn', hit + '회' + (top ? ' · ' + top : ''), '번역투가 ' + hit + '회 — 능동형으로 바꾸세요'));
    } else if (hit >= c.translationese_near) {
      patterns.push(patternResult(d, 'near', hit + '회' + (top ? ' · ' + top : ''), '두세 번은 괜찮습니다 — 한 번 더 줄여 보세요'));
    } else {
      patterns.push(patternResult(d, 'pass', hit + '회', '번역투 거의 없음'));
    }
  }

  const hits = patterns.filter((p) => p.state === 'warn' || p.state === 'fail');
  const fails = patterns.filter((p) => p.state === 'fail');
  const hold = fails.length > 0 || hits.length >= c.hold_at;
  const holdReasons = [];
  if (fails.length) holdReasons.push('결말·과반복: ' + fails.map((p) => p.label).join('·'));
  if (hits.length >= c.hold_at) holdReasons.push('AI 티 ' + hits.length + '개 적발');

  return {
    patterns, hits: hits.map((p) => p.id), count: hits.length, hold, holdReasons, stats,
    summary: hits.length
      ? 'AI 티 ' + hits.length + '개 — ' + hits.map((p) => p.label).join('·')
      : 'AI 티 0개 — ' + (stats.sentences ? '문장 ' + stats.sentences + '개 · SD ' + stats.sentenceSd : '본문 없음'),
    version: c.version
  };
}

/* ───────────── 첫 400자 D.I.A.+ 게이트 ───────────── */

export function diaGate(input, cfg) {
  const c = resolveAiTone(cfg);
  const m = input || {};
  const blocks = proseBlocks(m.body);
  const text = blocks.join('\n\n');
  const head = [...text].slice(0, c.first_chars).join('');
  const tail = blocks.slice(-2).join('\n');
  const elements = (c.dia.elements || []).map((el) => {
    const src = c.regex[el.regex] || '$^';
    const inHead = hasRe(head, src);
    if (el.id === 'conclusion' && !inHead) {
      const inTail = hasRe(tail, src);
      return { id: el.id, label: el.label, state: inTail ? 'near' : 'warn',
        value: inTail ? '본문 끝에만' : '없음',
        note: inTail ? '결론이 마지막 문단에만 있습니다 — 첫 400자에 한 줄 요약을 넣으세요' : '결론이 없습니다',
        fix: el.fix };
    }
    return { id: el.id, label: el.label, state: inHead ? 'pass' : 'warn',
      value: inHead ? '있음' : '없음',
      note: inHead ? '첫 400자 안' : '첫 400자에 없음', fix: el.fix };
  });
  const hits = elements.filter((e) => e.state !== 'warn').length;   // pass + near
  const state = hits >= DIA_PASS_AT ? 'pass' : hits >= DIA_NEAR_AT ? 'near' : 'warn';
  const missing = elements.filter((e) => e.state === 'warn').map((e) => e.label);
  return {
    elements,
    hits,
    total: elements.length,
    state,
    firstChars: cp(head),
    summary: state === 'pass'
      ? '5요소 중 ' + hits + '개 — 첫 400자 의도가 잡힘'
      : (missing.length ? '빠진 요소: ' + missing.join('·') : '5요소 중 ' + hits + '개'),
    version: c.version
  };
}

/* ───────────── 키워드 3~5회(B3) ───────────── */

function toList(v) {
  const raw = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
  const out = [];
  raw.forEach((x) => {
    const s = String(x == null ? '' : x).trim().replace(/^#/, '');
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return out;
}

function countText(text, kw) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ');
  const k = String(kw || '').trim().replace(/\s+/g, ' ');
  if (!k) return 0;
  return s.split(k).length - 1;
}

function keywordHits(text, keywords) {
  return toList(keywords).reduce((n, k) => n + countText(text, k), 0);
}

export function keywordCheck(input, cfg) {
  const c = resolveAiTone(cfg);
  const m = input || {};
  const kws = toList(m.keywords);
  if (!kws.length) return { items: [], state: 'near', note: '노리는 검색어를 넣으면 본문 3~5회를 셉니다', version: c.version };
  const blocks = proseBlocks(m.body);
  const text = blocks.join('\n\n');
  const heads = headingsOf(blocks).map((h) => h.text).join(' ');
  const [lo, hi] = c.keyword_count;
  const items = kws.map((kw) => {
    const n = countText(text, kw);
    const inHead = countText(heads, kw);
    const state = n === 0 ? 'warn' : n >= c.keyword_fail ? 'fail' : (n < lo ? 'near' : 'pass');
    const note = n === 0 ? '본문에 없음 — 제목·첫 문단·소제목에 넣으세요'
      : n >= c.keyword_fail ? n + '회 — 과반복(권장 ' + lo + '~' + hi + '회). 무관 문단의 반복을 지우세요'
        : n < lo ? n + '회 — ' + (lo - n) + '회 더 넣어도 좋습니다'
          : n + '회 — 권장 범위';
    return { keyword: kw, count: n, headings: inHead, state, note };
  });
  const worst = items.some((i) => i.state === 'fail') ? 'fail'
    : items.some((i) => i.state === 'warn') ? 'warn'
      : items.some((i) => i.state === 'near') ? 'near' : 'pass';
  return { items, state: worst, note: '키워드 ' + items.length + '개 · 권장 ' + lo + '~' + hi + '회', version: c.version };
}

/* ───────────── 한 번에 ───────────── */

/**
 * 린터·스튜디오가 부르는 입구.
 * @param {{title?:string, body?:string, keywords?:string|string[], tonePreset?:string}} input
 * @param {object} [cfg] seeds/blog_lint_rules_2026w48.json 의 aiTone
 * @returns {{patterns:object[], hits:string[], count:number, hold:boolean, holdReasons:string[],
 *            dia:object, keywords:object, stats:object, summary:string, version:string}}
 */
export function lintAiTone(input, cfg) {
  const tone = aiToneScan(input, cfg);
  const dia = diaGate(input, cfg);
  const keywords = keywordCheck(input, cfg);
  const holdReasons = tone.holdReasons.slice();
  if (keywords.state === 'fail') {
    const bad = keywords.items.filter((i) => i.state === 'fail').map((i) => '"' + i.keyword + '" ' + i.count + '회');
    holdReasons.push('키워드 과반복: ' + bad.join('·'));
  }
  const hold = tone.hold || keywords.state === 'fail';
  const summary = [
    tone.summary,
    'D.I.A.+ ' + dia.hits + '/' + dia.total
  ].join(' · ');
  return {
    patterns: tone.patterns,
    hits: tone.hits,
    count: tone.count,
    hold,
    holdReasons,
    dia,
    keywords,
    stats: tone.stats,
    summary,
    version: tone.version
  };
}

if (typeof window !== 'undefined') {
  window.BlogAiTone = { lintAiTone, aiToneScan, diaGate, keywordCheck, headingsOf, sentencesOf, AI_TONE_DEFAULTS };
}
