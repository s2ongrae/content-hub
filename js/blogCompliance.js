/**
 * js/blogCompliance.js — 블로그 공개 표시·네이버 기능 자동 처리 (2026-11-24)
 *
 * 근거: docs/BLOG_NATIVE_FEATURES_v1.md — 네이버 블로그 운영정책(내돈내산 조항) ·
 *       네이버 보도자료 2023-09-21 · 스레드 @just.jooit 게시물(2026-11-22) 실측.
 *
 * 이 파일이 하는 일(사람이 체크하지 않아도 되게):
 *   ① 대가성 문구를 본문 맨 앞에 **자동 배치**(이미 있으면 건드리지 않음 — 멱등)
 *   ② 내돈내산 × 수익형 링크 충돌을 **자동 판정**하고, 수익 링크를 걷어내는 동작을 제공
 *   ③ 네이버가 밀어주는 기능(내돈내산·글감·블로그씨·미션위젯)을 **발행 순서에 자동으로 끼워 넣는다**
 *
 * 순수 함수만 둔다(네트워크·저장 없음). 린터(blogLint)·블로그 키트(studioLogic)·화면(lintView)이 같이 쓴다.
 */

/** 표시광고법상 본문 맨 위에 텍스트로 남기는 문구. 이미지 표기는 원칙 위반이라 텍스트 그대로 쓴다. */
export const DISCLOSURE_TEXT = '※ 이 글은 업체로부터 서비스를 제공받아 작성했습니다(경제적 대가 있음).';

export const PAID_HINT_RE = /(체험단|협찬|제공\s*받|무상\s*으로?\s*제공|서비스\s*이용권|제품을\s*제공|원고료|광고비)/;
export const PAID_NOTICE_RE = /(경제적\s*대가|제공\s*받아\s*작성|대가를\s*받|무상으로\s*제공\s*받|협찬\s*받아\s*작성|본\s*게시물은.{0,20}제공\s*받)/;
export const OWN_MONEY_RE = /내돈내산/g;
export const PROFIT_LINK_RE = /(https?:\/\/[^\s]*(?:(?:connect|shopping)\.naver\.com|smartstore\.naver\.com|brand\.naver\.com|naver\.me\/|link\.coupang\.com|coupang\.com\/vp|partners\.coupang\.com|aliexpress\.com\/item)[^\s]*)/gi;
export const NATIVE_FEATURE_RE = /(내돈내산|글감|블로그씨|미션위젯|챌린지\s*프로그램|위젯)/;

const head400 = (body) => [...String(body || '')].slice(0, 400).join('');

/**
 * 본문 하나로 표시·충돌 상태를 판정한다.
 * @returns {{paid:boolean, noticeTop:boolean, noticeAnywhere:boolean,
 *            ownMoney:number, profitLinks:string[], conflict:boolean,
 *            state:'clean'|'needs_notice'|'conflict'|'notice_late'}}
 */
export function analyzeCompliance(body) {
  const text = String(body || '');
  const paid = PAID_HINT_RE.test(text);
  const noticeAnywhere = PAID_NOTICE_RE.test(text);
  const noticeTop = PAID_NOTICE_RE.test(head400(text));
  const ownMoney = (text.match(OWN_MONEY_RE) || []).length;
  const profitLinks = [];
  const re = new RegExp(PROFIT_LINK_RE.source, 'gi');
  let hit;
  while ((hit = re.exec(text))) {
    const url = String(hit[1] || hit[0]).trim();
    if (url && profitLinks.indexOf(url) < 0) profitLinks.push(url);
  }
  const conflict = ownMoney > 0 && profitLinks.length > 0;
  let state = 'clean';
  if (conflict) state = 'conflict';
  else if (paid && !noticeAnywhere) state = 'needs_notice';
  else if (paid && noticeAnywhere && !noticeTop) state = 'notice_late';
  return { paid, noticeTop, noticeAnywhere, ownMoney, profitLinks, conflict, state };
}

/** 본문 맨 앞에 대가성 문구를 넣는다. 이미 표기가 있으면 그대로 돌려준다(멱등). */
export function withDisclosureNote(body, text = DISCLOSURE_TEXT) {
  const b = String(body || '');
  if (PAID_NOTICE_RE.test(b)) return { body: b, added: false };
  const note = String(text || DISCLOSURE_TEXT).trim();
  return { body: note + '\n\n' + b.replace(/^\s+/, ''), added: true };
}

/**
 * 수익형(제휴) 링크를 본문에서 걷어낸다 — 내돈내산 인증을 살릴 때 쓰는 쪽.
 * 링크는 지우되 어떤 링크였는지는 돌려준다(사용자가 설명란으로 옮길 수 있게).
 */
export function stripProfitLinks(body) {
  const text = String(body || '');
  const removed = [];
  const re = new RegExp(PROFIT_LINK_RE.source, 'gi');
  const out = text.replace(re, (m, g1) => {
    const url = String(g1 || m);
    if (removed.indexOf(url) < 0) removed.push(url);
    return '';
  });
  return { body: out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), removed };
}

/** 내돈내산 표기를 지운다 — 제휴 링크를 살릴 때 쓰는 쪽. */
export function stripOwnMoney(body) {
  const text = String(body || '');
  const before = (text.match(OWN_MONEY_RE) || []).length;
  const out = text.replace(/\(?\s*내돈내산\s*\)?/g, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  return { body: out, removed: before };
}

/** 화면에 한 줄로 보여 줄 진단 문장. */
export function complianceLine(analysis) {
  const a = analysis || {};
  if (a.state === 'conflict') return '⛔ 내돈내산 인증 + 제휴 링크가 한 글에 있습니다 — 둘 중 하나를 빼야 합니다(운영정책·표시광고법)';
  if (a.state === 'needs_notice') return '⚠️ 대가를 받은 글인데 표시 문구가 없습니다 — 맨 위에 자동으로 넣었습니다';
  if (a.state === 'notice_late') return '⚠️ 표시 문구가 본문 뒤쪽에 있습니다 — 맨 위로 옮기세요';
  if (a.ownMoney) return '✅ 내돈내산 인증 글 — 제휴 링크 없이 유지하세요';
  if (a.profitLinks && a.profitLinks.length) return 'ℹ️ 제휴 링크 글이면 내돈내산 인증을 붙이지 마세요';
  return '✅ 표시·충돌 문제 없음';
}

/* ────────────────────────── 네이버 기능 자동 단계 ────────────────────────── */

const WIDGET_TARGETS = {
  절약: { label: '절약 100일', line: '📌 오늘 지출 기록은 블로그 「절약 100일」 미션위젯에 이어서 남깁니다.' },
  공부: { label: '공부(매주 1권)', line: '📌 이번 주 한 권은 블로그 「공부」 미션위젯에 함께 기록합니다.' },
  테마: { label: '나만의 테마(대전 청년)', line: '📌 대전 이야기는 「나만의 테마」 미션위젯에 모아 둡니다.' }
};

/**
 * 재료(장소·카테고리·메모)를 보고 **발행 순서에 끼울 네이버 기능 단계**를 만든다.
 * 사람이 기능 목록을 외우지 않아도 되게, 붙여넣기 키트의 단계로 들어간다.
 * @param {{place?:string, category?:string, memo?:string, paid?:boolean, blogseTopic?:string}} input
 * @returns {Array<{id:string,label:string,line:string,step:string}>}
 */
export function nativeSteps(input) {
  const i = input || {};
  const memo = String(i.memo || '');
  const place = String(i.place || '').trim();
  const category = String(i.category || '').trim();
  const analysis = analyzeCompliance(memo);
  const paid = i.paid === true || analysis.paid;
  const out = [];

  /* ① 내돈내산 — 대가를 받은 글이면 붙이지 않는다(붙이면 오히려 위반). */
  if (!paid) {
    out.push({
      id: 'own_money',
      label: '내돈내산 인증',
      step: '글쓰기 상단 [내돈내산] → 네이버페이 구매확정 6개월·예약 방문 1년 이내 내역 첨부(글당 10개까지)',
      line: '이 글은 직접 결제·방문한 기록만 적었습니다.'
    });
  } else {
    out.push({
      id: 'disclosure',
      label: '대가 표시',
      step: '본문 맨 위에 대가 표시 문구를 텍스트로 넣기(이미지 금지) — 아래 문구를 그대로 붙여넣으세요',
      line: DISCLOSURE_TEXT
    });
  }

  /* ② 글감 카드 — 종류에 따라 무엇을 카드로 만들지 알려 준다. */
  const kind = /(책|독서|서평|소설|에세이)/.test(memo + ' ' + category) ? '책'
    : /(영화|드라마|공연|전시)/.test(memo + ' ' + category) ? '영화·공연'
      : /(맛집|카페|식당|방문|예약)/.test(memo + ' ' + category) || place ? '장소'
        : '제품';
  out.push({
    id: 'gul_gam',
    label: '글감 카드',
    step: '사진을 본문에 넣은 뒤 글쓰기 우측 상단 [글감]에서 ' + kind + ' 카드를 붙이기 — 제목·가격 카드와 별점이 함께 남습니다',
    line: kind === '장소' ? '📍 ' + (place || '장소') + ' — 위치·영업·주차는 첫 화면에' : '📚 ' + kind + ' 카드로 정보를 구조화합니다.'
  });

  /* ③ 블로그씨 — 오늘의 주제가 우리 축이면 도입 한 줄로 연결. */
  const topic = String(i.blogseTopic || '').trim();
  out.push({
    id: 'blogse',
    label: '블로그씨',
    step: topic
      ? '블로그씨 오늘의 주제 「' + topic + '」로 도입 한 줄을 연결하기'
      : '블로그씨 오늘의 주제를 확인하고, 우리 축(대전·유성·청년·절약)에 닿으면 그 주제로 도입 한 줄',
    line: topic ? '블로그씨 주제 「' + topic + '」로 시작해 봅니다.' : ''
  });

  /* ④ 미션위젯 — 글 성격에 맞는 목표 하나만 고른다. */
  const w = /(지출|가계부|절약|저축|예산)/.test(memo + ' ' + category) ? WIDGET_TARGETS.절약
    : /(책|독서|공부|자격증|강의)/.test(memo + ' ' + category) ? WIDGET_TARGETS.공부
      : WIDGET_TARGETS.테마;
  out.push({
    id: 'widget',
    label: '미션위젯',
    step: '블로그 왼쪽 아래 [위젯] → 「' + w.label + '」 위젯이 달려 있는지 확인하고, 본문 끝에 한 줄로 연결',
    line: w.line
  });
  return out;
}

/** 붙여넣기 순서 문장에 네이버 기능 단계를 합친다. */
export function mergePasteSteps(steps, native) {
  const list = (Array.isArray(steps) ? steps : []).slice();
  const nat = Array.isArray(native) ? native : [];
  /* 임시저장 문구 바로 앞에 끼운다 — 마지막 두 단계(임시저장·발행)는 항상 끝. */
  const cut = Math.max(0, list.length - 1);
  const inserted = nat.map((n) => n.step);
  return list.slice(0, cut).concat(inserted, list.slice(cut));
}

if (typeof window !== 'undefined') {
  window.BlogCompliance = { analyzeCompliance, withDisclosureNote, stripProfitLinks, stripOwnMoney, nativeSteps, DISCLOSURE_TEXT };
}
