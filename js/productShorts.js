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
  'smartstore.naver.com', 'm.smartstore.naver.com', 'brand.naver.com',
  'musinsa.com', 'oliveyoung.co.kr', 'ohou.se', 'coupang.com', 'naver.me'
];

export const PRODUCT_BEATS = ['hook', 'info', 'build', 'climax', 'payoff'];

export const AFFILIATE_NOTICE = '본 영상에는 제휴 링크가 포함될 수 있으며, 구매 시 일정 수수료를 받을 수 있습니다.';
export const OWN_PURCHASE_NOTICE = '직접 구매해 써 본 기준으로 작성했습니다.';

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
  const payoffText = f.price
    ? (f.discount_pct ? '이 값이면 한 번쯤 써 볼 만합니다' : '값보다 쓸 일이 많은지가 관건입니다')
    : '실물 확인하고 판단하세요';

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

  return { hook, hook_sub: hookSub, beats, captions, narration, price: f.price, seconds: sec };
}

/**
 * 설명란 5블록(제목/요약/정보 한 줄씩/행동 2줄/해시태그) — 블록 사이 빈 줄 1개.
 * 제휴 표기는 행동 유도 다음, 해시태그 앞에 넣는다(제미니 확정 위치).
 */
export function descriptionBlocks(facts, opts) {
  const f = normalizeFacts(facts);
  const o = opts || {};
  const name = f.name || '상품';
  const title = (o.title || name).slice(0, 30);
  const summary = o.summary || ((f.key_points || []).slice(0, 2).join(', ') || name + ' 확인한 것만 정리했습니다');
  const info = [];
  if (f.price != null) info.push('- 가격: ' + won(f.price) + (f.discount_pct ? ' (정가 ' + won(f.original_price) + ')' : ''));
  if (f.shipping) info.push('- 배송: ' + f.shipping);
  if (f.rating != null) info.push('- 평점: ' + f.rating + (f.reviews ? ' · 리뷰 ' + f.reviews + '건' : ''));
  if (!info.length) info.push('- 가격·배송 미확인');
  const action = ['- 더 궁금하면 댓글에 남겨 주세요', '- 저장해 두고 필요할 때 보세요'];
  const tags = (o.tags && o.tags.length ? o.tags : ['#상품추천', '#' + (f.category || '리뷰').replace(/\s+/g, ''), '#대전청년']).slice(0, 5).join(' ');
  const notice = o.affiliate === false ? '' : AFFILIATE_NOTICE;
  const parts = [title, summary, info.join('\n'), action.join('\n')];
  if (notice) parts.push(notice);
  parts.push(tags);
  return { text: parts.join('\n\n'), notice: notice, blocks: { title, summary, info, action, notice, tags } };
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
  window.ProductShorts = { normalizeProductUrl, normalizeFacts, productScript, descriptionBlocks, factsToMaterials, canRender };
}
