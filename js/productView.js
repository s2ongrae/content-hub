/**
 * js/productView.js — 🛍️ 상품 링크 → 숏폼 (2026-11-24 · v2 / 2026-11-26 · v3.1)
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
 * 2026-11-26 (뷔투 이관 Q-20261126-133128-yitv · Q-20261126-140119-duwn)
 *   · 이미지 수집이 실패해도 막다른 길이 아니다 — 5단계(js/productFallback.js):
 *     ① 사람 말 실패 사유 ② 사진 직접 올리기 · 핵심 특징 3개 · 다른 링크 ③ 입력값만으로 기본 틀
 *     ④ 실패한 링크는 [다시 시도할 링크]에 남긴다 ⑤ 적던 값·고른 트랙은 자동 저장(새로고침 유지)
 *   · 운영 트랙 A(대전 청년)·B(삐약 김메리) 탭(js/productTracks.js) — 마지막 쓴 트랙을 기억(첫 사용 A).
 *     탭을 바꿔도 상품명·사진·핵심 특징 3개는 그대로, 채널 목록·비율·문구만 바뀐다.
 *     (클립 방식 A/B — 챌린지·쇼핑커넥트 — 는 productShorts.js 몫으로 그대로 둔다.)
 *
 * 왜 화면이 카드를 먼저 만드나: 노트북이 사진을 넣을 자리(드라이브 ContentHubOS_Uploads/<content_id>/)와
 *   카드가 먼저 있어야 하기 때문이다. 카드 번호는 브라우저에 남겨 다시 눌러도 같은 카드에 덮어쓴다.
 */

import {
  normalizeProductUrl, normalizeFacts, productScript, descriptionBlocks, canRender, factsToMaterials,
  productExtractRequest, imageFilesOf, canRenderWith, PRODUCT_HOSTS,
  SC_NOTICE_CLIP, CLIP_CHALLENGE_TAG, PRODUCT_TRACKS, normalizeTrack, trackRules, trackWarnings,
  dedupState, dedupKey, urlHash
} from './productShorts.js?v=20261124v3';
import { copyButton } from './clipboard.js?v=20261126a';
import { uploadPhoto, isPhotoFile, PHOTO_MAX_COUNT } from './uploadVideo.js?v=20261127a';
import {
  BRAND_TRACKS, trackById, normalizeBrandTrack, brandOfTrack, channelsOfTrack, channelLabelOf,
  channelPlan, trackSwitchPlan, trackTagList, readBrandTrack, writeBrandTrack
} from './productTracks.js?v=20261126a';
import {
  failureReason, fallbackPanel, retryQueuePanel, enqueueRetry, dequeueRetry, markRetry,
  loadRetryQueue, saveRetryQueue, draftOf, saveDraft, loadDraft, draftNotice,
  keyPointSlots, mergeKeyPoints, basicTemplateGate, KEY_POINT_SLOTS
} from './productFallback.js?v=20261126a';

const LS_MAT = 'contenthub.studio.v1.';
const LS_FACTS = 'contenthub.product.facts.v1';
const LS_CARD = 'contenthub.product.card.v1';
const LS_CARD_BRAND = 'contenthub.product.card.brand.v1';
const LS_TRACK = 'contenthub.product.track.v1';
const LS_DEDUP = 'contenthub.product.dedup.v1';
const POLL_MS = 15000;
const POLL_MAX = 40;

/** localStorage 가 막힌 브라우저(사생활 보호 모드)에서도 화면이 살게 — 만지다 던지지 않는다. */
function safeStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}
function lsGet(key, fallback) {
  try { const s = safeStorage(); return s ? s.getItem(key) : fallback; } catch (e) { return fallback; }
}
function lsSet(key, value) {
  try { const s = safeStorage(); if (s) s.setItem(key, value); return true; } catch (e) { return false; }
}

function readFacts() {
  try { return normalizeFacts(JSON.parse(lsGet(LS_FACTS, 'null'))); } catch (e) { return normalizeFacts({}); }
}
function writeFacts(f) {
  try { lsSet(LS_FACTS, JSON.stringify(f)); } catch (e) { /* 저장소가 막혀도 화면은 산다 */ }
}
function readCardId() { try { return String(lsGet(LS_CARD, '') || ''); } catch (e) { return ''; } }
function writeCardId(id) { try { lsSet(LS_CARD, String(id || '')); } catch (e) { /* 무시 */ } }
function readCardBrand() { try { return String(lsGet(LS_CARD_BRAND, '') || ''); } catch (e) { return ''; } }
function writeCardBrand(b) { try { lsSet(LS_CARD_BRAND, String(b || '')); } catch (e) { /* 무시 */ } }
function readTrack() { try { return normalizeTrack(lsGet(LS_TRACK, '') || 'commerce'); } catch (e) { return 'commerce'; } }
function writeTrack(t) { try { lsSet(LS_TRACK, normalizeTrack(t)); } catch (e) { /* 무시 */ } }

/** 12시간 중복 억제 — 브라우저 기록(브랜드+url 해시 → {content_id, at}). 서버 색인과 같은 규칙. */
function readDedup() {
  try { const v = JSON.parse(lsGet(LS_DEDUP, '{}')); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}
function dedupRecordOf(brand, url) {
  if (!url) return null;
  return readDedup()[dedupKey(brand, url)] || null;
}
function writeDedup(brand, url, contentId, atIso) {
  if (!url) return;
  const map = readDedup();
  map[dedupKey(brand, url)] = { content_id: String(contentId || ''), at: atIso || new Date().toISOString() };
  /* 오래된 기록은 버린다(12시간 지난 것) — 저장소가 커지지 않게. */
  const now = Date.now();
  Object.keys(map).forEach((k) => { if (!dedupState(map[k], now).blocked) delete map[k]; });
  try { lsSet(LS_DEDUP, JSON.stringify(map)); } catch (e) { /* 무시 */ }
}

export function renderProductView(main, ctx) {
  const { h, pageHead, toast, api } = ctx;

  /* ── 2026-11-26: 저장된 초안이 있으면 그 값을 먼저 쓴다(새로고침해도 적던 값 그대로) ── */
  const draft = loadDraft(safeStorage(), Date.now());
  const draftFacts = draft ? normalizeFacts(draft.facts) : null;
  let brandTrack = draft ? normalizeBrandTrack(draft.brand_track) : readBrandTrack(safeStorage());
  let brand = brandOfTrack(brandTrack);
  let facts = draftFacts && (draftFacts.name || draftFacts.key_points.length) ? draftFacts : readFacts();
  let cardId = (draft && draft.card_id) || readCardId();
  let track = draft ? normalizeTrack(draft.clip_track) : readTrack();
  let selectedChannels = draft && draft.channels.length
    ? channelsOfTrack(brandTrack).filter((ch) => draft.channels.indexOf(ch) >= 0)
    : channelsOfTrack(brandTrack);
  if (!selectedChannels.length) selectedChannels = channelsOfTrack(brandTrack);
  let uploadedNames = draft ? draft.uploaded.slice() : [];
  let retryQueue = loadRetryQueue(safeStorage());
  let script = null;
  let product = null;          // 카드에 저장된 상품 정보(studio.product)
  let imageFiles = [];         // 카드에 저장된 사진 이름
  let busy = false;
  let draftTimer = null;

  main.appendChild(pageHead('🛍️ 상품 링크 → 숏폼',
    '링크만 넣으면 상품 사실 → 이미지 자동 수집(1~6장) → 5비트 대본 → 렌더까지'));

  const draftLine = h('p', { class: 'hint', text: draft ? draftNotice(draft) : '' });

  /* ── ⓪ 트랙 — 브랜드(운영) + 클립 방식(챌린지·수익화) ── */
  const brandBox = h('div', { class: 'st-chips' });
  const switchNote = h('p', { class: 'st-hint' });
  const brandNote = h('p', { class: 'hint', text: '' });

  const clipBox = h('div', { class: 'st-chips' });
  const clipNote = h('div', { class: 'st-track-note' });

  function paintBrandTabs() {
    brandBox.replaceChildren();
    BRAND_TRACKS.forEach((t) => {
      const b = h('button', { class: 'st-chip' + (brandTrack === t.id ? ' on' : ''), type: 'button', text: t.label });
      b.addEventListener('click', () => switchBrand(t.id));
      brandBox.appendChild(b);
    });
    brandNote.textContent = trackById(brandTrack).short + ' 채널: ' + channelsOfTrack(brandTrack).map(channelLabelOf).join(' · ');
  }

  /** 브랜드(운영) 트랙 전환 — 입력값은 그대로, 채널·문구·비율만 바꾼다. */
  function switchBrand(id) {
    const next = normalizeBrandTrack(id);
    if (next === brandTrack) return;
    const plan = trackSwitchPlan(brandTrack, next, collect());
    brandTrack = plan.track;
    brand = plan.brand;
    writeBrandTrack(safeStorage(), brandTrack);
    /* 트랙마다 채널 묶음이 다르다 — 새 트랙의 채널을 모두 켜 둔 채로 시작한다(B 는 3개, A 는 5개). */
    selectedChannels = plan.channels.slice();
    /* 카드도 브랜드에 속한다 — 다른 브랜드 카드에 덮어쓰지 않게 새 카드로 시작한다(적은 값은 유지). */
    const cardBrand = readCardBrand();
    if (cardId && cardBrand && cardBrand !== brand) {
      cardId = '';
      writeCardId('');
      writeCardBrand('');
    }
    switchNote.textContent = plan.note;
    paintBrandTabs();
    paintChannels();
    paintClipTrack();
    paintUploads();
    if (outHost.firstChild) {
      while (outHost.firstChild) outHost.removeChild(outHost.firstChild);
      outHost.appendChild(h('div', { class: 'panel' },
        h('p', { class: 'st-hint', text: '트랙을 ' + trackById(brandTrack).short + '로 바꿨어요 — 상품명·사진·핵심 특징은 그대로입니다. [🎬 5비트 대본 만들기]를 다시 누르면 이 트랙 문구로 나옵니다.' })));
    }
    saveDraftNow();
  }

  function paintClipTrack() {
    const rules = trackRules(track);
    clipBox.replaceChildren();
    PRODUCT_TRACKS.forEach((id) => {
      const r = trackRules(id);
      const b = h('button', { class: 'st-chip' + (track === id ? ' on' : ''), type: 'button', text: r.label });
      b.addEventListener('click', () => {
        if (track === normalizeTrack(id)) return;
        track = normalizeTrack(id);
        writeTrack(track);
        paintClipTrack();
        /* 클립 방식을 바꾸면 앞서 만든 대본·문구는 다른 방식의 것 — 남겨 두면 잘못 복사한다. */
        if (outHost.firstChild) {
          while (outHost.firstChild) outHost.removeChild(outHost.firstChild);
          outHost.appendChild(h('div', { class: 'panel' },
            h('p', { class: 'st-hint', text: '클립 방식을 ' + trackRules(track).label + ' 로 바꿨습니다 — [🎬 5비트 대본 만들기]를 다시 누르면 이 방식 문구로 나옵니다.' })));
        }
        saveDraftNow();
      });
      clipBox.appendChild(b);
    });
    clipNote.replaceChildren(
      h('p', { class: 'st-hint', text: rules.note }),
      h('p', { class: 'st-hint', text: '✅ 필수: ' + rules.required.join(' · ') }),
      h('p', { class: 'st-hint err', text: '⛔ 금지: ' + rules.forbidden.join(' · ') }));
  }

  main.appendChild(h('div', { class: 'panel' },
    h('h3', null, '⓪ 트랙'),
    h('p', { class: 'hint', text: '브랜드마다 운영 채널이 다릅니다. 트랙을 바꿔도 상품명·사진·핵심 특징은 그대로이고, 채널·비율·문구만 바뀝니다.' }),
    h('div', { class: 'st-track-row' }, h('span', { class: 'st-dim', text: '브랜드' }), brandBox),
    brandNote,
    switchNote,
    draftLine,
    h('div', { class: 'st-track-row', style: 'margin-top:10px' }, h('span', { class: 'st-dim', text: '클립 방식' }), clipBox),
    h('p', { class: 'hint', text: '클립 방식은 네이버 클립 기준 A(챌린지)·B(쇼핑커넥트 수익화)입니다 — 위 브랜드 트랙과 다른 선택입니다.' }),
    clipNote));

  /* ── ① 링크 ── */
  const urlEl = h('input', { type: 'text', placeholder: 'https://smartstore.naver.com/…/products/…', autocomplete: 'off', inputmode: 'url', value: draft ? draft.url : '' });
  const loadBtn = h('button', { class: 'btn primary', type: 'button', text: '🔎 상품 불러오기' });
  const collectBtn = h('button', { class: 'btn', type: 'button', text: '📸 이미지까지 자동 수집' });
  const renderNowBtn = h('button', { class: 'btn', type: 'button', text: '🎬 바로 숏츠 만들기' });
  const status = h('p', { class: 'st-hint', text: draft ? draftNotice(draft) : '' });
  const orderLine = h('p', { class: 'st-order' });

  const imageInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, style: 'display:none' });
  imageInput.addEventListener('change', () => {
    const files = Array.from(imageInput.files || []);
    imageInput.value = '';
    uploadDirect(files);
  });
  const uploadNote = h('p', { class: 'st-hint' });

  const form = h('div', { class: 'panel' },
    h('h3', null, '① 상품 링크'),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '상품 주소' }), urlEl),
    h('div', { class: 'row' }, loadBtn),
    h('div', { class: 'row' }, collectBtn, renderNowBtn),
    status,
    orderLine,
    uploadNote,
    imageInput,
    h('p', { class: 'hint', text: '지원: ' + PRODUCT_HOSTS.slice(0, 5).join(' · ') + ' 등. '
      + '[상품 불러오기]는 허브 서버가 바로 읽고, [이미지까지 자동 수집]은 집 노트북(실사용 브라우저)이 사진까지 받아 옵니다. '
      + '쇼핑몰이 서버 수집을 막으면(429·403) 자동 수집이 그 몰을 대신 읽습니다.' }));
  main.appendChild(form);

  /* 실패 안내(5단계)와 다시 시도 목록이 들어갈 자리 — 링크 칸 바로 아래 */
  const failureHost = h('div');
  main.appendChild(failureHost);

  /* ── ② 사실 카드 ── */
  const nameEl = h('input', { type: 'text', value: facts.name, placeholder: '상품명' });
  const priceEl = h('input', { type: 'text', value: facts.price == null ? '' : String(facts.price), placeholder: '판매가(숫자만)', inputmode: 'numeric' });
  const origEl = h('input', { type: 'text', value: facts.original_price == null ? '' : String(facts.original_price), placeholder: '정가(선택)', inputmode: 'numeric' });
  const catEl = h('input', { type: 'text', value: facts.category, placeholder: '종류(예: 주방용품)' });
  /* 핵심 특징은 3칸 — 뷔투 초안의 '핵심 특징 3개 입력'을 그대로 화면에 둔다(4·5번째는 접지 않고 옆에). */
  const slotValues = keyPointSlots(facts, KEY_POINT_SLOTS);
  const kpEls = slotValues.map((v, i) => h('input', {
    type: 'text', value: v, autocomplete: 'off',
    placeholder: ['예) 3초 만에 붙는 자석', '예) 물빠짐 좋은 바닥', '예) 세척 쉬운 분리형'][i] || '핵심 특징',
    'aria-label': '핵심 특징 ' + (i + 1)
  }));
  const extraEl = h('textarea', { rows: '2', placeholder: '4·5번째 특징(선택) — 한 줄에 하나' });
  extraEl.value = (facts.key_points || []).slice(KEY_POINT_SLOTS).join('\n');
  const imgEl = h('textarea', { rows: '2', placeholder: '이미지 주소(한 줄에 하나) — 자동 수집 전 힌트로만 씁니다' });
  imgEl.value = (facts.images || []).join('\n');

  const cardBox = h('div', { class: 'panel' },
    h('h3', null, '② 상품 사실 — 확인하고 고치세요'),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '상품명' }), nameEl),
    h('div', { class: 'form-grid two' },
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '판매가' }), priceEl),
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '정가' }), origEl)),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '종류' }), catEl),
    h('div', { class: 'field' },
      h('span', { class: 'field-label', text: '핵심 특징 3개' }),
      h('div', { class: 'st-kp' },
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: '1' }), kpEls[0]),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: '2' }), kpEls[1]),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: '3' }), kpEls[2])),
      extraEl),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '이미지 주소' }), imgEl),
    h('p', { class: 'hint', text: '페이지에 없던 숫자는 넣지 마세요 — 없는 값은 비워 두면 대본이 "미확인"으로 씁니다.' }));
  main.appendChild(cardBox);

  /* 채널별 문구·비율 미리보기 — 트랙을 바꾸면 여기만 갈아 끼운다(상품 사실은 그대로). */
  const channelBox = h('div', { class: 'st-chips' });
  const channelCards = h('div', { class: 'panel' });
  main.appendChild(h('div', { class: 'panel' },
    h('h3', null, '②-2 채널과 문구'),
    h('p', { class: 'hint', text: '고른 채널마다 비율과 문구가 다릅니다. 트랙을 바꾸면 이 카드들만 바뀝니다.' }),
    channelBox,
    channelCards));

  const makeBtn = h('button', { class: 'btn primary', type: 'button', text: '🎬 5비트 대본 만들기' });
  const sendBtn = h('button', { class: 'btn', type: 'button', text: '영상 스튜디오로 보내기 →' });
  sendBtn.disabled = true;
  if (facts.name) sendBtn.disabled = false;
  const actions = h('div', { class: 'row' }, makeBtn, sendBtn);
  main.appendChild(h('div', { class: 'panel' }, h('h3', null, '③ 대본'), actions,
    h('p', { class: 'hint', text: '대본은 확인된 사실만 씁니다(토큰 0). 스튜디오로 보내면 기존 대본 AI·TTS·렌더를 그대로 씁니다.' })));

  const outHost = h('div');
  main.appendChild(outHost);

  const retryHost = h('div');
  main.appendChild(retryHost);

  /* ────────────────────────── ⑤ 초안 저장 ────────────────────────── */

  function collect() {
    const f = normalizeFacts({
      name: nameEl.value, category: catEl.value, price: priceEl.value, original_price: origEl.value,
      key_points: mergeKeyPoints(kpEls.map((el) => el.value).concat(extraEl.value.split('\n')), kpEls.map((el) => el.value)),
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
    const slots = keyPointSlots(f, KEY_POINT_SLOTS);
    kpEls.forEach((el, i) => { el.value = slots[i]; });
    extraEl.value = (f.key_points || []).slice(KEY_POINT_SLOTS).join('\n');
    imgEl.value = (f.images || []).join('\n');
    sendBtn.disabled = !f.name;
    writeFacts(f);
  }

  /** 지금 화면 그대로를 저장 — 새로고침·트랙 전환에도 적던 값이 남는다. */
  function saveDraftNow() {
    const d = draftOf(collect(), {
      url: urlEl.value,
      brand_track: brandTrack,
      clip_track: track,
      channels: selectedChannels,
      uploaded: uploadedNames,
      card_id: cardId
    });
    const r = saveDraft(safeStorage(), d);
    if (!r.ok) draftLine.textContent = '이 브라우저에서는 자동 저장이 막혀 있어요 — 새로고침하면 적은 값이 사라집니다.';
    return r.ok;
  }
  function scheduleDraftSave() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { draftTimer = null; saveDraftNow(); }, 500);
  }
  [urlEl, nameEl, priceEl, origEl, catEl, extraEl, imgEl].forEach((el) => el.addEventListener('input', scheduleDraftSave));
  kpEls.forEach((el) => el.addEventListener('input', scheduleDraftSave));

  /* ────────────────────────── ② 채널 미리보기 ────────────────────────── */

  function toggleChannel(ch) {
    const i = selectedChannels.indexOf(ch);
    if (i >= 0) {
      if (selectedChannels.length === 1) { toast('채널은 하나 이상 남겨 주세요', 'err'); return; }
      selectedChannels = selectedChannels.filter((x) => x !== ch);
    } else {
      selectedChannels = channelsOfTrack(brandTrack).filter((x) => selectedChannels.indexOf(x) >= 0 || x === ch);
    }
    paintChannels();
    saveDraftNow();
  }

  function paintChannels() {
    channelBox.replaceChildren();
    channelsOfTrack(brandTrack).forEach((ch) => {
      const on = selectedChannels.indexOf(ch) >= 0;
      const b = h('button', { class: 'st-chip' + (on ? ' on' : ''), type: 'button', text: channelLabelOf(ch) });
      b.addEventListener('click', () => toggleChannel(ch));
      channelBox.appendChild(b);
    });
    const t = trackById(brandTrack);
    channelCards.replaceChildren(h('h3', null, '채널별 문구·비율 — ' + t.short));
    channelCards.appendChild(h('p', { class: 'hint', text: t.where + ' · ' + (brandTrack === 'B'
      ? 'B는 블로그·피드를 운영하지 않아 3채널만 보여 줍니다.'
      : 'A는 블로그·쇼츠·릴스·피드·클립 5채널입니다.') }));
    channelPlan(brandTrack, collect(), selectedChannels).forEach((c) => {
      channelCards.appendChild(h('div', { class: 'st-cue' },
        h('span', { class: 'st-cue-t', text: c.label + ' · ' + c.ratio }),
        h('span', null,
          h('strong', { text: c.hook }),
          h('br'),
          h('span', { class: 'st-dim', text: c.voice + ' · ' + c.cta + ' · ' + c.hashtags.join(' ') }))));
    });
  }

  /* ────────────────────────── ② 사진 직접 올리기 (5단계 중 ②) ────────────────────────── */

  function paintUploads() {
    uploadNote.textContent = uploadedNames.length
      ? '카드에 올린 사진 ' + uploadedNames.length + '장: ' + uploadedNames.join(', ')
      : '';
  }

  async function uploadDirect(files) {
    const list = (Array.isArray(files) ? files : []).filter((f) => f && (isPhotoFile(f.name) || /^image\//.test(String(f.type || ''))));
    if (!list.length) { toast('사진(jpg·png·webp)만 올릴 수 있어요', 'err'); return; }
    if (busy) { toast('지금 하던 일이 끝나기를 기다려 주세요', 'err'); return; }
    const f = collect();
    if (!f.name) {
      toast('상품명을 먼저 적어 주세요 — 카드 이름으로 씁니다', 'err');
      nameEl.focus();
      return;
    }
    fill(f);
    const room = PHOTO_MAX_COUNT - uploadedNames.length;
    if (room <= 0) { toast('사진은 한 카드에 ' + PHOTO_MAX_COUNT + '장까지입니다', 'err'); return; }
    const take = list.slice(0, room);
    const norm = normalizeProductUrl(urlEl.value);
    setBusy(true, '사진을 카드에 올리는 중…');
    try {
      const id = await ensureCard(f, norm, (m) => { orderLine.textContent = m; });
      const names = [];
      for (let i = 0; i < take.length; i++) {
        status.textContent = '사진 ' + (i + 1) + '/' + take.length + ' 올리는 중…';
        const r = await uploadPhoto({ api: api, contentId: id, file: take[i], index: uploadedNames.length + i });
        if (r && r.name) names.push(r.name);
      }
      uploadedNames = uploadedNames.concat(names);
      await saveUploadedToCard();
      paintUploads();
      status.textContent = '✅ 사진 ' + names.length + '장을 카드에 올렸어요 — [🎬 5비트 대본 만들기]로 이어가세요.';
      toast('사진 ' + names.length + '장 올림', 'ok');
      saveDraftNow();
    } catch (err) {
      showFailure(err, norm.url);
      toast('사진을 올리지 못했어요 — ' + failureReason(err).reason, 'err');
    } finally { setBusy(false); }
  }

  /** 올린 사진 이름을 카드에 남긴다 — 렌더·스튜디오가 카드만 보고 이어서 일한다. */
  async function saveUploadedToCard() {
    if (!cardId) return;
    const f = collect();
    const norm = normalizeProductUrl(urlEl.value);
    try {
      const det = await api.getContentDetail(cardId);
      const cur = (((det || {}).data || {}).payload || {}).studio || {};
      const prev = cur.product || {};
      const prod = Object.assign({}, prev, {
        name: f.name, price: f.price, original_price: f.original_price, category: f.category,
        key_points: f.key_points, track: track, brand_track: brandTrack,
        url: norm.url || prev.url || '',
        url_hash: norm.url ? urlHash(norm.url) : (prev.url_hash || ''),
        image_files: uploadedNames.slice(),
        uploaded_at: new Date().toISOString()
      });
      await api.updateContent({
        content_id: cardId, expected_version: ((det || {}).data || {}).version || null,
        patch: {
          studio: {
            place: { name: f.name || '' },
            product: prod,
            media: uploadedNames.map((name, i) => ({ name: name, kind: 'photo', role: i === 0 ? '대표' : '상세', order: i + 1, caption: '' }))
          }
        }, patch_mode: 'deep'
      });
    } catch (e) {
      toast('사진은 올라갔지만 카드에 기록하지 못했어요 — 조금 뒤 새로고침해 확인해 주세요', 'err');
    }
  }

  /* ────────────────────────── 실패 5단계 ────────────────────────── */

  function addRetry(url, reason) {
    if (!url) return;
    retryQueue = enqueueRetry(retryQueue, {
      url: url, brand: brand, brand_track: brandTrack, clip_track: track, reason: reason
    });
    saveRetryQueue(safeStorage(), retryQueue);
    paintRetry();
  }

  function paintRetry() {
    const panel = retryQueuePanel(h, retryQueue, {
      onRetry: (item) => { retryItem(item); },
      onRemove: (item) => { retryQueue = dequeueRetry(retryQueue, item.id); saveRetryQueue(safeStorage(), retryQueue); paintRetry(); },
      onRetryAll: () => { retryAll(); },
      onClear: () => { retryQueue = []; saveRetryQueue(safeStorage(), retryQueue); paintRetry(); }
    });
    retryHost.replaceChildren(...(panel ? [panel] : []));
  }

  async function retryItem(item, opts) {
    if (!item || busy) return;
    const o = opts || {};
    urlEl.value = item.url;
    brandTrack = normalizeBrandTrack(item.brand_track);
    brand = brandOfTrack(brandTrack);
    track = normalizeTrack(item.clip_track);
    selectedChannels = channelsOfTrack(brandTrack).filter((ch) => selectedChannels.indexOf(ch) >= 0);
    if (!selectedChannels.length) selectedChannels = channelsOfTrack(brandTrack);
    writeBrandTrack(safeStorage(), brandTrack);
    writeTrack(track);
    paintBrandTabs();
    paintChannels();
    paintClipTrack();
    saveDraftNow();
    await sendProductOrder(false, { retryId: item.id, noPoll: o.noPoll === true });
  }

  async function retryAll() {
    const list = retryQueue.filter((x) => x.status !== 'DONE').slice();
    if (!list.length) { toast('다시 시도할 링크가 없어요', 'err'); return; }
    if (busy) { toast('지금 하던 일이 끝나기를 기다려 주세요', 'err'); return; }
    status.textContent = '실패한 링크 ' + list.length + '건을 노트북에 다시 보냅니다…';
    /* 오더를 한 건씩 보내되, 끝날 때까지 기다리지 않는다 — 결과는 각 카드에서 확인한다. */
    for (const item of list) {
      await retryItem(item, { noPoll: true });
    }
    status.textContent = '실패한 링크 ' + list.length + '건을 다시 보냈어요 — 결과는 각 카드에서 확인하세요.';
  }

  /** ① 실패 사유 한 줄 + ②③ 대신 할 수 있는 일. 실패한 링크는 ④ 목록에 담는다. */
  function showFailure(err, url) {
    const f = failureReason(err);
    status.textContent = '⚠️ ' + f.reason;
    failureHost.replaceChildren(fallbackPanel(h, f, {
      facts: collect(),
      onUpload: () => imageInput.click(),
      onFeatures: () => { if (kpEls[0] && kpEls[0].focus) kpEls[0].focus(); if (kpEls[0] && kpEls[0].scrollIntoView) kpEls[0].scrollIntoView({ block: 'center' }); },
      onOtherLink: () => { urlEl.value = ''; if (urlEl.focus) urlEl.focus(); },
      onBasic: () => makeScript({ basic: true })
    }));
    if (f.queueable) addRetry(url || normalizeProductUrl(urlEl.value).url || '', f.reason);
    return f;
  }

  function clearFailure() {
    if (failureHost.firstChild) failureHost.replaceChildren();
  }

  /* ────────────────────────── ① GAS 1차 ────────────────────────── */

  function setBusy(on, label) {
    busy = on;
    [loadBtn, collectBtn, renderNowBtn, makeBtn].forEach((b) => { b.disabled = on; });
    if (label !== undefined) orderLine.textContent = label || '';
  }

  loadBtn.addEventListener('click', async () => {
    const norm = normalizeProductUrl(urlEl.value);
    if (norm.error) { status.textContent = '⚠️ ' + norm.error; return; }
    setBusy(true);
    status.textContent = '상품 페이지를 읽는 중…';
    /* 서버 IP 가 403/429 로 막힌 몰은 **자동으로 노트북에 넘긴다**(제미니 확정안의 3단 추출). */
    let handOff = false;
    try {
      const res = await api.post('product_fetch', { url: norm.url }, null, { timeoutMs: 20000 });
      const d = (res && res.data) || {};
      const f = normalizeFacts(d.facts || {});
      if (!f.name) throw new Error('상품명을 찾지 못했습니다');
      fill(f);
      clearFailure();
      status.textContent = '✅ 불러왔습니다 — 값이 맞는지 확인하고 [이미지까지 자동 수집]을 누르면 사진까지 받아 옵니다.';
      toast('상품 사실을 채웠습니다', 'ok');
      saveDraftNow();
    } catch (err) {
      const code = (err && err.code) || '';
      if (code === 'ERR_PRODUCT_BLOCKED') {
        handOff = true;
        status.textContent = '쇼핑몰이 서버 수집을 막았어요 — 집 노트북으로 넘겨 사진까지 받아 옵니다…';
      } else {
        showFailure(err, norm.url);
      }
    } finally { setBusy(false); }
    if (handOff) sendProductOrder(false);
  });

  /* ────────────────────────── ② 카드 확보 → product_extract 오더 → 상태 폴링 ────────────────────────── */
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
    writeCardBrand(brand);
    saveDraftNow();
    if (log) log('카드 ' + cardId + ' 를 만들었습니다');
    return cardId;
  }

  /**
   * 12시간 중복 — 기존 카드로 안내하고, 강제 재수집은 사용자가 누를 때만.
   * 서버(허브 GAS)도 같은 규칙으로 막고 ERR_PRODUCT_DUPLICATE 로 기존 카드를 알려 준다.
   */
  function showDuplicate(info, autoRender) {
    while (outHost.firstChild) outHost.removeChild(outHost.firstChild);
    const existing = String((info && info.content_id) || '') || cardId;
    const box = h('div', { class: 'panel' },
      h('h3', null, '⏳ 12시간 안에 이미 수집한 상품'),
      h('p', { class: 'st-hint', text: (info && info.message) || '같은 상품을 최근에 수집했습니다 — 새로 받지 않고 기존 카드를 씁니다.' }),
      h('p', { class: 'st-hint', text: '기존 카드: ' + (existing || '(번호 없음)') }),
      h('p', { class: 'hint', text: '사진이 바뀌었거나 앞 수집이 모자랐으면 [강제로 다시 수집]을 누르세요 — 12시간 제한을 건너뜁니다.' }));
    const row = h('div', { class: 'row' });
    if (existing) {
      const open = h('button', { class: 'btn primary', type: 'button', text: '기존 카드 열기 →' });
      open.addEventListener('click', () => {
        try { writeCardId(existing); } catch (e) { /* 무시 */ }
        location.hash = '#/create/video?card=' + encodeURIComponent(existing);
      });
      row.appendChild(open);
    }
    const forceBtn = h('button', { class: 'btn', type: 'button', text: '강제로 다시 수집' });
    forceBtn.addEventListener('click', () => sendProductOrder(autoRender, { force: true }));
    row.appendChild(forceBtn);
    box.appendChild(row);
    outHost.appendChild(box);
    status.textContent = '이미 수집한 상품입니다 — 기존 카드를 쓰거나 강제로 다시 받으세요.';
  }

  /** 오더 1회 + 15초 폴링. 끝나면 카드에서 결과를 다시 읽는다. */
  async function sendProductOrder(autoRender, opts) {
    if (busy) { toast('이미 보낸 오더가 끝나기를 기다리는 중입니다', 'err'); return; }
    const o = opts || {};
    const force = o.force === true;
    const retryId = o.retryId || '';
    const norm = normalizeProductUrl(urlEl.value);
    if (norm.error) { status.textContent = '⚠️ ' + norm.error; return; }
    /* 브라우저 기록으로 먼저 막는다(오더를 만들지 않는다) — 서버 색인이 최종 판단이다. */
    if (!force) {
      const state = dedupState(dedupRecordOf(brand, norm.url), Date.now());
      if (state.blocked) {
        if (retryId) { retryQueue = markRetry(retryQueue, retryId, { status: 'DONE', reason: '이미 만든 상품 — 기존 카드로 안내' }); saveRetryQueue(safeStorage(), retryQueue); paintRetry(); }
        showDuplicate(state, autoRender);
        return;
      }
    }
    const f = collect();
    fill(f);
    setBusy(true, '노트북에 오더를 보내는 중…');
    status.textContent = autoRender
      ? '노트북이 상품 페이지를 읽고 사진을 받아 옵니다 — 렌더는 승인 뒤에 실행됩니다.'
      : '노트북이 상품 페이지를 읽고 사진을 받아 옵니다…';
    clearFailure();
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
              product: {
                name: f.name, price: f.price, original_price: f.original_price, category: f.category,
                key_points: f.key_points, url: norm.url, track: track, brand_track: brandTrack, url_hash: urlHash(norm.url),
                requested_at: new Date().toISOString(),
                image_files: uploadedNames.slice()
              }
            }
          }, patch_mode: 'deep'
        });
      } catch (e) { /* 카드 선저장 실패는 오더를 막지 않는다 — 노트북이 직접 읽는다 */ }

      const req = productExtractRequest(f, { content_id: id, brand: brand, url: norm.url, auto_render: autoRender, seconds: 20, track: track, force: force });
      const res = await api.post('hub_order', req, null, { timeoutMs: 45000 });
      const d = (res && res.data) || {};
      const orderId = d.order_id || '';
      if (!orderId) throw new Error('오더 번호를 받지 못했습니다');
      writeDedup(brand, norm.url, id, new Date().toISOString());
      if (retryId) { retryQueue = markRetry(retryQueue, retryId, { status: 'DONE', reason: '다시 시도해 오더를 보냈어요' }); saveRetryQueue(safeStorage(), retryQueue); paintRetry(); }
      toast('오더 접수 ' + orderId, 'ok');
      orderLine.textContent = orderId + ' · 노트북이 처리 중입니다(사진 1~6장 · 5비트 대본)';
      orderLine.className = 'st-order';
      saveDraftNow();
      if (o.noPoll) { setBusy(false, orderId + ' · 노트북이 처리 중입니다'); return; }
      pollOrder(orderId, autoRender);
    } catch (err) {
      setBusy(false);
      const code = (err && err.code) || '';
      if (code === 'ERR_PRODUCT_DUPLICATE') {
        /* 서버 색인이 막았다 — 오더는 만들어지지 않았다. 기존 카드를 그대로 안내한다. */
        const det = (err && err.details) || {};
        const at = det.collected_at ? Date.parse(String(det.collected_at)) : NaN;
        const state = {
          content_id: String(det.card_id || ''), minutes_left: Number(det.minutes_left) || undefined,
          message: Number.isFinite(at) ? dedupState({ content_id: det.card_id, at: at }, Date.now()).message : (err && err.message)
        };
        writeDedup(brand, norm.url, state.content_id, Number.isFinite(at) ? new Date(at).toISOString() : new Date().toISOString());
        if (retryId) { retryQueue = markRetry(retryQueue, retryId, { status: 'DONE', reason: '이미 만든 상품 — 기존 카드로 안내' }); saveRetryQueue(safeStorage(), retryQueue); paintRetry(); }
        showDuplicate(state, autoRender);
        orderLine.textContent = '';
        return;
      }
      const f2 = showFailure(err, norm.url);
      if (retryId) { retryQueue = markRetry(retryQueue, retryId, { status: 'FAILED', reason: f2.reason, bump: true, at: new Date().toISOString() }); saveRetryQueue(safeStorage(), retryQueue); paintRetry(); }
      orderLine.textContent = '';
      toast('⚠️ ' + f2.reason, 'err');
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
          showFailure({ code: 'ERR_QUEUE_REJECTED', message: d.error || '' }, normalizeProductUrl(urlEl.value).url || '');
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
      const draftObj = (studio.formats && studio.formats.video && studio.formats.video.draft) || null;
      imageFiles = imageFilesOf(product);
      if (product && product.track) {
        const t = normalizeTrack(product.track);
        if (t !== track) { track = t; writeTrack(t); paintClipTrack(); }
      }
      if (product && product.image_files) uploadedNames = imageFiles.slice();
      if (product) {
        fill(normalizeFacts(Object.assign({}, product, { images: product.images || [] })));
      }
      paintUploads();
      paintResult(draftObj, product, imageFiles);
      saveDraftNow();
    } catch (e) {
      toast('카드 결과를 읽지 못했습니다 — 조금 뒤 새로고침해 주세요', 'err');
    }
  }

  function paintResult(draftData, prod, names) {
    while (outHost.firstChild) outHost.removeChild(outHost.firstChild);
    const gate = canRenderWith(names);
    const rules = trackRules(track);
    const head = h('div', { class: 'panel' },
      h('h3', null, '⑤ 수집 결과 — 카드 ' + (cardId || '')),
      productRow('트랙', rules.label),
      productRow('운영 트랙', trackById(brandTrack).label),
      productRow('사진', names.length ? names.length + '장 · ' + names.join(', ') : '0장'),
      productRow('상품', (prod && prod.name) || facts.name || ''),
      productRow('가격', prod && prod.price != null ? String(prod.price).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원' + (prod.discount_pct ? ' (' + prod.discount_pct + '% 할인)' : '') : '미확인'),
      h('p', { class: 'st-hint' + (gate.ok ? '' : ' err'), text: gate.ok ? '' : '⚠️ ' + gate.message }));
    outHost.appendChild(head);

    /* 대가성 문구 — 수익화 트랙은 첫 고정댓글이 공식 위치다(본문 중간·해시태그 사이 금지). */
    const cardPin = String((draftData && draftData.pinned_comment) || '');
    const pinText = cardPin || rules.pinned_comment;
    if (pinText) {
      const pinBox = h('div', { class: 'panel' }, h('h3', null, '첫 고정댓글 — 그대로 복사'));
      pinBox.appendChild(h('pre', { class: 'st-pre' }, pinText));
      if (pinText !== SC_NOTICE_CLIP) {
        pinBox.appendChild(h('p', { class: 'st-hint err', text: '⚠️ 카드에 든 문구가 공식 문장과 다릅니다 — 아래 공식 문장을 쓰세요.' }));
        pinBox.appendChild(h('pre', { class: 'st-pre' }, SC_NOTICE_CLIP));
      }
      pinBox.appendChild(copyButton(h, SC_NOTICE_CLIP, toast, '고정댓글 문구 복사'));
      pinBox.appendChild(h('p', { class: 'hint', text: '본문 첫 부분의 [광고]는 상품 태그를 붙이면 자동으로 표시됩니다(2025.12~). 안 보이면 첫 줄에 [광고]를 직접 넣으세요.' }));
      outHost.appendChild(pinBox);
    } else {
      outHost.appendChild(h('div', { class: 'panel' },
        h('h3', null, '챌린지 트랙 — 대가성 문구 없음'),
        h('p', { class: 'st-hint', text: CLIP_CHALLENGE_TAG + ' + 내용에 맞는 정보 태그 1개 이상 · 전체공개. 쇼핑커넥트 상품 태그는 붙이지 마세요(미션 인정 불가).' }),
        h('p', { class: 'hint', text: '체험·협찬으로 대가를 받았다면 본문 맨 앞에 대가 표기를 직접 써야 합니다.' })));
    }
    const descText = String((draftData && draftData.description) || '');
    const issues = trackWarnings({ track: track, text: descText, pinned: pinText });
    if (issues.length) {
      outHost.appendChild(h('div', { class: 'panel' }, h('h3', null, '트랙 검사'),
        ...issues.map((m) => h('p', { class: 'st-hint err', text: '⚠️ ' + m }))));
    }

    if (!draftData || !Array.isArray(draftData.captions) || !draftData.captions.length) {
      outHost.appendChild(h('div', { class: 'panel' }, h('p', { class: 'st-hint', text: '카드에 대본이 아직 없습니다 — [이미지까지 자동 수집]을 다시 누르거나 아래 [🎬 5비트 대본 만들기]로 기본 틀을 만드세요.' })));
    } else {
      const box = h('div', { class: 'panel' }, h('h3', null, '5비트 대본 · 자막 큐'));
      const list = h('div', { class: 'st-cues' });
      draftData.captions.slice(0, 12).forEach((c) => {
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
      if (draftData.description) box.appendChild(h('pre', { class: 'st-pre' }, draftData.description));
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
          const draftData2 = (payload.studio && payload.studio.formats && payload.studio.formats.video && payload.studio.formats.video.draft) || {};
          const body = {
            type: 'content_render', content_id: cardId, brand: brand,
            images: names.slice(0, 25), profile: 'captions', sub_style: 'auto', template: 'auto', pace: 'fast'
          };
          if (Array.isArray(draftData2.captions) && draftData2.captions.length) {
            body.captions = draftData2.captions;
            body.narration = draftData2.narration || [];
          }
          const res = await api.post('hub_order', body, null, { timeoutMs: 45000 });
          const id = (res && res.data && res.data.order_id) || '';
          toast('렌더 오더 ' + id + ' — 승인하면 실행됩니다', 'ok');
          orderLine.textContent = id + ' · 렌더 승인 대기(오더함·텔레그램에서 승인)';
        } catch (err) {
          toast('렌더 오더를 보내지 못했습니다 — ' + failureReason(err).reason, 'err');
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

  /* ────────────────────────── ③ 브라우저 대본(토큰 0) ────────────────────────── */

  /**
   * 5비트 대본 + 설명란 — 사진이 없어도 만든다(5단계 중 ③).
   * opts.basic 이면 '사진 없이 만든 기본 틀'이라고 먼저 밝힌다(렌더 조건을 숨기지 않는다).
   */
  function makeScript(opts) {
    const o = opts || {};
    const f = collect();
    if (!f.name) {
      toast('상품명을 먼저 넣어 주세요', 'err');
      if (nameEl.focus) nameEl.focus();
      return;
    }
    const gate = basicTemplateGate(f);
    fill(f);
    script = productScript(f, { seconds: 20, track: track });
    while (outHost.firstChild) outHost.removeChild(outHost.firstChild);

    if (o.basic) {
      outHost.appendChild(h('div', { class: 'panel' },
        h('h3', null, '사진 없이 만든 기본 틀'),
        h('p', { class: 'hint', text: gate.note }),
        h('p', { class: 'hint', text: '사진을 직접 올리면 렌더까지 이어갈 수 있어요 — 아래 [📷 사진 직접 올리기]를 눌러 주세요.' })));
    }

    const rules = trackRules(track);
    const beats = h('div', { class: 'panel' }, h('h3', null, '5비트 대본 (20초) · ' + rules.label));
    script.beats.forEach((b) => beats.appendChild(h('div', { class: 'gate-row' },
      h('span', { text: b.from + '~' + b.to + '초 · ' + b.beat }),
      h('span', { class: 'gv na', text: b.text }))));
    beats.appendChild(h('p', { class: 'hint', text: '훅: ' + script.hook + ' / 보조: ' + script.hook_sub }));
    outHost.appendChild(beats);

    /* 설명란 해시태그는 운영 트랙 색을 지킨다(A=대전 청년, B=삐약 김메리). */
    const desc = descriptionBlocks(f, { track: track, tags: trackTagList(brandTrack, f) });
    const descBox = h('div', { class: 'panel' }, h('h3', null, '설명란 5블록 · ' + trackById(brandTrack).short));
    descBox.appendChild(h('pre', { class: 'st-pre' }, desc.text));
    descBox.appendChild(copyButton(h, desc.text, toast, '설명란 복사'));
    outHost.appendChild(descBox);

    /* 고정댓글 문구 — 수익화 트랙의 공식 위치. 챌린지 트랙은 문구 없음(협찬이면 본문 상단 표기). */
    if (rules.pinned_comment) {
      const pinBox = h('div', { class: 'panel' }, h('h3', null, '첫 고정댓글 — 그대로 복사'),
        h('pre', { class: 'st-pre' }, rules.pinned_comment));
      pinBox.appendChild(copyButton(h, rules.pinned_comment, toast, '고정댓글 문구 복사'));
      pinBox.appendChild(h('p', { class: 'hint', text: '본문 첫 부분 [광고]는 상품 태그를 붙이면 자동 표시됩니다. 안 보이면 [광고]를 직접 넣으세요.' }));
      outHost.appendChild(pinBox);
    }

    const issues = trackWarnings({ track: track, text: desc.text, pinned: rules.pinned_comment });
    if (issues.length) {
      outHost.appendChild(h('div', { class: 'panel' }, h('h3', null, '트랙 검사'),
        ...issues.map((m) => h('p', { class: 'st-hint err', text: '⚠️ ' + m }))));
    }

    const renderGate = canRender(f);
    if (!renderGate.ok) {
      outHost.appendChild(h('div', { class: 'panel' },
        h('p', { class: 'st-hint err', text: '⚠️ ' + renderGate.message + ' — [📷 사진 직접 올리기]로 올리거나 [이미지까지 자동 수집]을 눌러 주세요.' })));
    }
    sendBtn.disabled = false;
    saveDraftNow();
  }

  makeBtn.addEventListener('click', () => makeScript({}));

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
    saveDraftNow();
    location.hash = cardId ? '#/create/video?card=' + encodeURIComponent(cardId) : '#/create/video';
    toast('상품 사실을 스튜디오에 넣었습니다 — 대본을 뽑고 사진으로 렌더하세요', 'ok');
  });

  /* ── 첫 그림 ── */
  paintBrandTabs();
  paintClipTrack();
  paintChannels();
  paintUploads();
  paintRetry();
  if (draft && !status.textContent) status.textContent = draftNotice(draft);

  /* 카드에 이미 결과가 있으면 들어오자마자 보여 준다(다시 눌러 기다리지 않게).
     단, 저장된 초안이 있으면 사용자가 적던 값을 덮어쓰지 않는다. */
  if (cardId && !draft) loadFromCard().catch(() => null);
}
