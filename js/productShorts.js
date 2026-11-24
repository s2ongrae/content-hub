/**
 * js/productShorts.js — 상품 링크 → 숏폼 (2026-11-24)
 *
 * 근거: docs/PRODUCT_SHORTS_v1.md · 제미니 고정방 확정안(3단 추출 · 5비트 대본 · content_draft format 'product').
 * 이 파일은 **계산만** 한다(네트워크·저장 없음). 화면(createStudio)과 제출 오더가 같이 쓴다.
 *
 * 원칙
 *  · 페이지에서 확인된 값만 쓴다. 없으면 null → 자막·내레이션에서 빼고 '미확인'으로 남긴다.
 *  · 5비트 순서는 hub-agent/lib/story.js 와 같다(hook → info → build → climax → payoff).
 *  · 대가성(제휴) 링크 글에는 표시 문구를 자동으로 붙인다 — 내돈내산 문구와 동시에 쓰지 않는다.
 */

export const PRODUCT_HOSTS = [
  'smartstore.naver.com', 'm.smartstore.naver.com', 'brand.naver.com', 'm.brand.naver.com',
  'musinsa.com', 'oliveyoung.co.kr', 'ohou.se', 'coupang.com', 'naver.me'
];

export const PRODUCT_BEATS = ['hook', 'info', 'build', 'climax', 'payoff'];

/* 대가성 문구는 채널·용도별로 나눈다 (v3, 2026-11-24 · docs/NAVER_CLIP_SHOPPING_CONNECT_v3.md §2)
 *  · SC_NOTICE_CLIP — 네이버 클립 공식 지정 문장. **한 글자도 바꾸지 않는다.**
 *    쇼핑커넥트 태그를 붙인 클립은 이 문장을 첫 번째 고정댓글에 그대로 넣어야 한다(다른 문구·중간 배치·해시태그 사이는 위반).
 *  · AFFILIATE_NOTICE — 블로그·자체 표기용 일반 문장. 클립 수익화 트랙에는 쓰지 않는다. */
export const SC_NOTICE_CLIP = '이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.';
export const AFFILIATE_NOTICE = '본 영상에는 제휴 링크가 포함될 수 있으며, 구매 시 일정 수수료를 받을 수 있습니다.';
export const OWN_PURCHASE_NOTICE = '직접 구매해 써 본 기준으로 작성했습니다.';

/* ────────────────────────── 트랙 A/B (v3 P1) ──────────────────────────
 *  한 클립에 두 트랙을 섞지 않는다(공식: 쇼핑커넥트 태그가 붙으면 #오늘클립챌린지 미션 인정 불가).
 *  카드에는 studio.product.track 으로 저장하고, 대본·설명란·문구 세트가 이 값에 따라 달라진다. */
export const CLIP_CHALLENGE_TAG = '#오늘클립챌린지';
export const PRODUCT_TRACKS = ['challenge', 'commerce'];
export function normalizeTrack(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return PRODUCT_TRACKS.indexOf(s) >= 0 ? s : 'commerce';
}

/** 트랙 규칙 — 화면 안내·검사·설명란이 같은 표를 본다. */
export function trackRules(track) {
  const id = normalizeTrack(track);
  if (id === 'challenge') {
    return {
      id: id,
      label: 'A트랙 · 챌린지(' + CLIP_CHALLENGE_TAG + ')',
      short: '챌린지',
      pinned_comment: '',
      hashtag_first: CLIP_CHALLENGE_TAG,
      required: [CLIP_CHALLENGE_TAG + ' 해시태그', '내용에 맞는 정보 태그 1개 이상', '전체공개'],
      forbidden: ['쇼핑커넥트 상품 태그'],
      note: '챌린지 트랙은 정보형입니다 — 쇼핑커넥트 태그를 붙이면 미션 인정이 안 됩니다(공식). 체험·협찬이면 본문 맨 앞에 대가 표기를 직접 넣으세요.'
    };
  }
  return {
    id: 'commerce',
    label: 'B트랙 · 쇼핑커넥트 수익화',
    short: '수익화',
    pinned_comment: SC_NOTICE_CLIP,
    hashtag_first: '',
    required: ['쇼핑커넥트 상품 태그 1개(동영상)', '첫 고정댓글에 공식 문구 그대로', '본문 첫 부분 [광고](태그를 붙이면 자동 표시)'],
    forbidden: [CLIP_CHALLENGE_TAG, '내돈내산'],
    note: '수익화 트랙은 쇼핑커넥트 태그가 필수이고 ' + CLIP_CHALLENGE_TAG + ' 는 넣지 않습니다(미션 인정 불가). 대가성 문구는 고정댓글에만 — 본문 중간·해시태그 사이에 넣으면 가이드 위반입니다.'
  };
}

/** 트랙에 맞는 고정댓글 문구(수익화=공식 문장, 챌린지=없음). */
export function pinnedComment(track) {
  return trackRules(track).pinned_comment;
}

/**
 * 설명란·해시태그에 트랙 금지 조합이 섞였는지 검사한다(지어내지 않고 문장으로 알린다).
 * @param {{track?:string, text?:string, pinned?:string}} input
 * @returns {string[]} 비어 있으면 통과
 */
export function trackWarnings(input) {
  const i = input || {};
  const rules = trackRules(i.track);
  const text = String(i.text || '');
  const pinned = i.pinned === undefined ? '' : String(i.pinned || '');
  const out = [];
  if (rules.id === 'commerce') {
    if (text.indexOf(CLIP_CHALLENGE_TAG) >= 0) out.push('수익화 트랙에 ' + CLIP_CHALLENGE_TAG + ' 가 있습니다 — 챌린지 미션 인정이 안 되고 어뷰징으로 보일 수 있어요. 빼 주세요.');
    if (/내돈내산/.test(text) || /내돈내산/.test(pinned)) out.push('대가를 받은 클립에 내돈내산을 쓰면 표시광고법 위반입니다 — 빼 주세요.');
    if (pinned.indexOf(SC_NOTICE_CLIP) < 0) out.push('첫 고정댓글에 공식 문구를 그대로 넣어 주세요.');
  } else {
    if (/쇼핑커넥트/.test(text) || /쇼핑커넥트/.test(pinned)) out.push('챌린지 트랙에 쇼핑커넥트 태그를 붙이면 미션 인정이 안 됩니다 — 빼 주세요.');
    if (text.indexOf(CLIP_CHALLENGE_TAG) < 0) out.push(CLIP_CHALLENGE_TAG + ' 해시태그가 있어야 챌린지 미션으로 집계됩니다.');
  }
  return out;
}

/* ────────────────────────── 12시간 중복 억제 (v3 P1) ──────────────────────────
 *  같은 (brand + url)을 12시간 안에 다시 요청하면 새로 받지 않고 기존 카드로 안내한다.
 *  · 허브 GAS 가 오더를 만들 때(스크립트 속성 색인)와 화면이(브라우저 기록) 같은 규칙을 본다.
 *  · 강제 재수집은 force:true 일 때만 — 사진이 바뀌었거나 앞 수집이 모자랐을 때 쓴다. */
export const DEDUP_WINDOW_MS = 12 * 60 * 60 * 1000;

/** 같은 상품인지 비교하는 주소 — 쿼리·해시·끝 슬래시를 버린다(추적 파라미터로 중복이 생기지 않게). */
export function canonicalProductUrl(url) {
  const s = String(url == null ? '' : url).trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (e) { return s.replace(/[?#].*$/, '').replace(/\/+$/, ''); }
  return ('https://' + u.hostname.toLowerCase() + u.pathname).replace(/\/+$/, '');
}

/** FNV-1a 32bit — 브라우저·노드·GAS 가 같은 값을 낸다(짧은 색인 키). */
export function fnv1aHex(text) {
  const s = String(text == null ? '' : text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

/** 카드에 남기는 상품 주소 해시(studio.product.url_hash) — GAS 색인과 같은 값. */
export function urlHash(url) {
  return fnv1aHex('product|' + canonicalProductUrl(url));
}

export function dedupKey(brand, url) {
  return String(brand || '').trim() + '|' + urlHash(url);
}

/**
 * 기록 하나가 지금 중복인지 판정한다.
 * @param {{content_id?:string, at?:string|number}|null} record
 * @param {number} [nowMs]
 * @returns {{blocked:boolean, content_id?:string, minutes_left?:number, age_ms?:number, remaining_ms?:number, message?:string}}
 */
export function dedupState(record, nowMs) {
  const r = record && typeof record === 'object' ? record : null;
  if (!r) return { blocked: false };
  const rawAt = typeof r.at === 'number' ? r.at : Date.parse(String(r.at || ''));
  if (!Number.isFinite(rawAt)) return { blocked: false };
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const age = now - rawAt;
  if (age < 0 || age >= DEDUP_WINDOW_MS) return { blocked: false, expired: true };
  const left = DEDUP_WINDOW_MS - age;
  const mins = Math.max(1, Math.ceil(left / 60000));
  return {
    blocked: true, content_id: String(r.content_id || ''), age_ms: age, remaining_ms: left, minutes_left: mins,
    message: '같은 상품을 ' + Math.round(age / 60000) + '분 전에 수집했습니다 — ' + mins + '분 뒤에 다시 받거나, 지금 강제 재수집하세요.'
  };
}

/* v2(2026-11-24) — 링크만 넣으면 노트북이 이미지까지 받아 오는 경로.
 *   오더 한 건이 큐 payload 4,000자 안에 들어가야 해서, 넘치면 이미지 → 사실 순으로 빼고 링크만 보낸다
 *   (노트북이 주거 IP·실사용 Chrome 으로 다시 읽는다 — 조용히 다른 상품을 만들지 않는다). */
export const PRODUCT_IMAGE_MAX = 6;
export const PRODUCT_RENDER_MIN_IMAGES = 5;     // hub-agent lib/kenburns.js MIN_IMAGES 와 같은 값
export const PRODUCT_PAYLOAD_LIMIT = 3500;      // gas/Orders.gs RENDER_MAX_PAYLOAD_CHARS

/** 카드에 저장된 상품 정보(studio.product)에서 이미 받아 둔 사진 이름을 꺼낸다. */
export function imageFilesOf(product) {
  const p = product && typeof product === 'object' ? product : {};
  return (Array.isArray(p.image_files) ? p.image_files : []).map(String).filter(Boolean).slice(0, 25);
}

/** 사진이 렌더 최소(5장)를 넘었나 — 화면이 [렌더] 버튼을 열지 말지 정한다. */
export function canRenderWith(names) {
  const list = (Array.isArray(names) ? names : []).filter(Boolean);
  return {
    ok: list.length >= PRODUCT_RENDER_MIN_IMAGES,
    count: list.length,
    missing: Math.max(0, PRODUCT_RENDER_MIN_IMAGES - list.length),
    message: list.length >= PRODUCT_RENDER_MIN_IMAGES ? '' : '사진 ' + list.length + '장 — 렌더는 ' + PRODUCT_RENDER_MIN_IMAGES + '장부터입니다(' + Math.max(0, PRODUCT_RENDER_MIN_IMAGES - list.length) + '장 더 필요)'
  };
}

/**
 * [이미지까지 자동 수집]·[바로 숏츠 만들기] 가 보낼 product_extract 오더.
 *  · 오더에 실린 사실·이미지는 노트북이 브라우저를 열지 않고 쓰는 힌트다(GAS 1차 성공분).
 *  · 막힌 몰은 사실·이미지가 비어도 된다 — 노트북이 링크로 다시 읽는다.
 */
export function productExtractRequest(facts, opts) {
  const f = normalizeFacts(facts);
  const o = opts || {};
  const body = {
    type: 'product_extract',
    content_id: String(o.content_id || ''),
    brand: String(o.brand || 'daejeon_youth'),
    url: String(o.url || ''),
    max_images: PRODUCT_IMAGE_MAX,
    seconds: Number(o.seconds) || 20,
    auto_render: o.auto_render === true,
    track: normalizeTrack(o.track),
    force: o.force === true          // 12시간 중복 억제를 건너뛰는 유일한 길
  };
  const factHint = {};
  ['name', 'brand', 'category', 'price', 'original_price', 'rating', 'reviews', 'shipping'].forEach((k) => {
    if (f[k] !== null && f[k] !== undefined && f[k] !== '') factHint[k] = f[k];
  });
  if (f.key_points && f.key_points.length) factHint.key_points = f.key_points.slice(0, 5);
  if (Object.keys(factHint).length) body.facts = factHint;
  if (f.images && f.images.length) body.images = f.images.slice(0, PRODUCT_IMAGE_MAX);
  let text = JSON.stringify(body);
  if (text.length > PRODUCT_PAYLOAD_LIMIT && body.images) { delete body.images; text = JSON.stringify(body); }
  if (text.length > PRODUCT_PAYLOAD_LIMIT && body.facts) { delete body.facts; }
  return body;
}

/** URL 하나를 검사해 허용 도메인이면 정규화 URL, 아니면 { error } 를 돌려준다. */
export function normalizeProductUrl(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { error: '링크를 붙여넣어 주세요' };
  let u;
  try { u = new URL(s); } catch (e) { return { error: '주소 형식이 아니에요 — https:// 로 시작하는 링크를 붙여넣어 주세요' }; }
  if (u.protocol !== 'https:') return { error: 'https 링크만 됩니다' };
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (PRODUCT_HOSTS.indexOf(host) < 0) {
    return { error: '지원하지 않는 쇼핑몰이에요(' + PRODUCT_HOSTS.slice(0, 4).join(' · ') + ' 등)' };
  }
  return { url: 'https://' + host + u.pathname + (u.searchParams.get('id') ? '?id=' + u.searchParams.get('id') : ''), host: host };
}

/** 빈 사실표 — 값이 없으면 null(지어내지 않는다). */
export function emptyFacts() {
  return {
    name: '', brand: '', category: '', price: null, original_price: null, discount_pct: null,
    rating: null, reviews: null, shipping: '', seller: '', key_points: [], images: []
  };
}

const num = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && s.replace(/[^0-9.]/g, '') !== '' ? n : null;
};

/** 추출 결과(어느 경로든)를 화면·오더가 쓰는 고정 모양으로 맞춘다. */
export function normalizeFacts(raw) {
  const f = emptyFacts();
  const i = raw && typeof raw === 'object' ? raw : {};
  f.name = String(i.name || '').trim().slice(0, 120);
  f.brand = String(i.brand || '').trim().slice(0, 60);
  f.category = String(i.category || '').trim().slice(0, 80);
  f.price = num(i.price);
  f.original_price = num(i.original_price);
  f.rating = num(i.rating);
  f.reviews = num(i.reviews);
  f.shipping = String(i.shipping || '').trim().slice(0, 40);
  f.seller = String(i.seller || '').trim().slice(0, 60);
  f.key_points = (Array.isArray(i.key_points) ? i.key_points : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 5);
  f.images = (Array.isArray(i.images) ? i.images : []).map((x) => String(x || '')).filter(Boolean).slice(0, 6);
  /* 할인율은 정가·판매가가 둘 다 있을 때만 계산한다(추정 금지). */
  if (f.price && f.original_price && f.original_price > f.price) {
    f.discount_pct = Math.round((1 - f.price / f.original_price) * 100);
  }
  return f;
}

/** 사실표에서 렌더에 필요한 것이 빠졌는지 — 0장이면 렌더 금지(제미니 확정안). */
export function missingFacts(facts) {
  const f = facts || emptyFacts();
  const missing = [];
  if (!f.name) missing.push('상품명');
  if (!f.images || !f.images.length) missing.push('대표 이미지');
  return missing;
}

export function canRender(facts) {
  const m = missingFacts(facts);
  return { ok: m.length === 0, missing: m, message: m.length ? '대표 이미지를 1장 이상 확보해야 영상 렌더가 가능해요' : '' };
}

const won = (n) => (n == null ? '' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원');

/** 상품명에서 훅용 짧은 말 — 20자 넘으면 앞부분만(지어내지 않는다). */
function shortName(facts) {
  const raw = String(facts.name || '').replace(/\s*[:\|].*$/, '').trim();
  if (!raw) return '';
  const cut = raw.split(/\s+/).slice(0, 4).join(' ');
  return cut.length > 22 ? cut.slice(0, 22) : cut;
}

/**
 * 5비트 대본 — AI 없이(토큰 0) 만드는 기본형.
 * 확인된 값만 쓰고, 없는 값은 그 비트를 다른 사실로 대체한다(빈칸·거짓 금지).
 * @returns {{hook:string, hook_sub:string, beats:object[], captions:Array, narration:Array}}
 */
export function productScript(facts, opts) {
  const f = normalizeFacts(facts);
  const o = opts || {};
  const sec = Math.max(12, Math.min(45, Number(o.seconds) || 20));
  const name = shortName(f);
  const price = won(f.price);
  const was = won(f.original_price);
  const point = (f.key_points && f.key_points[0]) || '';
  const usp = (f.key_points || []).slice(0, 2).join(' · ');

  const hook = o.hook || (f.category ? f.category + ' 이거 실화?' : (name ? name + ', 이 정도야?' : '이거 하나로 되나?'));
  const hookSub = (o.hook_sub || '').slice(0, 6) || (f.discount_pct ? f.discount_pct + '%' : '확인');

  const infoText = price
    ? (was && f.discount_pct ? was + ' → ' + price + ' (' + f.discount_pct + '%)' : price)
    : (f.rating != null ? '평점 ' + f.rating + (f.reviews ? ' · 리뷰 ' + f.reviews : '') : '가격 미확인');
  const buildText = usp || (f.brand ? f.brand + ' 제품' : (name || '직접 써 본 것만'));
  const climaxText = point && point !== buildText ? point : (f.key_points[1] || buildText);
  /* 수익화 트랙의 마지막 자막은 인사가 아니라 **행동 한 줄**이다(§5-1). 트랙을 안 주면 예전 문장 그대로. */
  const hasTrack = o.track !== undefined && o.track !== null && String(o.track).trim() !== '';
  const trackId = hasTrack ? normalizeTrack(o.track) : '';
  const payoffText = trackId === 'commerce'
    ? '상품 태그 확인'
    : (f.price
      ? (f.discount_pct ? '이 값이면 한 번쯤 써 볼 만합니다' : '값보다 쓸 일이 많은지가 관건입니다')
      : '실물 확인하고 판단하세요');

  const win = (() => {
    let at = 0;
    return [0.15, 0.25, 0.25, 0.25, 0.10].map((sh, i) => {
      const len = i === 4 ? Math.max(1, sec - at) : Math.max(1, Math.round(sec * sh * 100) / 100);
      const w = { from: Math.round(at * 100) / 100, to: Math.round((at + len) * 100) / 100 };
      at = w.to;
      return w;
    });
  })();

  const texts = [hook, infoText, buildText, climaxText, payoffText];
  const beats = PRODUCT_BEATS.map((id, i) => ({
    beat: id, text: texts[i], from: win[i].from, to: win[i].to
  }));

  /* 자막: 비트 문장을 13자 안팎으로 끊는다(의미 단위). 내레이션은 자막을 그대로 읽지 않고 한 겹 더한다. */
  const captions = [];
  const narration = [];
  beats.forEach((b, i) => {
    captions.push({ start: b.from, end: b.to, text: b.text, beat: b.beat });
    const nar = i === 0 ? b.text + ' — 직접 확인했습니다'
      : i === 4 ? b.text
        : b.text;
    narration.push({ start: b.from, end: b.to, text: nar, tone: i === 0 ? 'hype' : 'calm' });
  });

  return { hook, hook_sub: hookSub, beats, captions, narration, price: f.price, seconds: sec, track: trackId };
}

/** 해시태그 한 개 — 공백·기호를 지운다(#오늘클립챌린지 처럼 '#'가 붙은 값은 그대로). */
function cleanTag(t) {
  const s = String(t || '').trim();
  if (!s) return '';
  const hadHash = s.charAt(0) === '#';
  const body = s.replace(/^#/, '').replace(/[^0-9A-Za-z가-힣_]/g, '');
  return body ? '#' + body : (hadHash ? '' : '');
}

/** 트랙별 해시태그 5개(§6-5) — 수익화는 상품명이 1번, 챌린지는 #오늘클립챌린지가 1번. */
export function clipTags(facts, opts) {
  const f = normalizeFacts(facts);
  const o = opts || {};
  if (o.tags && o.tags.length) return o.tags.slice(0, 5).join(' ');
  const hasTrack = o.track !== undefined && o.track !== null && String(o.track).trim() !== '';
  if (!hasTrack) return ['#상품추천', '#' + (f.category || '리뷰').replace(/\s+/g, ''), '#대전청년'].slice(0, 5).join(' ');
  const trackId = normalizeTrack(o.track);
  const list = [];
  const add = (t) => { const s = cleanTag(t); if (s && list.indexOf(s) < 0 && list.length < 5) list.push(s); };
  if (trackId === 'challenge') add(CLIP_CHALLENGE_TAG);
  else add(shortName(f));
  add(f.category ? '#' + String(f.category).split(/[>·\/,]/).pop() : '');
  if (trackId === 'commerce') { add('#대전청년'); add('#상품추천'); add('#겨울살림'); }
  else { add('#대전'); add('#대전청년'); add('#일상'); }
  return list.join(' ');
}

/**
 * 설명란 5블록(제목/요약/정보 한 줄씩/행동 2줄/해시태그) — 블록 사이 빈 줄 1개.
 *  · 트랙을 주면 그 트랙 문구 세트를 쓴다(v3).
 *      commerce — 행동은 '상품 태그 확인' CTA, 대가성 문장은 **본문에 넣지 않고** 첫 고정댓글로 분리(pinned_comment).
 *      challenge — #오늘클립챌린지가 해시태그 1번. 협찬이면 affiliate:true 로 일반 문장을 본문에 넣는다.
 *  · 트랙을 주지 않으면 예전 그대로(제휴 표기 = 행동 다음·해시태그 앞) — 블로그·자체 표기용.
 */
export function descriptionBlocks(facts, opts) {
  const f = normalizeFacts(facts);
  const o = opts || {};
  const hasTrack = o.track !== undefined && o.track !== null && String(o.track).trim() !== '';
  const trackId = hasTrack ? normalizeTrack(o.track) : '';
  const name = f.name || '상품';
  const title = (o.title || name).slice(0, 30);
  const summary = o.summary || ((f.key_points || []).slice(0, 2).join(', ') || name + ' 확인한 것만 정리했습니다');
  const info = [];
  if (f.price != null) info.push('- 가격: ' + won(f.price) + (f.discount_pct ? ' (정가 ' + won(f.original_price) + ')' : ''));
  if (f.shipping) info.push('- 배송: ' + f.shipping);
  if (f.rating != null) info.push('- 평점: ' + f.rating + (f.reviews ? ' · 리뷰 ' + f.reviews + '건' : ''));
  if (!info.length) info.push('- 가격·배송 미확인');
  const action = trackId === 'commerce'
    ? ['- 더 궁금한 건 댓글에 남겨 주세요', '- 상품 태그 확인하고 조건 비교해 보세요']
    : ['- 더 궁금하면 댓글에 남겨 주세요', '- 저장해 두고 필요할 때 보세요'];
  const tags = clipTags(f, { track: trackId || undefined, tags: o.tags });
  /* 본문 대가성 문구 — 수익화 트랙은 고정댓글 전용이라 본문에 넣지 않는다(공식 위치 위반 방지). */
  let notice = '';
  if (trackId === 'commerce') notice = '';
  else if (trackId === 'challenge') notice = o.affiliate === true ? AFFILIATE_NOTICE : '';
  else notice = o.affiliate === false ? '' : AFFILIATE_NOTICE;
  const parts = [title, summary, info.join('\n'), action.join('\n')];
  if (notice) parts.push(notice);
  parts.push(tags);
  const rules = trackId ? trackRules(trackId) : null;
  const pinned = rules ? rules.pinned_comment : '';
  const text = parts.join('\n\n');
  const warnings = trackId
    ? trackWarnings({ track: trackId, text: text, pinned: pinned })
    : [];
  return {
    text: text, notice: notice, pinned_comment: pinned, ad_label: trackId === 'commerce' ? '[광고]' : '',
    track: trackId, warnings: warnings, rules: rules,
    blocks: { title, summary, info, action, notice, tags, pinned_comment: pinned }
  };
}

/** 사실표 → 스튜디오 재료(기존 영상 파이프라인이 그대로 먹는 모양). 사용자가 화면에서 고칠 수 있다. */
export function factsToMaterials(facts, materials) {
  const f = normalizeFacts(facts);
  const base = materials && typeof materials === 'object' ? materials : {};
  const content = Object.assign({}, base.content || {});
  content.category = f.category || content.category || '';
  content.price_menu = f.price != null ? won(f.price) : (content.price_menu || '');
  const memoBits = [];
  if (f.key_points.length) memoBits.push(f.key_points.join(' / '));
  if (f.brand) memoBits.push('브랜드 ' + f.brand);
  if (f.shipping) memoBits.push('배송 ' + f.shipping);
  if (f.rating != null) memoBits.push('평점 ' + f.rating + (f.reviews ? ' / 리뷰 ' + f.reviews : ''));
  content.memo = memoBits.join('\n') || content.memo || '';
  return Object.assign({}, base, {
    place: Object.assign({}, base.place || {}, { name: f.name || (base.place && base.place.name) || '' }),
    content,
    concept: Object.assign({ kind: 'review', tone: 'plain', hint: '상품 링크 숏폼 — 확인된 사실만' }, base.concept || {})
  });
}

if (typeof window !== 'undefined') {
  window.ProductShorts = {
    normalizeProductUrl, normalizeFacts, productScript, descriptionBlocks, factsToMaterials, canRender, productExtractRequest, imageFilesOf, canRenderWith,
    SC_NOTICE_CLIP, AFFILIATE_NOTICE, CLIP_CHALLENGE_TAG, PRODUCT_TRACKS, normalizeTrack, trackRules, pinnedComment, trackWarnings, clipTags,
    DEDUP_WINDOW_MS, canonicalProductUrl, fnv1aHex, urlHash, dedupKey, dedupState
  };
}
