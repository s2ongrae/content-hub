/**
 * js/assembler.js — 원스톱 조립기 (블로그 코어)
 *
 * 두 모드가 있다.
 *  - preserve: 사용자가 쓴 원문(USER 블록)을 **글자 그대로** 두고 앞(정보 카드)·뒤(링크 카드·해시태그)만 붙인다.
 *  - draft: 원문이 없거나 한두 줄뿐일 때 seeds/skills/tone_reference_v1.md 의 리듬으로 새로 쓴다.
 *
 * 불변식(스펙 §6.1)
 *  - USER 블록은 읽기만 한다(Object.freeze). 조립 뒤 sha256(USER join)이 원본과 다르면 실패.
 *  - 링크는 줄글 URL 금지: `설명 한 줄` + `[LINK_CARD: url]` 두 줄.
 *  - 확인 못 한 수치는 `[확인 필요]`로 비운다. 지어내지 않는다.
 */

import { sha256Hex, userBodyText, splitUserBlocks } from './slot-engine.js?v=20261119a';

export const BANNED_PHRASES = [
  '결론적으로', '다양한 매력을', '입안 가득', '라고 할 수 있습니다', '방법입니다', '어떨까요',
  '최고의', '완벽한', '역대급'
];

const LINK_FORBIDDEN = ['여기', '링크', '클릭', '참고', '바로가기'];

export const PASTE_STEPS = [
  '카드 앞에 설명 한 줄을 쓰고 Enter',
  'URL만 붙여넣고 Enter',
  '네이버가 링크 카드를 만들 때까지 최대 3초 기다리기',
  '카드 위아래에 남은 URL 글자를 지워 카드만 남기기'
];

const clean = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim();
const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n || 40);

/** 원문 블록을 건드릴 수 없게 얼린다. */
export function freezeBlocks(blocks) {
  const list = (Array.isArray(blocks) ? blocks : []).map((b) => Object.freeze(Object.assign({}, b)));
  return Object.freeze(list);
}

export function buildCore({ facts, blocks, media, brand }) {
  const f = Object.assign({}, facts || {});
  const frozen = freezeBlocks(blocks);
  return { facts: f, blocks: frozen, media: media || [], brand: brand || 'daejeon_youth', user_body_sha256: '' };
}

/** 해시태그 10~12개. 핵심 3개(대전맛집·유성맛집·동네맛집)를 반드시 포함한다. */
export function makeHashtags(facts) {
  const f = facts || {};
  const dong = clean(f.region_dong).replace(/\s+/g, '');
  const place = clean(f.place_name).replace(/\s+/g, '');
  const cat = clean(f.category).replace(/\s+/g, '');
  const kws = String(f.target_keywords || '').split(',').map((s) => s.trim().replace(/\s+/g, '')).filter(Boolean);
  const catClean = cat ? cat.replace(/[·/]/g, '') : '';
  const out = ['대전맛집', '유성맛집', dong ? dong + '맛집' : ''].concat(kws, [place, catClean, '내돈내산', '대전청년']);
  // 10개를 못 채우면 같은 재료로 만든 변형을 채운다(억지 신조어 금지)
  const spare = [dong ? dong + catClean : '', catClean ? catClean + '맛집' : '', dong ? '대전' + dong : '', place ? place + '후기' : '', dong ? dong + '야장' : ''];
  spare.forEach((t) => { if (t) out.push(t); });
  const uniq = [];
  out.forEach((t) => {
    const v = String(t || '').replace(/^#/, '').trim();
    if (v && v.length <= 12 && uniq.indexOf(v) < 0) uniq.push(v);
  });
  return uniq.slice(0, 12).map((t) => '#' + t);
}

/** 정보 카드 줄. 빈 값은 통째로 생략한다(지어내지 않는다). */
export function factLines(facts) {
  const f = facts || {};
  const rows = [
    ['📍 위치', clean(f.address) || clean(f.region_dong)],
    ['⏰ 영업', clean(f.hours)],
    ['🚫 휴무', clean(f.closed_days)],
    ['🚗 주차', clean(f.parking)],
    ['⏳ 대기', clean(f.wait_time)],
    ['💰 값', clean(f.price_menu)],
    ['☎ 전화', clean(f.tel)]
  ];
  return rows.filter((r) => r[1]).map((r) => r[0] + ' : ' + r[1]);
}

function linkBlock(linkTargets) {
  const list = (Array.isArray(linkTargets) ? linkTargets : []).filter((l) => l && l.url).slice(0, 2);
  return list.map((l) => {
    const anchor = clean(l.anchor || l.title || '같은 동네 다른 편');
    return '👉 ' + anchor + '\n[LINK_CARD: ' + l.url.trim() + ']';
  }).join('\n\n');
}

/** 블로그 제목 — 26~45자, 앞 14자에 지역+메뉴 */
export function blogTitle(facts, blocks) {
  const f = facts || {};
  const dong = clean(f.region_dong) || '대전';
  const menu = clean(f.category).split(/[·,/]/)[0].trim() || '맛집';
  const place = clean(f.place_name) || '[가게 이름]';
  const first = (blocks || []).find((b) => b.origin === 'USER');
  const seedLine = first ? oneLine(first.text.split('\n')[0], 30) : '';
  const tail = seedLine && seedLine.length >= 6 ? seedLine : '[한 줄 확인 필요]';
  const title = '[' + dong + ' ' + menu + '] ' + place + ' 솔직후기 : "' + tail + '"';
  return title.length > 45 ? title.slice(0, 44) + '…' : title;
}

/** draft 모드 골격 — 톤 레퍼런스(두 줄 호흡·숫자 그대로·`[확인 필요]`) */
function draftBlocks(facts) {
  const f = facts || {};
  const dong = clean(f.region_dong) || '[동네 확인 필요]';
  const place = clean(f.place_name) || '[가게 확인 필요]';
  const price = clean(f.price_menu) || '[가격 확인 필요]';
  const wait = clean(f.wait_time) || '[대기 확인 필요]';
  const parking = clean(f.parking) || '[주차 확인 필요]';
  return [
    '요즘 ' + dong + ' 쪽은\n저녁이면 어김없이 만석입니다.\n\n' + place + ', 오늘도\n문 앞에 줄이 서 있었습니다.',
    '숫자부터 말하면\n' + price + '.\n\n' + wait + ' 기다리고\n겨우 앉았습니다.',
    '한 점 먹고 나서\n생각이 바뀌었습니다.\n\n' + dong + '에서 이 정도면\n충분히 다시 옵니다.',
    '다만 ' + parking + '.\n\n이건 미리 알고 가셔야\n덜 힘듭니다.'
  ].join('\n\n');
}

/**
 * 블로그 조립.
 * @param {{facts:object, blocks:object[], media:object[], mode?:'preserve'|'draft', linkTargets?:object[], brand?:string}} input
 */
export async function composeBlog(input) {
  const opts = input || {};
  const f = Object.assign({}, opts.facts || {});
  const mode = opts.mode === 'draft' ? 'draft' : 'preserve';
  const provided = (opts.blocks || []).filter((b) => b && b.origin === 'USER');

  let userBlocks;
  if (mode === 'draft' && !provided.length) {
    userBlocks = splitUserBlocks(draftBlocks(f));
  } else {
    userBlocks = provided;
  }
  const frozen = freezeBlocks(userBlocks);
  const originalHash = await sha256Hex(userBodyText(frozen));

  const photos = (opts.media || []).filter((m) => m.kind !== 'VIDEO').slice(0, 22);
  const perBlock = Math.max(1, Math.ceil(photos.length / Math.max(frozen.length, 1)));
  const bodyParts = [];
  let used = 0;
  frozen.forEach((b, i) => {
    bodyParts.push(b.text);
    const chunk = photos.slice(i * perBlock, (i + 1) * perBlock);
    chunk.forEach((p) => { if (p && p.name) { bodyParts.push('[[PHOTO:' + p.name + ']]'); used += 1; } });
  });
  photos.slice(used).forEach((p) => { if (p && p.name) bodyParts.push('[[PHOTO:' + p.name + ']]'); });
  const body = bodyParts.filter((s, i, arr) => !(s === '' && arr[i - 1] === '')).join('\n\n').trim();

  const info = factLines(f);
  const place = clean(f.place_name) || '[가게 이름]';
  const greeting = opts.brand === 'ppiyak_kimmary' ? '안녕하세요, 삐약 김메리 집사입니다.' : '안녕하세요, 대전 청년입니다.';
  const head = [greeting, '', '📍 ' + place + (clean(f.region_dong) ? ' / ' + clean(f.region_dong) : '')]
    .concat(info.length ? ['', ...info] : [])
    .concat(info.length ? ['', '급하신 분은 위 ' + info.length + '줄만 보고 가셔도 됩니다.'] : [])
    .join('\n');

  const last = frozen.length ? frozen[frozen.length - 1].text.split('\n').map((s) => s.trim()).filter(Boolean).pop() : '';
  const conclusion = last && last.length <= 60 ? last : '[한 줄 결론 확인 필요]';
  const tags = makeHashtags(f);
  const links = linkBlock(opts.linkTargets);
  const tail = ['**한 줄 결론**', conclusion, links, tags.join(' ')].filter((s) => s && s.trim()).join('\n\n');

  const title = blogTitle(f, frozen);

  /* 재검증: 조립에 쓴 USER 문자열이 조금이라도 달라졌으면 실패 */
  const afterHash = await sha256Hex(userBodyText(frozen));
  if (afterHash !== originalHash) {
    return { ok: false, mode, reason: 'BODY_CHANGED', user_body_sha256: originalHash, title, head, body, tail, hashtags: tags, link_cards: [] };
  }

  const text = [title, '', head, '', body, '', tail].join('\n');
  const bannedHits = BANNED_PHRASES.filter((w) => text.indexOf(w) >= 0);
  const twoLineBlocks = frozen.filter((b) => b.text.split('\n').length >= 2).length;
  const placeholders = (text.match(/\[[^\]]*확인 필요[^\]]*\]/g) || []).length;
  const exposedUrl = /https?:\/\//.test(text.replace(/\[LINK_CARD:[^\]]*\]/g, ''));

  return {
    ok: true,
    mode,
    title,
    head,
    body,
    tail,
    text,
    hashtags: tags,
    link_cards: (opts.linkTargets || []).filter((l) => l && l.url).slice(0, 2).map((l) => ({ url: l.url, anchor: clean(l.anchor || l.title) })),
    paste_steps: PASTE_STEPS,
    user_body_sha256: originalHash,
    tone_checks: {
      two_line: twoLineBlocks,
      banned: bannedHits,
      placeholders,
      exposed_url: exposedUrl,
      link_anchor_ok: (opts.linkTargets || []).every((l) => {
        const a = clean(l && (l.anchor || l.title));
        return a.length >= 5 && !LINK_FORBIDDEN.some((w) => a.indexOf(w) >= 0);
      })
    }
  };
}

if (typeof window !== 'undefined') {
  window.OnestopAssembler = { composeBlog, buildCore, makeHashtags, factLines, blogTitle, PASTE_STEPS };
}
