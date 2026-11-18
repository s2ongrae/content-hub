/**
 * js/yt/titlelint.js — 제목 + 썸네일 한 쌍 린터 (한국어판)
 *
 * 원본: Jakeschincariol/youtube-agent-skill (MIT) skills/yt-package/title.py
 *   핵심은 '제목과 썸네일은 한 덩어리'라는 것. 따로 쓰면 썸네일이 제목을 반복하고,
 *   클릭 면적의 절반이 같은 말을 두 번 한다.
 *
 * 길이 보정: 원본은 60자(데스크톱)/40자(모바일)인데 그건 라틴 문자 폭 기준이다.
 *   한글은 라틴 문자의 약 2배 폭이므로, 글자 수 대신 '폭'으로 잰다(한글 1자 = 2).
 *   그래서 한글 제목은 대략 30자, 영문은 60자가 같은 기준선이 된다.
 */

const W_DESKTOP = 60;
const W_MOBILE = 40;
const W_HARD = 100;

const VAGUE = new Set(['최고', '최강', '완벽', '미친', '대박', '역대급', '엄청', '굉장', '모든', '유일', '혁명', '갓', '꿀', '레전드', '찐', '사기급', '압도적']);
const STOP = new Set(['그', '이', '저', '그리고', '진짜', '너무', '정말', '오늘', '여기', '거기', '것', '수', '때', '좀', '더', '잘', '안', '못', '좋은', '있는', '하는', '위한', '대한', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'and']);
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

const strip = (s) => String(s || '').replace(/[.,!?"'“”‘’·:;()[\]]/g, '');

export function textWidth(s) {
  let w = 0;
  for (const ch of String(s || '')) {
    const code = ch.codePointAt(0);
    if (code >= 0x1100 && code <= 0x11FF) w += 2;             // 한글 자모
    else if (code >= 0x2E80 && code <= 0xA4CF) w += 2;         // 한중일
    else if (code >= 0xAC00 && code <= 0xD7A3) w += 2;         // 한글 음절
    else if (code >= 0xFF00 && code <= 0xFF60) w += 2;         // 전각
    else if (EMOJI_RE.test(ch)) w += 3;                        // 이모지
    else w += 1;
  }
  return w;
}

const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);
const content = (t) => new Set(words(t).map(strip).filter((w) => w && !STOP.has(w)));

export function lintPackage({ title = '', thumb = '' } = {}) {
  const t = String(title).trim();
  const th = String(thumb).trim();
  const n = t.length;
  const w = textWidth(t);
  const issues = [];
  const good = [];

  if (w > W_HARD) issues.push(['length', `폭 ${w} — 유튜브 상한(폭 ${W_HARD})을 넘습니다`]);
  else if (w > W_DESKTOP) issues.push(['length', `폭 ${w} — 데스크톱 검색에서 폭 ${W_DESKTOP} 근처가 잘립니다(한글 약 30자)`]);
  else good.push(`폭 ${w} — 데스크톱 기준(폭 ${W_DESKTOP}) 안`);

  if (w > W_MOBILE) {
    // 모바일 피드에서 잘릴 지점의 앞부분을 보여 준다
    let acc = 0;
    let cut = t;
    for (let i = 0; i < t.length; i += 1) {
      acc += textWidth(t[i]);
      if (acc > W_MOBILE) { cut = t.slice(0, i); break; }
    }
    issues.push(['mobile', `모바일 피드는 "${cut}…" 까지 — 주어가 살아남는지 확인하세요`]);
  }

  const caps = words(t).filter((x) => /[A-Z]{2,}/.test(x));
  if (caps.length > 2) issues.push(['shouting', `대문자 강조 ${caps.length}개 — 2개가 상한입니다(스팸처럼 읽힘)`]);
  else if (caps.length) good.push('대문자 강조 1~2개');

  const vague = words(t).map(strip).filter((x) => VAGUE.has(x));
  if (vague.length) issues.push(['vague', `${[...new Set(vague)].join(', ')} — 숫자·이름·날짜로 바꾸세요`]);

  const nums = t.match(/\d[\d,.]*\s?(원|만원|천원|%|명|곳|개|번|분|초|잔|인분|kg|g|배|일|주|개월|년)?/g);
  if (nums && nums.length) good.push(`구체 숫자(${nums.slice(0, 3).join(', ')})`);
  else issues.push(['no-number', '숫자·날짜·이름이 없습니다 — 가장 확실한 한 가지 수정']);

  if (t.endsWith('?')) good.push('질문형 제목');
  const front = words(t).slice(0, 3).map(strip).filter((x) => x && !STOP.has(x));
  if (!front.length) issues.push(['front-load', '앞 세 어절이 전부 군더더기 — 주어를 앞으로']);

  const emoji = (t.match(EMOJI_RE) || []).length;
  if (emoji > 2) issues.push(['emoji', `이모지 ${emoji}개 — 피드에서 산만합니다(2개 이하)`]);

  if (th) {
    const tw = content(t);
    const hw = content(th);
    const shared = [...hw].filter((x) => tw.has(x));
    if (shared.length) issues.push(['duplicate', `썸네일이 제목과 같은 단어(${shared.slice(0, 4).join(', ')}) — 썸네일은 제목이 못 한 말을 해야 합니다`]);
    else good.push('썸네일과 제목이 다른 단어를 씀');
    const thWords = words(th).length;
    if (thWords > 4) issues.push(['thumb-length', `썸네일 ${thWords}단어 — 피드 크기에서는 3단어가 상한`]);
    if (textWidth(th) > 22) issues.push(['thumb-width', `썸네일 폭 ${textWidth(th)} — 1080px 썸네일에서 한 줄에 안 들어갑니다(폭 22 이하)`]);
  } else {
    issues.push(['no-thumb', '썸네일 문구를 같이 넣어야 한 쌍으로 채점됩니다']);
  }

  const score = Math.max(0, Math.min(100, 100 - 14 * issues.length + 4 * good.length));
  return { title: t, thumb: th, chars: n, width: w, score, issues, good };
}

export function rankTitles(list, thumb) {
  return list.map((t) => lintPackage({ title: t, thumb })).sort((a, b) => b.score - a.score);
}
