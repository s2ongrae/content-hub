/**
 * js/productView.js — 🛍️ 상품 링크 → 숏폼 (2026-11-24)
 *
 * 흐름(제미니 고정방 확정안)
 *   ① 링크 입력 → 1차 자동 추출(GAS product_fetch: JSON-LD·og) → 막히면 3칸 수동
 *   ② 사실 카드(사용자가 고칠 수 있음) → ③ 5비트 대본·설명란 5블록 → ④ 영상 스튜디오로 보내 렌더
 *
 * 왜 화면을 따로 두나
 *   기존 제작 스튜디오(blog·video·feed)는 사진·장소·메모 중심이라 상품 사실표와 순서가 다르다.
 *   여기서 사실표를 먼저 만들고, 검증된 영상 파이프라인(대본·TTS·렌더)으로 넘긴다.
 */

import { normalizeProductUrl, normalizeFacts, productScript, descriptionBlocks, factsToMaterials, canRender, PRODUCT_HOSTS } from './productShorts.js?v=20261124';

const LS_MAT = 'contenthub.studio.v1.';
const LS_FACTS = 'contenthub.product.facts.v1';

function readFacts() {
  try { return normalizeFacts(JSON.parse(localStorage.getItem(LS_FACTS) || 'null')); } catch (e) { return normalizeFacts({}); }
}
function writeFacts(f) {
  try { localStorage.setItem(LS_FACTS, JSON.stringify(f)); } catch (e) { /* 저장소가 막혀도 화면은 산다 */ }
}

export function renderProductView(main, ctx) {
  const { h, pageHead, toast, api } = ctx;
  const brand = (ctx.state && ctx.state.brand) || 'daejeon_youth';
  let facts = readFacts();
  let script = null;

  main.appendChild(pageHead('🛍️ 상품 링크 → 숏폼',
    '링크만 넣으면 상품 사실 → 5비트 대본(훅·정보·빌드업·클라이맥스·결론) → 렌더 준비까지'));

  /* ── ① 링크 ── */
  const urlEl = h('input', { type: 'text', placeholder: 'https://smartstore.naver.com/…/products/…', autocomplete: 'off', inputmode: 'url' });
  const loadBtn = h('button', { class: 'btn primary', type: 'button', text: '🔎 상품 불러오기' });
  const status = h('p', { class: 'st-hint' });

  const form = h('div', { class: 'panel' },
    h('h3', null, '① 상품 링크'),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '상품 주소' }), urlEl),
    h('div', { class: 'row' }, loadBtn),
    status,
    h('p', { class: 'hint', text: '지원: ' + PRODUCT_HOSTS.slice(0, 5).join(' · ') + ' 등. 쇼핑몰이 자동 수집을 막으면(429·403) 아래 3칸에 직접 적으면 됩니다.' }));
  main.appendChild(form);

  /* ── ② 사실 카드 ── */
  const nameEl = h('input', { type: 'text', value: facts.name, placeholder: '상품명' });
  const priceEl = h('input', { type: 'text', value: facts.price == null ? '' : String(facts.price), placeholder: '판매가(숫자만)', inputmode: 'numeric' });
  const origEl = h('input', { type: 'text', value: facts.original_price == null ? '' : String(facts.original_price), placeholder: '정가(선택)', inputmode: 'numeric' });
  const catEl = h('input', { type: 'text', value: facts.category, placeholder: '종류(예: 주방용품)' });
  const pointsEl = h('textarea', { rows: '3', placeholder: '핵심 소구점 — 한 줄에 하나(최대 5)' });
  pointsEl.value = (facts.key_points || []).join('\n');
  const imgEl = h('textarea', { rows: '2', placeholder: '이미지 주소(한 줄에 하나) — 자동 추출분. 렌더에는 스튜디오에서 올린 사진이 쓰입니다' });
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
  main.appendChild(h('div', { class: 'panel' }, h('h3', null, '③ 대본'), actions, h('p', { class: 'hint', text: '대본은 확인된 사실만 씁니다(토큰 0). 스튜디오로 보내면 기존 대본 AI·TTS·렌더를 그대로 씁니다.' })));

  const outHost = h('div');
  main.appendChild(outHost);

  function collect() {
    const f = normalizeFacts({
      name: nameEl.value, category: catEl.value, price: priceEl.value, original_price: origEl.value,
      key_points: pointsEl.value.split('\n').map((s) => s.trim()).filter(Boolean),
      images: imgEl.value.split('\n').map((s) => s.trim()).filter(Boolean)
    });
    f.rating = facts.rating; f.reviews = facts.reviews; f.shipping = facts.shipping;
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

  loadBtn.addEventListener('click', async () => {
    const norm = normalizeProductUrl(urlEl.value);
    if (norm.error) { status.textContent = '⚠️ ' + norm.error; return; }
    loadBtn.disabled = true;
    status.textContent = '상품 페이지를 읽는 중…';
    try {
      const res = await api.post('product_fetch', { url: norm.url }, null, { timeoutMs: 20000 });
      const d = (res && res.data) || {};
      const f = normalizeFacts(d.facts || {});
      if (!f.name) throw new Error('상품명을 찾지 못했습니다');
      fill(f);
      status.textContent = '✅ 불러왔습니다 — 값이 맞는지 확인하고 고쳐 주세요.';
      toast('상품 사실을 채웠습니다', 'ok');
    } catch (err) {
      const code = (err && err.code) || '';
      status.textContent = code === 'ERR_PRODUCT_BLOCKED'
        ? '⚠️ 쇼핑몰이 자동 수집을 막았어요. 아래 3칸(상품명·가격·소구점)에 직접 적어 주세요.'
        : '⚠️ 자동 수집 실패 — ' + ((err && err.message) || code || '알 수 없는 오류') + ' · 3칸에 직접 적어 주세요.';
    } finally {
      loadBtn.disabled = false;
    }
  });

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
        h('p', { class: 'st-hint err', text: '⚠️ ' + gate.message + ' (지금: ' + gate.missing.join(' · ') + ' 빠짐)' })));
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
    location.hash = '#/create/video';
    toast('상품 사실을 스튜디오에 넣었습니다 — 사진을 올리고 대본을 뽑으세요', 'ok');
  });
}
