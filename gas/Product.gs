/**
 * gas/Product.gs — 상품 링크 1차 추출(2026-11-24)
 *
 * 왜 필요한가
 *   숏폼 스튜디오에 상품 URL만 넣으면 상품명·가격·이미지·소구점이 자동으로 채워져야 한다.
 *   그 1차 경로가 여기다. 서버가 직접 받아 JSON-LD·og 태그를 편다.
 *
 * 한계(설계에 이미 반영)
 *   쇼핑몰은 데이터센터 IP를 막는다(스마트스토어 429, 무신사·올리브영·쿠팡 403 — 2026-11-24 실측).
 *   그래서 이 함수는 **성공하면 자동**, 막히면 ERR_PRODUCT_BLOCKED 로 분명히 실패하고
 *   화면은 3칸 수동 입력으로 넘어간다. 조용히 빈 값을 돌려주지 않는다.
 *
 * 규칙
 *   · 읽기만 한다. 로그인·주문·리뷰 작성 없음. UrlFetchApp 하나만 쓴다.
 *   · 페이지에 없는 숫자는 만들지 않는다(없으면 null).
 *   · 반환은 화면(js/productShorts.js normalizeFacts)이 그대로 먹는 모양.
 */

const PRODUCT_ALLOWED_HOSTS_ = [
  'smartstore.naver.com', 'm.smartstore.naver.com', 'brand.naver.com', 'm.brand.naver.com',
  'musinsa.com', 'oliveyoung.co.kr', 'ohou.se', 'coupang.com', 'naver.me'
];
const PRODUCT_MAX_BYTES_ = 900 * 1024;     // 900KB까지만 읽는다(파싱용, 이미지 아님)
const PRODUCT_TIMEOUT_MS_ = 8000;

/** URL 검사 → { url, host } 또는 throw. */
function productNormalizeUrl_(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) throw createAppError_('ERR_VALIDATION_FAILED', '상품 링크를 넣어 주세요.');
  if (!/^https:\/\//i.test(s)) throw createAppError_('ERR_VALIDATION_FAILED', 'https 링크만 됩니다.');
  const host = (s.match(/^https:\/\/([^\/]+)/i) || [])[1].toLowerCase().replace(/^www\./, '');
  if (PRODUCT_ALLOWED_HOSTS_.indexOf(host) === -1) {
    throw createAppError_('ERR_VALIDATION_FAILED', '지원하지 않는 쇼핑몰입니다.', { host: host });
  }
  return { url: s, host: host };
}

/** 첫 번째 매치의 1번 그룹. */
function productGrab_(re, text) {
  const m = String(text || '').match(re);
  return m ? String(m[1] || '').trim() : '';
}

/** HTML 엔티티 최소 해제(&quot; &amp; &#39; &lt; &gt;). */
function productUnescape_(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * HTML → 사실표. 순수 함수(시험이 이걸 부른다).
 * 우선순위: JSON-LD Product → og → DOM(가격·평점·리뷰).
 */
function productParseHtml_(html, baseUrl) {
  const text = String(html || '');
  const facts = { name: '', brand: '', category: '', price: null, original_price: null,
    rating: null, reviews: null, shipping: '', seller: '', key_points: [], images: [] };

  /* 1) JSON-LD */
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(text))) {
    let obj = null;
    try { obj = JSON.parse(m[1]); } catch (e) { continue; }
    const list = Array.isArray(obj) ? obj : (obj && obj['@graph'] ? obj['@graph'] : [obj]);
    for (let i = 0; i < list.length; i++) {
      const o = list[i] || {};
      const type = String(o['@type'] || '');
      if (type.indexOf('Product') < 0) continue;
      if (!facts.name) facts.name = String(o.name || '').trim();
      if (!facts.category) facts.category = String(o.category || '').trim();
      if (!facts.brand && o.brand) facts.brand = String(o.brand.name || o.brand || '').trim();
      const offer = Array.isArray(o.offers) ? (o.offers[0] || {}) : (o.offers || {});
      if (facts.price === null && offer.price !== undefined) facts.price = productNumber_(offer.price);
      const img = o.image;
      if (img) {
        const arr = Array.isArray(img) ? img : [img];
        arr.forEach(function (x) {
          const u = typeof x === 'string' ? x : (x && (x.url || x.contentUrl)) || '';
          if (u && facts.images.indexOf(u) < 0 && facts.images.length < 6) facts.images.push(u);
        });
      }
      if (o.aggregateRating) {
        facts.rating = productNumber_(o.aggregateRating.ratingValue);
        facts.reviews = productNumber_(o.aggregateRating.reviewCount || o.aggregateRating.ratingCount);
      }
    }
  }

  /* 2) og / meta */
  const ogTitle = productGrab_(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i, text);
  const ogDesc = productGrab_(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i, text);
  const ogImage = productGrab_(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i, text);
  if (!facts.name && ogTitle) facts.name = productUnescape_(ogTitle);
  if (!facts.images.length && ogImage) facts.images.push(productUnescape_(ogImage));

  /* 3) DOM 보조(스마트스토어) — 없으면 그냥 넘어간다 */
  if (facts.original_price === null) {
    /* 원가·할인 전 가격이 보이면 잡는다(숫자만). */
    const before = productGrab_(/class=["'][^"']*(?:priceOriginal|originPrice)[^"']*["'][^>]*>([\s\S]{0,80}?)<\//i, text);
    if (before) facts.original_price = productNumber_(before);
  }
  if (facts.rating === null) {
    const r = productGrab_(/(?:평점|별점)[^0-9]{0,12}([0-5](?:\.\d+)?)/, text);
    if (r) facts.rating = productNumber_(r);
  }
  if (facts.reviews === null) {
    const rv = productGrab_(/리뷰\s*([0-9,]{1,7})\s*(?:건|개)/, text);
    if (rv) facts.reviews = productNumber_(rv);
  }
  if (!facts.shipping && /무료\s*배송/.test(text)) facts.shipping = '무료배송';

  /* 4) 소구점 — 설명(og:description)에서 3~5개 */
  const desc = productUnescape_(ogDesc);
  if (desc) {
    const bits = desc.split(/[,·|/]/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length >= 2 && s.length <= 40; })
      .slice(0, 5);
    facts.key_points = bits;
  }
  if (facts.price && facts.original_price && facts.original_price > facts.price) {
    facts.discount_pct = Math.round((1 - facts.price / facts.original_price) * 100);
  }
  return { facts: facts, source: 'gas' };
}

/** "227,100원" 같은 문자열 → 227100 (숫자 없으면 null). */
function productNumber_(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const digits = s.replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return isFinite(n) ? n : null;
}

/**
 * product_fetch — 상품 링크 1차 추출 (READ, longRunning 없음: 최대 8초)
 * payload: { url }
 */
function handleProductFetch_(ss, payload) {
  const target = productNormalizeUrl_(payload && payload.url);
  let res;
  try {
    res = UrlFetchApp.fetch(target.url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      timeout: PRODUCT_TIMEOUT_MS_,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });
  } catch (e) {
    throw createAppError_('ERR_PRODUCT_BLOCKED', '상품 페이지를 받지 못했습니다 — 3칸에 직접 적어 주세요.', { reason: String(e && e.message || e).slice(0, 120) });
  }
  const code = res.getResponseCode ? res.getResponseCode() : 0;
  if (code === 429 || code === 403 || code === 401) {
    throw createAppError_('ERR_PRODUCT_BLOCKED', '쇼핑몰이 자동 수집을 막았습니다 — 3칸에 직접 적어 주세요.', { http: code });
  }
  if (code < 200 || code >= 300) {
    throw createAppError_('ERR_PRODUCT_FETCH', '상품 페이지 응답이 올바르지 않습니다.', { http: code });
  }
  let html = res.getContentText ? String(res.getContentText() || '') : '';
  if (html.length > PRODUCT_MAX_BYTES_) html = html.slice(0, PRODUCT_MAX_BYTES_);
  const parsed = productParseHtml_(html, target.url);
  const out = {
    url: target.url,
    host: target.host,
    source: 'gas',
    facts: parsed.facts,
    note: parsed.facts.name ? '' : '상품명을 찾지 못했습니다 — 3칸에 직접 적어 주세요.'
  };
  return out;
}

/* 편집기에서 바로 시험할 때: productSelfTest() */
function productSelfTest() {
  const html = '<html><head>'
    + '<meta property="og:title" content="14k 여자목걸이 &amp; 하트">'
    + '<meta property="og:image" content="https://shop-phinf.pstatic.net/a.png">'
    + '<meta property="og:description" content="14k 18k 하트 금 목걸이, 기념일 선물, 무료배송">'
    + '<script type="application/ld+json">{"@type":"Product","name":"14k 여자목걸이","category":"주얼리","offers":{"price":227100},"aggregateRating":{"ratingValue":4.86,"reviewCount":2554}}</script>'
    + '</head><body></body></html>';
  const r = productParseHtml_(html, 'https://smartstore.naver.com/x/products/1');
  return { price: r.facts.price, rating: r.facts.rating, reviews: r.facts.reviews, images: r.facts.images.length, points: r.facts.key_points.length };
}
