/**
 * js/studioLogic.js — 제작·생성 스튜디오의 '계산' 부분 (화면 없음, 2026-11-21 O1/O2b)
 *
 * 왜 화면과 나누나: 포맷 3개·재료 4칸·사진 자동 배치·붙여넣기 키트·4:5 카드·AI 초안 요청은
 * 전부 규칙 계산이다. 노드에서 그대로 돌려 시험할 수 있게 화면(createStudio.js)과 분리한다.
 *
 * 원칙 (docs/CONTENT_STANDARD_v3.md · 확정 설계 2026-11-20 §4·§5)
 *  · 값은 지어내지 않는다 — 모르는 칸은 [채우기]로 남긴다.
 *  · 사용자 원문(메모)은 한 글자도 고치지 않는다. AI 는 USER 블록 **사이**에만 문장을 넣는다.
 *  · 사진 순서는 자동(외관→메뉴판→음식→분위기→마무리). 사용자가 직접 만진 순서는 존중한다.
 *  · 카드 payload 쓰기는 언제나 studio.formats.<format> 안으로만. 구 studio 루트는 읽기 폴백만(1줄 롤백).
 */

import { splitUserBlocks, sha256Hex, userBodyText } from './slot-engine.js?v=20261121g';
import { rhythmStats, lintRhythm, splitLongBlock, applyBlogRhythm, RHYTHM, PRESETS as BLOG_TONE_PRESETS } from './blogTone.js?v=20261121g';

/* ────────────────────────── 포맷 ────────────────────────── */

export const FORMATS = [
  { id: 'blog', label: '블로그 글', emoji: '📝', sub: '사진 + 장소 + 내용 → 초안·임시저장 키트' },
  { id: 'video', label: '영상 (숏폼·롱폼)', emoji: '🎬', sub: '영상·사진 → 대본·자막·TTS·렌더 완제품' },
  { id: 'feed', label: '인스타 피드/카드뉴스', emoji: '📷', sub: '사진 → 4:5 카드 + 캡션·해시태그' }
];
export const FORMAT_IDS = FORMATS.map((f) => f.id);
export const TRACK_B_NOTE = '반려동물 채널은 영상만 지원해 영상 스튜디오로 이동했어요';

/** 이 트랙에서 쓸 수 있는 포맷. 삐약 김메리(트랙 B)는 영상만. */
export function formatsFor(brand) {
  return brand === 'ppiyak_kimmary' ? ['video'] : FORMAT_IDS.slice();
}

/** 해시 라우트(create/blog …)에서 포맷을 고른다. 쓸 수 없는 포맷이면 빈 문자열(선택 화면). */
export function pickFormat(routePart, brand) {
  const id = String(routePart || '').trim().toLowerCase();
  if (FORMAT_IDS.indexOf(id) < 0) return '';
  return formatsFor(brand).indexOf(id) >= 0 ? id : '';
}

export function formatLabel(id) {
  const f = FORMATS.find((x) => x.id === id);
  return f ? f.label : '';
}

/* ────────────────────────── 개념·톤 ────────────────────────── */

export const CONCEPT_KINDS = [
  { id: 'review', label: '맛집 리뷰' },
  { id: 'story', label: '일상 썰' },
  { id: 'info', label: '정보성' }
];
export const TONES = [
  { id: 'plain', label: '담백' },
  { id: 'hype', label: '호들갑' },
  { id: 'chungcheong', label: '충청도 아저씨' }
];
export const VIDEO_LENGTHS = [15, 30, 60];

export function conceptKindLabel(id) {
  const k = CONCEPT_KINDS.find((x) => x.id === id);
  return k ? k.label : '맛집 리뷰';
}
export function toneLabel(id) {
  const t = TONES.find((x) => x.id === id);
  return t ? t.label : '담백';
}
/** 톤 → 노트북 TTS 파라미터(설계 §5②). 화면에 그대로 보여 주고, 오더에는 id 로 보낸다. */
export const TTS_OF_TONE = {
  plain: { rate: '+6%', pitch: '+0Hz', volume: '+0%' },
  hype: { rate: '+18%', pitch: '+6Hz', volume: '+10%' },
  chungcheong: { rate: '-4%', pitch: '-3Hz', volume: '+0%' }
};

export function defaultConcept() {
  return { kind: 'review', tone: 'plain', hint: '' };
}

/* ────────────────────────── 재료 ────────────────────────── */

export function emptyMaterials() {
  return {
    photos: [],
    place: { name: '', naver_url: '', kakao_url: '' },
    content: {
      memo: '', hours: '', closed_days: '', price_menu: '', parking: '', wait_time: '',
      tel: '', address: '', region_dong: '', category: ''
    },
    concept: defaultConcept(),
    video: { length_sec: 30 }
  };
}

/** 얕은 병합이 아니라 재료 한 벌을 통째로 맞춘다(빠진 키를 기본값으로 채운다). */
export function normalizeMaterials(raw) {
  const base = emptyMaterials();
  const m = raw && typeof raw === 'object' ? raw : {};
  const out = {
    photos: Array.isArray(m.photos) ? m.photos.map(normalizePhoto).filter((p) => p.name) : [],
    place: Object.assign(base.place, m.place && typeof m.place === 'object' ? m.place : {}),
    content: Object.assign(base.content, m.content && typeof m.content === 'object' ? m.content : {}),
    concept: Object.assign(base.concept, m.concept && typeof m.concept === 'object' ? m.concept : {}),
    video: Object.assign(base.video, m.video && typeof m.video === 'object' ? m.video : {})
  };
  const len = Number(out.video.length_sec);
  out.video.length_sec = VIDEO_LENGTHS.indexOf(len) >= 0 ? len : 30;
  if (CONCEPT_KINDS.map((k) => k.id).indexOf(out.concept.kind) < 0) out.concept.kind = 'review';
  if (TONES.map((t) => t.id).indexOf(out.concept.tone) < 0) out.concept.tone = 'plain';
  Object.keys(out.content).forEach((k) => { out.content[k] = out.content[k] == null ? '' : String(out.content[k]); });
  return out;
}

export function normalizePhoto(p) {
  const o = p && typeof p === 'object' ? p : {};
  return {
    id: String(o.id || ''),
    name: String(o.name || ''),
    role: String(o.role || ''),
    order: Number.isFinite(Number(o.order)) ? Number(o.order) : null,
    caption: String(o.caption || ''),
    bytes: Number(o.bytes) || 0,
    width: Number(o.width) || 0,
    height: Number(o.height) || 0,
    uploaded: !!o.uploaded,
    manual: !!o.manual
  };
}

/* ────────────────────────── 사진 역할·자동 배치 ────────────────────────── */

/* 설계 §4.1 기본 순서: 외관(1~2) → 메뉴판(1) → 음식(4~14) → 분위기(15~18) → 영수증·마무리(19~22) */
export const PHOTO_ROLES = ['외관', '메뉴판', '음식', '분위기', '마무리'];
const ROLE_ORDER = { '외관': 0, '메뉴판': 1, '음식': 2, '분위기': 3, '마무리': 4 };
const ROLE_RULES = [
  ['마무리', /(영수증|receipt|계산서|마무리|끝|leave|나오는)/i],
  ['메뉴판', /(메뉴판|메뉴|가격표|menu)/i],
  ['분위기', /(분위기|내부|인테리어|테이블|자리|야장|창가|사람|ambience|table|inside)/i],
  ['외관', /(외관|입구|간판|정문|가게|매장|건물|front|store|sign)/i],
  ['음식', /(음식|고기|삼겹|냉삼|찌개|국수|밥|술|안주|커피|디저트|food|dish|plate)/i]
];

/** 파일 이름으로 역할을 추정한다. 못 알아보면 '음식'(가운데)으로 둔다 — 순서만 정할 뿐 내용은 안 지어낸다. */
export function photoRole(name) {
  const s = String(name || '');
  for (let i = 0; i < ROLE_RULES.length; i++) if (ROLE_RULES[i][1].test(s)) return ROLE_RULES[i][0];
  return '음식';
}

/** 자동 순서 — 역할 순으로 안정 정렬한다(같은 역할 안에서는 올린 순서 그대로). */
export function autoOrderPhotos(photos) {
  const list = (Array.isArray(photos) ? photos : []).map((p, i) => {
    const n = normalizePhoto(p);
    return Object.assign({}, n, { id: n.id || 'p' + String(i + 1).padStart(2, '0'), role: n.role || photoRole(n.name), _i: i });
  });
  list.sort((a, b) => {
    const ra = ROLE_ORDER[a.role] === undefined ? 2 : ROLE_ORDER[a.role];
    const rb = ROLE_ORDER[b.role] === undefined ? 2 : ROLE_ORDER[b.role];
    return ra !== rb ? ra - rb : a._i - b._i;
  });
  return list.map((p, i) => {
    const out = Object.assign({}, p, { order: i + 1 });
    delete out._i;
    return out;
  });
}

/** 이 포맷에서 쓸 사진 장수. 블로그 18~22 · 영상 5/8/15 · 피드 6. 가진 장수가 모자라면 가진 만큼. */
export function photoCountFor(format, opts) {
  const o = opts || {};
  const have = Number(o.available);
  const target = (function () {
    if (format === 'blog') return 22;
    if (format === 'feed') return 6;
    if (format === 'video') {
      const len = Number(o.lengthSec);
      if (len === 15) return 5;
      if (len === 60) return 15;
      return 8;
    }
    return 0;
  })();
  if (!Number.isFinite(have) || have < 0) return target;
  return Math.min(have, target);
}

export function photoPlanFor(format, opts) {
  const o = opts || {};
  const ordered = autoOrderPhotos(o.photos || []);
  const target = photoCountFor(format, { lengthSec: o.lengthSec });
  const count = photoCountFor(format, { available: ordered.length, lengthSec: o.lengthSec });
  const min = format === 'video' ? 5 : 1;
  return {
    count: count,
    target: target,
    min: min,
    enough: count >= min,              // 렌더·제작이 가능한 최소 장수
    meets_target: count >= target,     // 이 길이에 권장하는 장수(모자라도 렌더는 된다)
    missing: Math.max(0, target - count),
    photos: ordered.slice(0, count),
    rest: ordered.slice(count)
  };
}

/** 접힌 재료 바에 보일 한 줄: "사진 12장 · 미미삼겹 · 맛집 리뷰" */
export function materialSummary(materials) {
  const m = normalizeMaterials(materials);
  const bits = [];
  bits.push('사진 ' + m.photos.length + '장');
  if (m.place.name.trim()) bits.push(m.place.name.trim());
  bits.push(conceptKindLabel(m.concept.kind) + (m.concept.hint.trim() ? ' · ' + m.concept.hint.trim().slice(0, 20) : ''));
  return bits.join(' · ');
}

/** 가게 팩트(슬롯 엔진·조립기가 쓰는 키)로 옮긴다. */
export function factsOf(materials) {
  const m = normalizeMaterials(materials);
  const c = m.content;
  return {
    place_name: m.place.name.trim(),
    region_dong: c.region_dong.trim(),
    category: c.category.trim(),
    cluster_id: '',
    target_keywords: '',
    naver_place_url: m.place.naver_url.trim(),
    hours: c.hours.trim(),
    closed_days: c.closed_days.trim(),
    parking: c.parking.trim(),
    wait_time: c.wait_time.trim(),
    price_menu: c.price_menu.trim(),
    tel: c.tel.trim(),
    address: c.address.trim(),
    receipt_verified: false
  };
}

export function hasMaterial(materials) {
  const m = normalizeMaterials(materials);
  return !!(m.place.name.trim() || m.content.memo.trim() || m.photos.length);
}

/* ────────────────────────── 블로그 키트(즉시·0토큰) ────────────────────────── */

const FILL = '[채우기]';

/** 가격 문자열에서 첫 숫자 덩어리만("삼겹 16,000원 · 짜파게티 6,500원" → "16,000원"). */
export function firstPrice(text) {
  const m = String(text || '').match(/([0-9][0-9,]{2,})\s*원/);
  return m ? m[1] + '원' : '';
}

export function titleOptions(materials, opts) {
  const m = normalizeMaterials(materials);
  const o = opts || {};
  const place = m.place.name.trim() || FILL;
  const dong = m.content.region_dong.trim() || FILL;
  const kind = conceptKindLabel(m.concept.kind);
  const price = firstPrice(m.content.price_menu);
  const wait = m.content.wait_time.trim();
  const n = o.photoCount || m.photos.length;
  return [
    '[' + dong + '] ' + place + ' ' + kind + ' — 솔직 후기',
    price ? place + ', ' + price + ' 먹고 왔습니다' : place + ' 다녀왔습니다 — 확인한 것만 적었습니다',
    wait ? place + ' 대기 ' + wait + ' · 실제로 겪은 것' : place + ' ' + kind + ' · 사진 ' + n + '장 정리'
  ];
}

/**
 * 사진을 문단 사이에 자동 배치한다. 사진 수가 문단보다 많으면 한 문단에 여러 장(첫 문단 앞=표지).
 * 사용자가 직접 순서를 만진 사진(manual)은 그 순서를 유지한다(자동 재정렬은 안 만진 것만).
 */
export function planPhotoPositions(blocks, photos) {
  const list = Array.isArray(blocks) ? blocks : [];
  const ps = Array.isArray(photos) ? photos : [];
  if (!ps.length) return [];
  const out = [];
  const slots = list.length + 1;               // 0 = 본문 앞(표지 자리)
  for (let i = 0; i < ps.length; i++) {
    const slot = i < slots ? i : (i % slots);
    out.push({ photo: ps[i].name, role: ps[i].role, caption: ps[i].caption || '', slot: slot, after_block: slot === 0 ? null : list[slot - 1].id || ('U' + String(slot).padStart(2, '0')) });
  }
  return out;
}

/** 빈 슬롯에만 15~25자 사실 묘사 캡션. 직접 쓴 캡션은 덮지 않는다. */
export function captionFor(photo, materials) {
  const p = photo || {};
  if (String(p.caption || '').trim()) return String(p.caption).trim();
  const m = normalizeMaterials(materials);
  const role = p.role || photoRole(p.name);
  const place = m.place.name.trim();
  const price = firstPrice(m.content.price_menu);
  const byRole = {
    '외관': place ? place + ' 입구 모습' : '가게 입구 모습',
    '메뉴판': price ? '메뉴판 — ' + price + '부터' : '메뉴판 사진',
    '음식': m.content.category.trim() ? m.content.category.trim() + ' 메뉴' : '주문한 메뉴',
    '분위기': place ? place + ' 안쪽 자리' : '매장 안쪽 분위기',
    '마무리': '계산하고 나오는 길'
  };
  return byRole[role] || '현장 사진';
}

/**
 * 블로그 붙여넣기 키트 — 제목 3안 · 원문 그대로의 본문 · 사진 위치표 · 링크카드 자리 · 붙이는 순서.
 *  AI 없이 만든다(토큰 0). AI 초안은 이 키트의 '사이 문장·캡션·마무리'만 채운다.
 */
export function buildBlogKit(input) {
  const i = input || {};
  const materials = normalizeMaterials(i.materials);
  const blocks = (Array.isArray(i.blocks) ? i.blocks : splitUserBlocks(materials.content.memo))
    .filter((b) => b && String(b.text || '').trim());
  const ps = autoOrderPhotos(i.photos || materials.photos);
  const plan = planPhotoPositions(blocks, ps);
  const captions = plan.map((x) => {
    const p = ps.find((q) => q.name === x.photo) || {};
    return { name: x.photo, role: x.role, text: captionFor(p, materials), auto: !String(p.caption || '').trim() };
  });
  const titles = titleOptions(materials, { photoCount: ps.length });
  const links = (Array.isArray(i.links) ? i.links : []).filter((l) => l && String(l.url || '').trim())
    .map((l) => ({ url: String(l.url).trim(), title: String(l.title || '').trim() }));

  const lines = [];
  lines.push('■ 제목 후보 3');
  titles.forEach((t, n) => lines.push((n + 1) + ') ' + t));
  lines.push('');
  lines.push('■ 본문 — 내가 쓴 문단은 그대로, 사이 빈 줄에 사진을 넣습니다');
  const first = plan.filter((x) => x.slot === 0);
  first.forEach((x) => lines.push('   [표지 사진] ' + x.photo + ' — ' + (captions.find((c) => c.name === x.photo) || {}).text));
  blocks.forEach((b, n) => {
    lines.push('');
    lines.push(b.text);
    plan.filter((x) => x.after_block === (b.id || 'U' + String(n + 1).padStart(2, '0'))).forEach((x) => {
      lines.push('   [사진] ' + x.photo + ' — ' + (captions.find((c) => c.name === x.photo) || {}).text);
    });
  });
  lines.push('');
  lines.push('■ 마무리 한 문단');
  lines.push(i.outro || (materials.place.name.trim()
    ? materials.place.name.trim() + ' — 위 내용은 직접 가서 확인한 것만 적었습니다. 가기 전에 영업시간은 한 번 더 확인하세요.'
    : FILL + ' 마무리 문단'));
  lines.push('');
  lines.push('■ 링크 카드 자리 ' + (links.length ? links.length + '개' : '(없음 — 넣을 내 글 링크를 정하세요)'));
  links.forEach((l, n) => lines.push((n + 1) + '. ' + (l.title || l.url) + ' → ' + l.url));

  const paste_steps = [
    '네이버 블로그 글쓰기 → 제목은 1안부터',
    '본문 첫 줄에 표지 사진을 넣고 캡션 한 줄',
    '문단을 붙여넣고, 표시된 자리에 사진을 순서대로 넣기(사진당 캡션 1줄)',
    '링크 카드를 ' + (links.length || 0) + '개 붙이기(본문에 URL 줄글 금지)',
    '지도·영업시간은 네이버 place 정보로 한 번 더 확인',
    '임시저장 → 내가 직접 읽고 발행'
  ];

  // 2줄 호흡 점검 — 원문은 그대로 두고 '지금 어떤 상태인지'만 계산한다(고치기는 사용자가 누를 때).
  const bodyText = blocks.map((b) => b.text).join('\n\n');
  const rhythm = {
    stats: rhythmStats(bodyText),
    issues: lintRhythm(bodyText),
    preset: (materials.concept && materials.concept.tone) || 'plain'
  };

  return {
    titles: titles,
    blocks: blocks,
    photo_plan: plan,
    captions: captions,
    outro: i.outro || '',
    links: links,
    paste_steps: paste_steps,
    text: lines.join('\n'),
    rhythm: rhythm,
    user_body_sha256: ''
  };
}

/** 키트의 원문 해시(호출자가 채운다 — 브라우저·노드 모두 crypto.subtle 필요). */
export async function signKit(kit) {
  const text = userBodyText((kit && kit.blocks) || []);
  return Object.assign({}, kit, { user_body_sha256: await sha256Hex(text) });
}

/* ────────────────────────── 인스타 피드(4:5 카드 6장) ────────────────────────── */

export const FEED_CARDS = 6;

export function buildFeedCards(input) {
  const i = input || {};
  const materials = normalizeMaterials(i.materials);
  const ps = autoOrderPhotos(i.photos || materials.photos);
  const c = materials.content;
  const place = materials.place.name.trim();
  const dong = c.region_dong.trim();
  const cat = c.category.trim();
  const firstBlock = (Array.isArray(i.blocks) ? i.blocks : splitUserBlocks(c.memo))[0];
  const pick = (n) => (ps.length ? ps[n % ps.length].name : '');

  const cards = [
    {
      no: 1, kicker: [dong, cat].filter(Boolean).join(' · ') || FILL, headline: place || FILL,
      body: materials.concept.hint.trim() || '직접 가서 확인한 것만 적었습니다', photo: pick(0), role: '외관'
    },
    {
      no: 2, kicker: '가는 길 · 영업', headline: c.hours.trim() || FILL,
      body: [c.closed_days.trim() ? '휴무 ' + c.closed_days.trim() : '', c.parking.trim() ? '주차 ' + c.parking.trim() : '', c.address.trim(), c.tel.trim()].filter(Boolean).join(' · ') || FILL,
      photo: pick(1), role: '외관'
    },
    {
      no: 3, kicker: '메뉴 · 가격', headline: firstPrice(c.price_menu) || FILL,
      body: c.price_menu.trim() || FILL, photo: pick(2), role: '메뉴판'
    },
    {
      no: 4, kicker: '실제로 겪은 것', headline: (firstBlock && String(firstBlock.text || '').split('\n')[0].slice(0, 28)) || FILL,
      body: firstBlock ? String(firstBlock.text).slice(0, 120) : FILL, photo: pick(3), role: '음식'
    },
    {
      no: 5, kicker: '알아두면', headline: c.wait_time.trim() || FILL,
      body: [c.wait_time.trim() ? '대기 ' + c.wait_time.trim() : '', materials.concept.hint.trim()].filter(Boolean).join(' · ') || FILL,
      photo: pick(4), role: '분위기'
    },
    {
      no: 6, kicker: '저장해 두세요', headline: place || FILL,
      body: [dong, cat].filter(Boolean).join(' · ') || FILL, photo: pick(5), role: '마무리'
    }
  ];
  return cards;
}

export function feedCaption(materials) {
  const m = normalizeMaterials(materials);
  const place = m.place.name.trim();
  const dong = m.content.region_dong.trim();
  const kind = conceptKindLabel(m.concept.kind);
  const bits = [place ? '[' + (dong || '대전') + '] ' + place : FILL];
  bits.push(m.concept.hint.trim() || kind + ' 다녀왔습니다. 확인한 것만 적었어요.');
  if (m.content.price_menu.trim()) bits.push('가격은 ' + (firstPrice(m.content.price_menu) || FILL) + '부터.');
  bits.push('자세한 건 사진 순서대로 보세요.');
  return bits.join(' ');
}

export function hashtagsOf(materials) {
  const m = normalizeMaterials(materials);
  const tags = [];
  const add = (t) => { const s = String(t || '').replace(/[^0-9A-Za-z가-힣_]/g, ''); if (s && tags.indexOf('#' + s) < 0) tags.push('#' + s); };
  if (m.content.region_dong.trim()) add(m.content.region_dong.trim());
  if (m.content.region_dong.trim() && m.content.category.trim()) add(m.content.region_dong.trim() + m.content.category.trim());
  if (m.content.category.trim()) add(m.content.category.trim());
  add(conceptKindLabel(m.concept.kind).replace(/\s+/g, ''));
  if (m.place.name.trim()) add(m.place.name.trim());
  add('대전맛집');
  return tags.slice(0, 5);
}

/* ────────────────────────── AI 초안 오더(content_draft) ────────────────────────── */

export const DRAFT_PAYLOAD_LIMIT = 3500;   // 큐 한도 4,000자 — 넘으면 payload_source:'drive'

export function payloadChars(obj) {
  try { return JSON.stringify(obj || {}).length; } catch (e) { return 0; }
}

/**
 * 노트북에 보낼 content_draft 요청을 만든다.
 *  · USER 블록은 \n\n 단위로 쪼개 각각 sha256 을 붙인다 — 노트북이 사이에만 문장을 넣고,
 *    허브가 돌려받은 결과의 USER 블록을 다시 해싱해 다르면 폐기한다(3중 잠금).
 *  · 직렬화가 3,500자를 넘으면 blocks·facts 를 빼고 payload_source:'drive' 로 보낸다
 *    (워커가 get_content_detail 로 카드 payload 의 같은 값을 읽는다 — 먼저 카드에 저장해야 한다).
 */
export async function buildDraftRequest(input) {
  const i = input || {};
  const materials = normalizeMaterials(i.materials);
  const blocks = (Array.isArray(i.blocks) ? i.blocks : splitUserBlocks(materials.content.memo));
  const withHash = [];
  for (let n = 0; n < blocks.length; n++) {
    const b = blocks[n];
    withHash.push({
      id: b.id || 'U' + String(n + 1).padStart(2, '0'),
      origin: 'USER',
      text: String(b.text || ''),
      sha256: await sha256Hex(String(b.text || ''))
    });
  }
  const memo = String(materials.content.memo || '');
  const photos = autoOrderPhotos(i.photos || materials.photos).map((p) => ({ name: p.name, role: p.role }));
  const base = {
    type: 'content_draft',
    content_id: String(i.contentId || ''),
    brand: String(i.brand || 'daejeon_youth'),
    format: i.format === 'video' ? 'video' : 'blog',
    concept: { kind: materials.concept.kind, tone: materials.concept.tone, hint: materials.concept.hint.trim() },
    ask: Object.assign({ titles: 3, bridge: true, captions: true, outro: true }, i.ask || {}),
    memo_sha256: await sha256Hex(memo),
    media: photos
  };
  if (i.format === 'video') base.length_sec = materials.video.length_sec;
  const inline = Object.assign({}, base, { facts: factsOf(materials), blocks: withHash });
  if (payloadChars(inline) <= DRAFT_PAYLOAD_LIMIT) return inline;
  const light = Object.assign({}, base, { payload_source: 'drive', user_body_sha256: await sha256Hex(userBodyText(blocks)) });
  if (payloadChars(light) > DRAFT_PAYLOAD_LIMIT) {
    // 사진 25장 목록까지 넘치면 이름을 줄인다(워커가 카드에서 다시 읽는다).
    light.media = photos.slice(0, 10);
  }
  return light;
}

/**
 * AI 초안 결과와 내 원문을 합쳐 '붙일 수 있는 본문'을 만든다.
 *  · USER 블록은 손대지 않는다. AI 문장은 블록 **사이**와 빈 캡션에만 들어간다.
 *  · 결과의 USER 블록이 원문과 다르면(해시 불일치) AI 문장을 버리고 원문만 남긴다 — 덮어쓰지 않는다.
 */
export function composeBlogWithDraft(kit, draft) {
  const k = kit || {};
  const d = draft && typeof draft === 'object' ? draft : {};
  const blocks = Array.isArray(k.blocks) ? k.blocks : [];
  const aiBlocks = Array.isArray(d.blocks) ? d.blocks : [];
  const aiByUser = {};
  aiBlocks.forEach((b) => {
    const o = String((b && b.origin) || '').toUpperCase();
    if (o === 'AI_ADD' || o === 'AI') aiByUser[String(b.after || b.after_id || '')] = String(b.text || b.body || '');
  });
  const verified = verifyUserBlocks(blocks, aiBlocks);
  const bridges = Array.isArray(d.bridges) ? d.bridges : (Array.isArray(d.bridge) ? d.bridge : []);
  const lines = [];
  lines.push('■ 제목 후보 3');
  (Array.isArray(d.titles) && d.titles.length ? d.titles : k.titles || []).slice(0, 3).forEach((t, n) => lines.push((n + 1) + ') ' + t));
  lines.push('');
  lines.push('■ 본문');
  blocks.forEach((b, n) => {
    lines.push('');
    lines.push(b.text);
    const after = b.id || 'U' + String(n + 1).padStart(2, '0');
    const add = aiByUser[after] || bridges[n] || '';
    // AI 가 쓴 사이 문장만 2줄 호흡으로 나눈다(USER 블록은 손대지 않는다).
    if (verified.ok && add) lines.push(splitLongBlock(add).join('\n\n'));
    const marks = (k.photo_plan || []).filter((x) => x.after_block === after);
    marks.forEach((x) => lines.push('   [사진] ' + x.photo + ' — ' + ((k.captions || []).find((c) => c.name === x.photo) || {}).text));
  });
  lines.push('');
  lines.push('■ 마무리 한 문단');
  lines.push(d.outro ? splitLongBlock(d.outro).join('\n\n') : (k.outro || FILL));
  const caps = Array.isArray(d.captions) ? d.captions : [];
  if (caps.length) {
    lines.push('');
    lines.push('■ 사진 캡션 (빈 칸만 AI — 직접 쓴 캡션은 그대로)');
    (k.captions || []).forEach((c) => {
      const hit = caps.find((x) => x && x.name === c.name);
      lines.push(c.name + ' — ' + (c.auto === false ? c.text : ((hit && hit.text) || c.text)));
    });
  }
  return {
    text: lines.join('\n'),
    verified: verified,
    titles: (Array.isArray(d.titles) ? d.titles : k.titles || []).slice(0, 3),
    outro: d.outro || k.outro || '',
    captions: caps
  };
}

/** 결과의 USER 블록이 원문과 같은가 — 화면(허브)에서 마지막으로 다시 본다. */
export function verifyUserBlocks(originBlocks, aiBlocks) {
  const origin = (Array.isArray(originBlocks) ? originBlocks : []).map((b) => String(b.text || ''));
  const fromAi = (Array.isArray(aiBlocks) ? aiBlocks : []).filter((b) => String((b && b.origin) || '').toUpperCase() === 'USER').map((b) => String(b.text || ''));
  if (!fromAi.length) return { ok: true, changed: 0, note: 'AI 가 원문 블록을 돌려주지 않았습니다 — 원문만 남깁니다' };
  let changed = 0;
  origin.forEach((t, i) => { if (fromAi[i] !== t) changed++; });
  return { ok: changed === 0 && fromAi.length === origin.length, changed, note: changed ? '원문 ' + changed + '문단이 달라졌습니다 — AI 문장을 버렸습니다' : '' };
}

/* ────────────────────────── 카드 payload(studio) 읽기·쓰기 ────────────────────────── */

/**
 * payload.studio 를 읽는다. 구 구조(studio 루트에 steps·inputs…)는 studio.formats.video 로 **읽기만** 폴백한다.
 *  · migrated=true 면 아직 구 구조다 — 다음 저장 때 studio.formats.video 로 옮겨진다(루트 키는 지우지 않는다).
 *  · 루트 studio 키를 남겨 두는 이유: 문제가 생기면 읽기 우선순위 한 줄만 되돌리면 원복된다.
 */
export function readStudio(payload) {
  const studio = (payload && payload.studio && typeof payload.studio === 'object') ? payload.studio : {};
  const formats = (studio.formats && typeof studio.formats === 'object') ? studio.formats : null;
  const rootLooksLikeVideo = !!(studio.steps || studio.inputs || studio.plan || studio.render || studio.srt || studio.make);
  const video = formats && formats.video && typeof formats.video === 'object'
    ? formats.video
    : (rootLooksLikeVideo ? studio : {});
  return {
    studio: studio,
    formats: formats || {},
    video: video || {},
    migrated: !(formats && formats.video),
    legacy_root: rootLooksLikeVideo
  };
}

/** studio.formats.<format> 만 바꾼 새 studio 객체(다른 포맷·구 루트 키는 건드리지 않는다). */
export function mergeFormat(studio, format, value) {
  const base = (studio && typeof studio === 'object') ? studio : {};
  const formats = Object.assign({}, (base.formats && typeof base.formats === 'object') ? base.formats : {});
  formats[format] = Object.assign({}, formats[format] || {}, value || {}, {
    saved_at: (value && value.saved_at) || new Date().toISOString()
  });
  const meta = Object.assign({}, base.meta || {}, { format: format, updated_at: new Date().toISOString() });
  return Object.assign({}, base, { meta: meta, formats: formats });
}

/** 재료(사진·장소·내용·컨셉)를 카드 payload 에 남기는 모양. */
export function studioMaterials(materials) {
  const m = normalizeMaterials(materials);
  return {
    place: { name: m.place.name.trim(), naver_url: m.place.naver_url.trim(), kakao_url: m.place.kakao_url.trim() },
    content: Object.assign({}, m.content),
    concept: Object.assign({}, m.concept),
    media: autoOrderPhotos(m.photos).map((p) => ({
      name: p.name, kind: 'photo', role: p.role, order: p.order, caption: p.caption
    }))
  };
}

/** 재료를 studio 문서에 넣는다 — media 는 studio.media(설계 §8), 나머지는 place·concept·content. */
export function mergeMaterialsIntoStudio(studio, materials) {
  const base = (studio && typeof studio === 'object') ? studio : {};
  const m = studioMaterials(materials);
  return Object.assign({}, base, {
    place: m.place,
    concept: m.concept,
    content: m.content,
    media: m.media
  });
}

/** 카드 payload 의 재료를 다시 읽는다(사진 목록은 드라이브 목록과 합쳐 쓴다). */
export function materialsFromStudio(studio) {
  const s = (studio && typeof studio === 'object') ? studio : {};
  const out = emptyMaterials();
  if (s.place && typeof s.place === 'object') out.place = Object.assign(out.place, s.place);
  if (s.concept && typeof s.concept === 'object') out.concept = Object.assign(out.concept, s.concept);
  if (s.content && typeof s.content === 'object') out.content = Object.assign(out.content, s.content);
  if (Array.isArray(s.media)) out.photos = s.media.filter((x) => x && (x.kind === 'photo' || x.kind === 'PHOTO' || !x.kind)).map(normalizePhoto);
  const v = (s.formats && s.formats.video) || null;
  if (v && v.length_sec) out.video.length_sec = Number(v.length_sec) || 30;
  return normalizeMaterials(out);
}

/* ────────────────────────── 화면 문구 ────────────────────────── */

/** 실패 문구 3종(설계 §6). 코드가 모르는 값이면 일반 안내. */
export function errorText(code) {
  const c = String(code || '').toUpperCase();
  if (c === 'ERR_TIMEOUT' || c === 'TIMEOUT' || c === 'ERR_QUEUE_TIMEOUT') return '⏳ 시간 초과 — 입력값은 안전하니 [다시 시도]를 눌러주세요';
  if (c === 'ERR_VERSION_CONFLICT') return '🔄 동시 수정이 감지돼 최신본과 병합 후 재저장합니다';
  return '⚠️ 연결 또는 형식 오류 — [관리 탭] 상태를 확인해 주세요';
}

/** 오더 상태 → 화면 한 줄. 종료 상태면 false(폴링 그만). */
export function orderLine(status, extra) {
  const s = String(status || '').toUpperCase();
  const tail = extra ? ' · ' + extra : '';
  if (s === 'DONE') return { text: '완료 — 결과를 카드에 담았습니다' + tail, done: true, kind: 'ok' };
  if (s === 'FAILED') return { text: '실패 — [다시 시도]를 눌러 주세요' + tail, done: true, kind: 'err' };
  if (s === 'REJECTED') return { text: '거절됨 — 입력을 확인해 주세요' + tail, done: true, kind: 'warn' };
  if (s === 'EXPIRED') return { text: '승인 시간이 지났습니다 — 다시 보내 주세요' + tail, done: true, kind: 'warn' };
  if (s === 'TIMEOUT_REVIEW') return { text: '응답이 없어 확인 대기로 넘겼습니다' + tail, done: true, kind: 'warn' };
  if (s === 'REVIEW_NEEDED') return { text: '사람 확인이 필요합니다' + tail, done: true, kind: 'warn' };
  if (s === 'WAITING_APPROVAL') return { text: '승인을 기다리는 중입니다' + tail, done: false, kind: 'info' };
  if (s === 'RUNNING') return { text: '노트북이 만드는 중입니다' + tail, done: false, kind: 'info' };
  if (s === 'PENDING') return { text: '오더가 접수됐습니다 — 노트북 차례를 기다립니다' + tail, done: false, kind: 'info' };
  return { text: '상태를 가져오는 중입니다' + tail, done: false, kind: 'info' };
}
