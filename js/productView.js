/**
 * js/productView.js — 🛍️ 상품 링크 → 숏폼 (2026-11-24 · v2)
 *
 * 흐름 (docs/PRODUCT_SHORTS_v2.md)
 *   ① 링크 입력 → [상품 불러오기] = GAS 1차(빠름, 서버 IP — 429/403 이면 분명히 실패)
 *   ② [이미지까지 자동 수집] / [바로 숏츠 만들기] = 집 노트북 product_extract 오더
 *        · GAS 가 성공했으면 사실·이미지 주소를 오더에 실어 보내 브라우저를 열지 않는다.
 *        · 막힌 몰이면 링크만 보내고 노트북이 주거 IP HTTP → 설치된 Chrome 으로 읽는다.
 *        · 노트북이 이미지 1~6장을 받아 장변 1080·JPEG q85 로 줄여 `1.jpg`… 로 드라이브에 넣고
 *          카드(studio.product·media·formats.video.draft·production)에 5비트 대본·설명란까지 저장한다.
 *   ③ 결과: 카드의 사진·자막을 그대로 보여 주고 [영상 스튜디오 열기]·[렌더 오더 보내기](사진 5장부터).
 *
 * 왜 화면이 카드를 먼저 만드나: 노트북이 사진을 넣을 자리(드라이브 ContentHubOS_Uploads/<content_id>/)와
 *   카드가 먼저 있어야 하기 때문이다. 카드 번호는 브라우저에 남겨 다시 눌러도 같은 카드에 덮어쓴다.
 */

import {
  normalizeProductUrl, normalizeFacts, productScript, descriptionBlocks, canRender, factsToMaterials,
  productExtractRequest, imageFilesOf, canRenderWith, PRODUCT_HOSTS
} from './productShorts.js?v=20261124v2';

const LS_MAT = 'contenthub.studio.v1.';
const LS_FACTS = 'contenthub.product.facts.v1';
const LS_CARD = 'contenthub.product.card.v1';
const POLL_MS = 15000;
const POLL_MAX = 40;

function readFacts() {
  try { return normalizeFacts(JSON.parse(localStorage.getItem(LS_FACTS) || 'null')); } catch (e) { return normalizeFacts({}); }
}
function writeFacts(f) {
  try { localStorage.setItem(LS_FACTS, JSON.stringify(f)); } catch (e) { /* 저장소가 막혀도 화면은 산다 */ }
}
function readCardId() { try { return String(localStorage.getItem(LS_CARD) || ''); } catch (e) { return ''; } }
function writeCardId(id) { try { localStorage.setItem(LS_CARD, String(id || '')); } catch (e) { /* 무시 */ } }

export function renderProductView(main, ctx) {
  const { h, pageHead, toast, api } = ctx;
  const brand = (ctx.state && ctx.state.brand) || 'daejeon_youth';
  let facts = readFacts();
  let cardId = readCardId();
  let script = null;
  let product = null;          // 카드에 저장된 상품 정보(studio.product)
  let imageFiles = [];         // 카드에 저장된 사진 이름
  let busy = false;

  main.appendChild(pageHead('🛍️ 상품 링크 → 숏폼',
    '링크만 넣으면 상품 사실 → 이미지 자동 수집(1~6장) → 5비트 대본 → 렌더까지'));

  /* ── ① 링크 ── */
  const urlEl = h('input', { type: 'text', placeholder: 'https://smartstore.naver.com/…/products/…', autocomplete: 'off', inputmode: 'url' });
  const loadBtn = h('button', { class: 'btn primary', type: 'button', text: '🔎 상품 불러오기' });
  const collectBtn = h('button', { class: 'btn', type: 'button', text: '📸 이미지까지 자동 수집' });
  const renderNowBtn = h('button', { class: 'btn', type: 'button', text: '🎬 바로 숏츠 만들기' });
  const status = h('p', { class: 'st-hint' });
  const orderLine = h('p', { class: 'st-order' });

  const form = h('div', { class: 'panel' },
    h('h3', null, '① 상품 링크'),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '상품 주소' }), urlEl),
    h('div', { class: 'row' }, loadBtn),
    h('div', { class: 'row' }, collectBtn, renderNowBtn),
    status,
    orderLine,
    h('p', { class: 'hint', text: '지원: ' + PRODUCT_HOSTS.slice(0, 5).join(' · ') + ' 등. '
      + '[상품 불러오기]는 허브 서버가 바로 읽고, [이미지까지 자동 수집]은 집 노트북(실사용 브라우저)이 사진까지 받아 옵니다. '
      + '쇼핑몰이 서버 수집을 막으면(429·403) 자동 수집이 그 몰을 대신 읽습니다.' }));
  main.appendChild(form);

  /* ── ② 사실 카드 ── */
  const nameEl = h('input', { type: 'text', value: facts.name, placeholder: '상품명' });
  const priceEl = h('input', { type: 'text', value: facts.price == null ? '' : String(facts.price), placeholder: '판매가(숫자만)', inputmode: 'numeric' });
  const origEl = h('input', { type: 'text', value: facts.original_price == null ? '' : String(facts.original_price), placeholder: '정가(선택)', inputmode: 'numeric' });
  const catEl = h('input', { type: 'text', value: facts.category, placeholder: '종류(예: 주방용품)' });
  const pointsEl = h('textarea', { rows: '3', placeholder: '핵심 소구점 — 한 줄에 하나(최대 5)' });
  pointsEl.value = (facts.key_points || []).join('\n');
  const imgEl = h('textarea', { rows: '2', placeholder: '이미지 주소(한 줄에 하나) — 자동 수집 전 힌트로만 씁니다' });
  imgEl.value = (facts.images || []).join('\n');

  const cardBox = h('div', { class: 'panel' },
    h('h3', null, '② 상품 사실 — 확인하고 고치세요'),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '상품명' }), nameEl),
    h('div', { class: 'form-grid two' },
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '판매가' }), priceEl),
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '정가' }), origEl)),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '종류' }), catEl),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '핵심 소구점' }), pointsEl),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '이미지 주소' }), imgEl),
    h('p', { class: 'hint', text: '페이지에 없던 숫자는 넣지 마세요 — 없는 값은 비워 두면 대본이 "미확인"으로 씁니다.' }));
  main.appendChild(cardBox);

  const makeBtn = h('button', { class: 'btn primary', type: 'button', text: '🎬 5비트 대본 만들기' });
  const sendBtn = h('button', { class: 'btn', type: 'button', text: '영상 스튜디오로 보내기 →' });
  sendBtn.disabled = true;
  if (facts.name) sendBtn.disabled = false;
  const actions = h('div', { class: 'row' }, makeBtn, sendBtn);
  main.appendChild(h('div', { class: 'panel' }, h('h3', null, '③ 대본'), actions,
    h('p', { class: 'hint', text: '대본은 확인된 사실만 씁니다(토큰 0). 스튜디오로 보내면 기존 대본 AI·TTS·렌더를 그대로 씁니다.' })));

  const outHost = h('div');
  main.appendChild(outHost);

  function collect() {
    const f = normalizeFacts({
      name: nameEl.value, category: catEl.value, price: priceEl.value, original_price: origEl.value,
      key_points: pointsEl.value.split('\n').map((s) => s.trim()).filter(Boolean),
      images: imgEl.value.split('\n').map((s) => s.trim()).filter(Boolean)
    });
    f.rating = facts.rating; f.reviews = facts.reviews; f.shipping = facts.shipping;
    f.brand = facts.brand;
    return f;
  }

  function fill(f) {
    facts = f;
    nameEl.value = f.name || '';
    priceEl.value = f.price == null ? '' : String(f.price);
    origEl.value = f.original_price == null ? '' : String(f.original_price);
    catEl.value = f.category || '';
    pointsEl.value = (f.key_points || []).join('\n');
    imgEl.value = (f.images || []).join('\n');
    sendBtn.disabled = !f.name;
    writeFacts(f);
  }

  function setBusy(on, label) {
    busy = on;
    [loadBtn, collectBtn, renderNowBtn, makeBtn].forEach((b) => { b.disabled = on; });
    if (label !== undefined) orderLine.textContent = label || '';
  }

  /* ── ① GAS 1차 — 빠르고, 막히면 그 사실을 그대로 말한다 ── */
  loadBtn.addEventListener('click', async () => {
    const norm = normalizeProductUrl(urlEl.value);
    if (norm.error) { status.textContent = '⚠️ ' + norm.error; return; }
    setBusy(true);
    status.textContent = '상품 페이지를 읽는 중…';
    try {
      const res = await api.post('product_fetch', { url: norm.url }, null, { timeoutMs: 20000 });
      const d = (res && res.data) || {};
      const f = normalizeFacts(d.facts || {});
      if (!f.name) throw new Error('상품명을 찾지 못했습니다');
      fill(f);
      status.textContent = '✅ 불러왔습니다 — 값이 맞는지 확인하고 [이미지까지 자동 수집]을 누르면 사진까지 받아 옵니다.';
      toast('상품 사실을 채웠습니다', 'ok');
    } catch (err) {
      const code = (err && err.code) || '';
      status.textContent = code === 'ERR_PRODUCT_BLOCKED'
        ? '⚠️ 쇼핑몰이 서버 수집을 막았어요 — [이미지까지 자동 수집]을 누르면 집 노트북(실사용 브라우저)이 대신 읽습니다.'
        : '⚠️ 자동 수집 실패 — ' + ((err && err.message) || code || '알 수 없는 오류') + ' · 아래 3칸에 직접 적어도 됩니다.';
    } finally { setBusy(false); }
  });

  /* ── ② 카드 확보 → product_extract 오더 → 상태 폴링 ── */
  async function ensureCard(f, norm, log) {
    if (cardId) return cardId;
    const res = await api.createContent({
      brand: brand,
      place_name: (f.name || '상품 숏폼').slice(0, 80),
      region_dong: '',
      category: (f.category || '').slice(0, 60),
      cluster_id: '상품 링크',
      target_keywords: '',
      naver_place_url: '',
      media_drive_url: '',
      receipt_verified: false,
      allow_partial_shortform: false
    });
    cardId = (res && res.data && res.data.content_id) || '';
    if (!cardId) { const e = new Error('카드 번호를 받지 못했습니다'); e.code = 'ERR_BAD_RESPONSE'; throw e; }
    writeCardId(cardId);
    log('카드 ' + cardId + ' 를 만들었습니다');
    return cardId;
  }

  /** 오더 1회 + 15초 폴링. 끝나면 카드에서 결과를 다시 읽는다. */
  async function sendProductOrder(autoRender) {
    if (busy) { toast('이미 보낸 오더가 끝나기를 기다리는 중입니다', 'err'); return; }
    const norm = normalizeProductUrl(urlEl.value);
    if (norm.error) { status.textContent = '⚠️ ' + norm.error; return; }
    const f = collect();
    fill(f);
    setBusy(true, '노트북에 오더를 보내는 중…');
    status.textContent = autoRender
      ? '노트북이 상품 페이지를 읽고 사진을 받아 옵니다 — 렌더는 승인 뒤에 실행됩니다.'
      : '노트북이 상품 페이지를 읽고 사진을 받아 옵니다…';
    try {
      const id = await ensureCard(f, norm, (m) => { orderLine.textContent = m; });
      /* 사실을 먼저 카드에 저장해 둔다 — 오더가 길어 사실을 못 실어도 노트북이 카드에서 읽는다. */
      try {
        const det = await api.getContentDetail(id);
        await api.updateContent({
          content_id: id, expected_version: (det && det.data && det.data.version) || null,
          patch: {
            studio: {
              place: { name: f.name || '' },
              product: { name: f.name, price: f.price, original_price: f.original_price, category: f.category, key_points: f.key_points, url: norm.url }
            }
          }, patch_mode: 'deep'
        });
      } catch (e) { /* 카드 선저장 실패는 오더를 막지 않는다 — 노트북이 직접 읽는다 */ }

      const req = productExtractRequest(f, { content_id: id, brand: brand, url: norm.url, auto_render: autoRender, seconds: 20 });
      const res = await api.post('hub_order', req, null, { timeoutMs: 45000 });
      const d = (res && res.data) || {};
      const orderId = d.order_id || '';
      if (!orderId) throw new Error('오더 번호를 받지 못했습니다');
      toast('오더 접수 ' + orderId, 'ok');
      orderLine.textContent = orderId + ' · 노트북이 처리 중입니다(사진 1~6장 · 5비트 대본)';
      orderLine.className = 'st-order';
      pollOrder(orderId, autoRender);
    } catch (err) {
      setBusy(false);
      const code = (err && err.code) || '';
      const msg = code === 'ERR_QUEUE_TYPE_UNKNOWN'
        ? '⚠️ 노트북 큐가 아직 product_extract 를 모릅니다 — 큐(CommandQueue) 재배포 뒤 다시 보내 주세요'
        : '⚠️ ' + ((err && err.message) || code || '오더를 보내지 못했습니다');
      status.textContent = msg;
      orderLine.textContent = '';
      toast(msg, 'err');
    }
  }

  function pollOrder(orderId, autoRender) {
    let n = 0;
    const tick = async () => {
      if (!orderLine.isConnected) { setBusy(false); return; }
      n++;
      if (n > POLL_MAX) { setBusy(false, orderId + ' · 시간이 지났습니다 — [영상 스튜디오]에서 카드를 확인하세요'); return; }
      try {
        const d = await api.hubOrderStatus(orderId);
        const st = String(d.status || '').toUpperCase();
        orderLine.textContent = orderId + ' · ' + (st || 'PENDING') + (d.result ? ' — ' + String(d.result).split('\n')[0].slice(0, 90) : '');
        if (st === 'DONE') {
          setBusy(false, orderId + ' · 완료');
          toast('상품 수집이 끝났습니다 — 사진·대본을 카드에서 불러옵니다', 'ok');
          await loadFromCard(autoRender);
          return;
        }
        if (['FAILED', 'REJECTED', 'EXPIRED', 'TIMEOUT_REVIEW', 'REVIEW_NEEDED'].indexOf(st) >= 0) {
          setBusy(false, orderId + ' · ' + st + (d.error ? ' — ' + String(d.error).slice(0, 120) : ''));
          toast('오더가 ' + st + ' 로 끝났습니다', 'err');
          return;
        }
      } catch (e) { /* 일시 오류는 계속 폴링 */ }
      setTimeout(tick, POLL_MS);
    };
    setTimeout(tick, 2500);
  }

  /** 카드에서 결과(사실·사진·대본)를 다시 읽어 화면에 붙인다. */
  async function loadFromCard() {
    if (!cardId) return;
    try {
      const res = await api.getContentDetail(cardId);
      const d = (res && res.data) || {};
      const payload = d.payload || {};
      const studio = payload.studio || {};
      product = studio.product || null;
      const draft = (studio.formats && studio.formats.video && studio.formats.video.draft) || null;
      imageFiles = imageFilesOf(product);
      if (product) {
        fill(normalizeFacts(Object.assign({}, product, { images: product.images || [] })));
      }
      paintResult(draft, product, imageFiles);
    } catch (e) {
      toast('카드 결과를 읽지 못했습니다 — 조금 뒤 새로고침해 주세요', 'err');
    }
  }

  function paintResult(draft, prod, names) {
    while (outHost.firstChild) outHost.removeChild(outHost.firstChild);
    const gate = canRenderWith(names);
    const head = h('div', { class: 'panel' },
      h('h3', null, '⑤ 수집 결과 — 카드 ' + (cardId || '')),
      productRow('사진', names.length ? names.length + '장 · ' + names.join(', ') : '0장'),
      productRow('상품', (prod && prod.name) || facts.name || ''),
      productRow('가격', prod && prod.price != null ? String(prod.price).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원' + (prod.discount_pct ? ' (' + prod.discount_pct + '% 할인)' : '') : '미확인'),
      h('p', { class: 'st-hint' + (gate.ok ? '' : ' err'), text: gate.ok ? '' : '⚠️ ' + gate.message }));
    outHost.appendChild(head);

    if (!draft || !Array.isArray(draft.captions) || !draft.captions.length) {
      outHost.appendChild(h('div', { class: 'panel' }, h('p', { class: 'st-hint', text: '카드에 대본이 아직 없습니다 — [이미지까지 자동 수집]을 다시 누르거나 스튜디오에서 대본을 뽑으세요.' })));
    } else {
      const box = h('div', { class: 'panel' }, h('h3', null, '5비트 대본 · 자막 큐'));
      const list = h('div', { class: 'st-cues' });
      draft.captions.slice(0, 12).forEach((c) => {
        const arr = Array.isArray(c);
        const start = arr ? c[0] : c.start;
        const end = arr ? c[1] : c.end;
        const text = arr ? c[2] : c.text;
        const beat = arr ? c[3] : c.beat;
        list.appendChild(h('div', { class: 'st-cue' },
          h('span', { class: 'st-cue-t', text: Number(start).toFixed(1) + '–' + Number(end).toFixed(1) + 's' }),
          h('span', { text: (beat ? '[' + beat + '] ' : '') + String(text || '') })));
      });
      box.appendChild(list);
      if (draft.description) box.appendChild(h('pre', { class: 'st-pre' }, draft.description));
      outHost.appendChild(box);
    }

    const row = h('div', { class: 'row' });
    const studioBtn = h('button', { class: 'btn primary', type: 'button', text: '영상 스튜디오 열기 →' });
    studioBtn.addEventListener('click', () => {
      try {
        localStorage.setItem(LS_MAT + brand, JSON.stringify({ place: { name: (prod && prod.name) || facts.name || '' } }));
      } catch (e) { /* 저장 실패해도 이동은 한다 */ }
      location.hash = '#/create/video?card=' + encodeURIComponent(cardId);
    });
    row.appendChild(studioBtn);
    if (gate.ok) {
      const renderBtn = h('button', { class: 'btn', type: 'button', text: '🎬 이 사진으로 렌더 (승인)' });
      renderBtn.addEventListener('click', async () => {
        renderBtn.disabled = true;
        try {
          const det = await api.getContentDetail(cardId);
          const payload = (det && det.data && det.data.payload) || {};
          const draft = (payload.studio && payload.studio.formats && payload.studio.formats.video && payload.studio.formats.video.draft) || {};
          const body = {
            type: 'content_render', content_id: cardId, brand: brand,
            images: names.slice(0, 25), profile: 'captions', sub_style: 'auto', template: 'auto', pace: 'fast'
          };
          if (Array.isArray(draft.captions) && draft.captions.length) {
            body.captions = draft.captions;
            body.narration = draft.narration || [];
          }
          const res = await api.post('hub_order', body, null, { timeoutMs: 45000 });
          const id = (res && res.data && res.data.order_id) || '';
          toast('렌더 오더 ' + id + ' — 승인하면 실행됩니다', 'ok');
          orderLine.textContent = id + ' · 렌더 승인 대기(오더함·텔레그램에서 승인)';
        } catch (err) {
          toast('렌더 오더를 보내지 못했습니다 — ' + ((err && err.message) || ''), 'err');
        } finally { renderBtn.disabled = false; }
      });
      row.appendChild(renderBtn);
    }
    if (row.firstChild) outHost.appendChild(h('div', { class: 'panel' }, row));
  }

  function productRow(label, value) {
    return h('p', { class: 'st-hint' }, h('strong', { text: label + ': ' }), h('span', { text: value || '' }));
  }

  collectBtn.addEventListener('click', () => sendProductOrder(false));
  renderNowBtn.addEventListener('click', () => sendProductOrder(true));

  /* ── ③ 브라우저 대본(토큰 0) — 오더 없이 바로 보고 싶을 때 ── */
  makeBtn.addEventListener('click', () => {
    const f = collect();
    if (!f.name) { toast('상품명을 먼저 넣어 주세요', 'err'); return; }
    fill(f);
    script = productScript(f, { seconds: 20 });
    while (outHost.firstChild) outHost.removeChild(outHost.firstChild);

    const beats = h('div', { class: 'panel' }, h('h3', null, '5비트 대본 (20초)'));
    script.beats.forEach((b) => beats.appendChild(h('div', { class: 'gate-row' },
      h('span', { text: b.from + '~' + b.to + '초 · ' + b.beat }),
      h('span', { class: 'gv na', text: b.text }))));
    beats.appendChild(h('p', { class: 'hint', text: '훅: ' + script.hook + ' / 보조: ' + script.hook_sub }));
    outHost.appendChild(beats);

    const desc = descriptionBlocks(f, { affiliate: true });
    const descBox = h('div', { class: 'panel' }, h('h3', null, '설명란 5블록 (제휴 표기 포함)'));
    descBox.appendChild(h('pre', { class: 'st-pre' }, desc.text));
    const copyBtn = h('button', { class: 'btn', type: 'button', text: '설명란 복사' });
    copyBtn.addEventListener('click', () => {
      try { navigator.clipboard.writeText(desc.text); toast('설명란을 복사했습니다', 'ok'); }
      catch (e) { toast('복사가 막혔습니다 — 길게 눌러 선택하세요', 'err'); }
    });
    descBox.appendChild(copyBtn);
    outHost.appendChild(descBox);

    const gate = canRender(f);
    if (!gate.ok) {
      outHost.appendChild(h('div', { class: 'panel' },
        h('p', { class: 'st-hint err', text: '⚠️ ' + gate.message + ' — [이미지까지 자동 수집]을 누르면 노트북이 사진을 받아 옵니다.' })));
    }
    sendBtn.disabled = false;
  });

  sendBtn.addEventListener('click', () => {
    const f = collect();
    if (!f.name) { toast('상품명을 먼저 넣어 주세요', 'err'); return; }
    fill(f);
    const materials = factsToMaterials(f, {});
    try {
      localStorage.setItem(LS_MAT + brand, JSON.stringify(materials));
    } catch (e) {
      toast('브라우저 저장이 막혀 있어 스튜디오로 넘기지 못했습니다', 'err');
      return;
    }
    location.hash = cardId ? '#/create/video?card=' + encodeURIComponent(cardId) : '#/create/video';
    toast('상품 사실을 스튜디오에 넣었습니다 — 대본을 뽑고 사진으로 렌더하세요', 'ok');
  });

  /* 카드에 이미 결과가 있으면 들어오자마자 보여 준다(다시 눌러 기다리지 않게). */
  if (cardId) loadFromCard().catch(() => null);
}
