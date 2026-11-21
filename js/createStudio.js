/**
 * js/createStudio.js — '제작·생성 스튜디오' (#/create, #/create/blog|video|feed) — 2026-11-21 O1
 *
 * 확정 설계(2026-11-20, docs 없음 → downloads/콘텐츠허브_제작생성스튜디오_개편설계) §3~§9.
 *   · ＋ 만들기 하나가 스튜디오가 된다. 포맷 3개(블로그 글 · 영상 · 인스타 피드)를 해시 라우트로 가른다.
 *   · 재료는 4칸 한 벌(사진 · 장소 · 내용 · 컨셉) — 포맷을 바꿔도 유지된다(브랜드별 localStorage + 카드 payload).
 *   · 만드는 일은 두 갈래: 브라우저(토큰 0 · 즉시) / 집 노트북(content_draft · content_render 오더 1회).
 *   · 기존 화면은 지우지 않는다 — create-view.js 는 '#/create/legacy'(채널 조립기)로 남기고,
 *     영상의 6단계(produceView.js)는 영상 포맷 안에 그대로 **마운트**한다.
 *
 * 이름이 studioView.js 가 아닌 이유: js/studioView.js 는 연재 탭의 '숏폼 공방'(훅 채점·EDL·댓글 분류)이 이미
 *   쓰고 있다. 덮어쓰면 그 화면이 사라지므로 새 모듈을 createStudio.js 로 둔다(설계의 '가칭' 자리).
 *
 * 렌더링은 createElement/textContent 만(h()). 폰 360px 에서 가로 스크롤이 없어야 한다(css/studio.css).
 */

import { produceSection } from './produceView.js?v=20261121g';
import { uploadPhoto, listUploads, deleteUpload, isPhotoFile, PHOTO_MAX_COUNT } from './uploadVideo.js?v=20261121i';
import {
  FORMATS, FORMAT_IDS, TRACK_B_NOTE, formatsFor, formatLabel, CONCEPT_KINDS, TONES, VIDEO_LENGTHS, TTS_OF_TONE,
  normalizeMaterials, emptyMaterials, materialSummary, hasMaterial, factsOf, autoOrderPhotos, photoRole,
  photoPlanFor, buildBlogKit, signKit, buildFeedCards, feedCaption, hashtagsOf, buildDraftRequest,
  composeBlogWithDraft, readStudio, mergeFormat, mergeMaterialsIntoStudio, materialsFromStudio, studioMaterials,
  errorText, orderLine, titleOptions, firstPrice, FEED_CARDS
} from './studioLogic.js?v=20261121g';
import { drawCard, canvasToPng, downloadBlob, cardFileName, FILTER_PRESETS, CARD_THEME } from './studioCanvas.js?v=20261121g';
import { applyBlogRhythm, rhythmStats, lintRhythm, RHYTHM, PRESETS as TONE_PRESETS } from './blogTone.js?v=20261121g';
import { peekSeoSeed, clearSeoSeed } from './blogSeo.js?v=20261121a';
import { paintAiClip } from './aiClip.js?v=20261121a';

const LS_MAT = 'contenthub.studio.v1.';
const LS_CARD = 'contenthub.studio.card.';
const LS_RECENT = 'contenthub.studio.recent.v1';
const POLL_MS = 15000;
const POLL_MAX = 40;

const mem = {
  brand: '',
  materials: null,
  cardId: '',
  photos: {},          // id → { file, previewUrl, prepared }
  busy: {},
  poll: {},
  kit: null,
  draft: null,
  feedFilter: 'none'
};

function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 저장소가 막혀도 화면은 산다 */ } }

function copyText(h, text, toast, label) {
  const done = () => toast((label || '복사') + ' 완료', 'ok');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('복사에 실패했습니다 — 길게 눌러 선택하세요', 'err'); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
  else fallback();
}

/* ────────────────────────── 재료 저장(브랜드별) ────────────────────────── */

function loadMaterials(brand) {
  if (mem.materials && mem.brand === brand) return mem.materials;
  let raw = null;
  try { raw = JSON.parse(lsGet(LS_MAT + brand) || 'null'); } catch (e) { raw = null; }
  mem.brand = brand;
  mem.materials = normalizeMaterials(raw);
  mem.photos = {};
  // 이전 방문에서 올리지 못한 사진은 브라우저에 Blob 이 남지 않는다 — 이름만 남기고 '올리기 필요'로 표시한다.
  mem.materials.photos.forEach((p) => { if (!p.uploaded) p.needs_upload = true; });
  mem.cardId = String(lsGet(LS_CARD + brand) || '');
  return mem.materials;
}

function saveMaterials() {
  const m = mem.materials;
  if (!m) return;
  // 사진은 메타만 저장한다(Blob 은 localStorage 에 못 넣는다)
  const light = Object.assign({}, m, { photos: m.photos.map((p) => Object.assign({}, p, { needs_upload: !p.uploaded })) });
  lsSet(LS_MAT + mem.brand, JSON.stringify(light));
}

function recentList() {
  try { return JSON.parse(lsGet(LS_RECENT) || '[]') || []; } catch (e) { return []; }
}
function pushRecent(item) {
  const list = recentList().filter((x) => x && x.content_id !== item.content_id);
  list.unshift(Object.assign({ at: new Date().toISOString() }, item));
  lsSet(LS_RECENT, JSON.stringify(list.slice(0, 8)));
}

function photoCount(m) { return (m && m.photos ? m.photos : []).length; }

function pendingPhotos() {
  return (mem.materials.photos || []).filter((p) => !p.uploaded && mem.photos[p.id] && mem.photos[p.id].file);
}

/* ────────────────────────── 화면 입구 ────────────────────────── */

export function renderCreateStudio(main, ctx, opts) {
  const o = opts || {};
  const brand = ctx.state.brand;
  const want = String(o.format || '');
  const allowed = formatsFor(brand);
  const format = allowed.indexOf(want) >= 0 ? want : '';

  // 트랙 B 인데 블로그·피드 화면을 요청했다 → 영상으로 즉시 이동 + 토스트
  if (want && !format && allowed.indexOf(want) < 0) {
    ctx.toast(TRACK_B_NOTE, '');
    location.hash = '#/create/video';
    return null;
  }

  loadMaterials(brand);
  if (!format) return renderChooser(main, ctx);
  return renderFormat(main, ctx, format);
}

/* ────────────────────────── 첫 화면(포맷 선택) ────────────────────────── */

function renderChooser(main, ctx) {
  const { h } = ctx;
  const brand = ctx.state.brand;
  const allowed = formatsFor(brand);
  const m = mem.materials;

  main.appendChild(ctx.pageHead('＋ 제작 스튜디오',
    '무엇을 만들지 먼저 고르면 재료 넣는 칸이 그 포맷에 맞게 바뀝니다 · 재료는 한 번만 넣으면 됩니다'));

  const wrap = h('div', { class: 'st-formats' });
  FORMATS.filter((f) => allowed.indexOf(f.id) >= 0).forEach((f, i) => {
    wrap.appendChild(h('button', {
      class: 'st-format', type: 'button', 'data-format': f.id,
      onclick: () => { location.hash = '#/create/' + f.id; }
    },
    h('span', { class: 'st-format-no', text: String(i + 1) }),
    h('span', { class: 'st-format-emoji', text: f.emoji }),
    h('span', { class: 'st-format-main' },
      h('strong', { text: f.label }),
      h('span', { class: 'st-dim', text: f.sub })),
    h('span', { class: 'st-format-go', text: '›' })));
  });
  main.appendChild(wrap);

  if (brand === 'ppiyak_kimmary') {
    main.appendChild(h('p', { class: 'st-hint', text: '삐약 김메리(반려동물)는 영상만 씁니다 — 블로그·피드는 대전 청년에서 만드세요.' }));
  }

  const rec = recentList().filter((x) => x && x.content_id);
  const box = h('div', { class: 'panel' },
    h('h3', null, '최근 작업'),
    h('p', { class: 'st-hint', text: rec.length ? '누르면 그 포맷으로 이어서 합니다.' : '아직 없습니다. 위에서 하나를 고르면 시작합니다.' }));
  rec.slice(0, 3).forEach((r) => {
    box.appendChild(h('button', {
      class: 'st-recent', type: 'button',
      onclick: () => { location.hash = '#/create/' + (r.format || 'video') + '?card=' + encodeURIComponent(r.content_id); }
    },
    h('span', { class: 'st-recent-id', text: r.content_id }),
    h('span', { class: 'st-dim', text: (formatLabel(r.format) || '영상') + ' · ' + String(r.at || '').slice(0, 10) })));
  });
  main.appendChild(box);

  main.appendChild(h('div', { class: 'panel' },
    h('h3', null, '재료는 한 벌'),
    h('p', { class: 'st-hint', text: '사진 · 장소 · 내용 · 컨셉 네 칸에 넣은 값은 포맷을 바꿔도 그대로 남습니다(이 기기 · 이 브랜드).' }),
    h('p', { class: 'st-hint', text: '지금 재료: ' + (hasMaterial(m) ? materialSummary(m) : '아직 없음') })),
  h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', { class: 'btn sm', type: 'button', text: '예전 채널 조립기 열기', onclick: () => { location.hash = '#/create/legacy'; } })));
  return null;
}

/* ────────────────────────── 포맷 화면 ────────────────────────── */

function renderFormat(main, ctx, format) {
  const { h, api, toast } = ctx;
  const brand = ctx.state.brand;
  const m = mem.materials;
  const cardFromHash = parseCardParam();
  if (cardFromHash) mem.cardId = cardFromHash;

  const head = h('div', { class: 'st-head' },
    h('button', { class: 'ghost-btn sm', type: 'button', text: '← 포맷', onclick: () => { location.hash = '#/create'; } }),
    h('div', { class: 'st-head-t' }, h('h1', { text: formatLabel(format) + ' 만들기' }),
      h('p', { class: 'st-dim', text: mem.cardId ? '카드 ' + mem.cardId + ' 에 이어서 담습니다' : '재료만 넣으면 브라우저에서 바로, AI 는 필요할 때만' })));
  main.appendChild(head);

  /* ⓪ SEO 추천 제목에서 넘어온 경우 — 제목은 이미 정해졌고, 채울 것만 알려 준다 */
  if (format === 'blog') {
    const seed = peekSeoSeed();
    if (seed) main.appendChild(seoSeedPanel(ctx, seed, () => saveMaterials()));
  }

  /* ① 재료(접이식) */
  const summary = h('span', { class: 'st-summary', text: materialSummary(m) });
  const body = h('div', { class: 'st-mat-body' });
  const toggle = h('button', { class: 'st-mat-toggle', type: 'button', 'aria-expanded': String(!!mem.openMaterials) },
    h('span', { text: '▸ 재료' }), summary);
  const openState = { open: !!mem.openMaterials };
  const panel = h('div', { class: 'st-mat' }, toggle, body);
  toggle.addEventListener('click', () => {
    openState.open = !openState.open;
    mem.openMaterials = openState.open;
    body.hidden = !openState.open;
    toggle.setAttribute('aria-expanded', String(openState.open));
    toggle.firstChild.textContent = openState.open ? '▾ 재료' : '▸ 재료';
  });
  body.hidden = !openState.open;
  main.appendChild(panel);

  paintMaterials(body, ctx, format, () => { summary.textContent = materialSummary(m); saveMaterials(); });

  /* ② 만들기 · 결과 */
  const out = h('div', { class: 'st-out' });
  const actions = h('div', { class: 'panel st-actions' }, h('h3', null, '만들기'));
  main.appendChild(actions);
  main.appendChild(out);

  const ui = { out: out, actions: actions, refreshSummary: () => { summary.textContent = materialSummary(m); } };

  if (format === 'blog') paintBlog(actions, out, ctx, ui);
  else if (format === 'feed') paintFeed(actions, out, ctx, ui);
  else paintVideo(actions, out, ctx, ui);

  /* 카드 줄 — 공통 */
  actions.appendChild(cardRow(ctx, format, ui));
  return null;
}

/* ────────────────────────── SEO 추천 제목에서 넘어옴 ────────────────────────── */

/** 오늘의 추천 제목에서 넘어왔을 때 그 제목 — 없으면 빈 값(3안을 새로 만든다). */
function seoTitleOf() {
  const seed = peekSeoSeed();
  return seed ? seed.title : '';
}

/** 제목을 그대로 쓰고, 메모 칸에 축별 뼈대를 넣어 준다(내가 쓴 메모는 건드리지 않는다). */
function seoSeedPanel(ctx, seed, onFill) {
  const { h, toast } = ctx;
  const m = mem.materials;
  const hasMemo = !!String(m.content.memo || '').trim();

  const fill = h('button', {
    class: 'btn xs', type: 'button',
    text: hasMemo ? '뼈대 덧붙이기' : '메모 뼈대 넣기',
    title: '지금 메모에 5줄 질문을 넣습니다 — 답만 적으면 2줄 호흡 초안이 나와요',
    onclick: () => {
      const sk = String(seed.skeleton || '').trim();
      if (!sk) { toast('이 축에는 뼈대가 없습니다', 'err'); return; }
      m.content.memo = hasMemo ? (String(m.content.memo).replace(/\s+$/, '') + '\n\n' + sk) : sk;
      if (m.concept && seed.axis === 'food') m.concept.kind = 'review';
      if (m.concept && seed.axis === 'life') m.concept.kind = 'info';
      if (m.concept && seed.axis === 'store') m.concept.kind = 'info';
      onFill();
      toast('메모에 뼈대를 넣었습니다 — 내 말로 고쳐 쓰면 됩니다', 'ok');
      ctx.renderRoute();
    }
  });

  const close = h('button', {
    class: 'btn xs ghost', type: 'button', text: '추천 접기',
    onclick: () => { clearSeoSeed(); ctx.renderRoute(); }
  });

  return h('div', { class: 'panel st-seed' },
    h('h3', null, '오늘의 추천 제목에서 시작', h('span', { class: 'tag', text: seed.axis_label || '추천' })),
    h('p', { class: 'st-seed-title', text: seed.title }),
    h('p', { class: 'st-hint',
      text: '이 제목이 [바로 만들기]의 1안이 됩니다'
        + (seed.keyword ? ' · 검색어 ' + seed.keyword : '')
        + (seed.day ? ' · ' + seed.day.slice(5).replace('-', '/') + ' 추천' : '') }),
    h('p', { class: 'st-hint', text: '본문은 내가 쓴 메모만 씁니다. 제목만으로 본문을 지어내지 않습니다 — 사진·메모를 넣어야 초안이 나와요.' }),
    h('div', { class: 'row', style: 'margin-top:8px;gap:6px;flex-wrap:wrap' }, fill, close));
}

function parseCardParam() {
  const hash = String(location.hash || '');
  const m = hash.match(/[?&]card=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/* ────────────────────────── 재료 4칸 ────────────────────────── */

function paintMaterials(host, ctx, format, onDirty) {
  const { h, toast } = ctx;
  const m = mem.materials;

  const sec = (n, title, hint) => h('div', { class: 'st-sec' },
    h('div', { class: 'st-sec-h' }, h('span', { class: 'st-sec-no', text: n }), h('strong', { text: title }),
      hint ? h('span', { class: 'st-dim', text: hint }) : null));

  /* ① 사진 */
  const photoGrid = h('div', { class: 'st-photos' });
  const photoNote = h('p', { class: 'st-hint', text: '' });
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, style: 'display:none' });
  const addBtn = h('button', { class: 'btn sm', type: 'button', text: '＋ 사진 올리기' });
  addBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    addFiles(files);
  });

  function addFiles(files) {
    const room = PHOTO_MAX_COUNT - m.photos.length;
    if (room <= 0) { toast('사진은 한 카드에 ' + PHOTO_MAX_COUNT + '장까지입니다', 'err'); return; }
    const take = files.slice(0, room);
    if (files.length > room) toast('사진 ' + PHOTO_MAX_COUNT + '장까지만 담았습니다', 'err');
    take.forEach((file) => {
      if (!isPhotoFile(file.name) && !/^image\//.test(String(file.type || ''))) { toast('사진(jpg·png·webp)만 올릴 수 있습니다: ' + file.name.slice(0, 30), 'err'); return; }
      const id = 'ph' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const previewUrl = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(file) : '';
      mem.photos[id] = { file: file, previewUrl: previewUrl, prepared: null };
      m.photos.push({ id: id, name: file.name, role: photoRole(file.name), caption: '', order: m.photos.length + 1, uploaded: false, bytes: file.size });
    });
    paintGrid();
    onDirty();
  }

  function paintGrid() {
    const ordered = autoOrderPhotos(m.photos);
    m.photos = ordered.map((p) => Object.assign({}, p, { id: p.id || '' }));
    photoGrid.replaceChildren();
    if (!ordered.length) {
      photoGrid.appendChild(h('p', { class: 'st-hint', text: '아직 사진이 없습니다. 여러 장 한 번에 고르면 외관→메뉴판→음식→분위기→마무리 순으로 자동으로 줄 세웁니다.' }));
    }
    ordered.forEach((p, i) => {
      const bank = mem.photos[p.id];
      const thumb = h('div', { class: 'st-ph' },
        bank && bank.previewUrl
          ? h('img', { class: 'st-ph-img', src: bank.previewUrl, alt: p.name })
          : h('div', { class: 'st-ph-img st-ph-none', text: p.uploaded ? '☁' : '?' }),
        h('span', { class: 'st-ph-no', text: String(i + 1) }),
        h('span', { class: 'st-ph-role', text: p.role || photoRole(p.name) }),
        h('div', { class: 'st-ph-ops' },
          h('button', { class: 'st-op', type: 'button', title: '앞으로', text: '‹', onclick: () => movePhoto(i, -1) }),
          h('button', { class: 'st-op', type: 'button', title: '뒤로', text: '›', onclick: () => movePhoto(i, 1) }),
          h('button', { class: 'st-op danger', type: 'button', title: '빼기', text: '×', onclick: () => removePhoto(p) })));
      photoGrid.appendChild(thumb);
    });
    const plan = photoPlanFor(format, { photos: m.photos, lengthSec: m.video.length_sec });
    const bits = [];
    bits.push('사진 ' + m.photos.length + '장');
    if (format === 'video') bits.push('이 길이에 ' + plan.target + '장 · ' + (plan.enough ? '충분' : plan.missing + '장 더 필요'));
    if (format === 'blog') bits.push('블로그는 18~22장이 좋습니다');
    if (format === 'feed') bits.push('카드 ' + FEED_CARDS + '장');
    bits.push('순서는 자동 — 직접 만진 순서는 ‹ › 로 조정');
    photoNote.textContent = bits.join(' · ');
  }

  function movePhoto(i, d) {
    const list = m.photos.slice();
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const a = list[i]; list[i] = list[j]; list[j] = a;
    list.forEach((p, n) => { p.order = n + 1; p.manual = true; });
    m.photos = list;
    paintGrid(); onDirty();
  }
  function removePhoto(p) {
    m.photos = m.photos.filter((x) => x.id !== p.id);
    const bank = mem.photos[p.id];
    if (bank && bank.previewUrl) { try { URL.revokeObjectURL(bank.previewUrl); } catch (e) { /* 무시 */ } }
    delete mem.photos[p.id];
    if (p.uploaded && mem.cardId) {
      // 드라이브에서도 지운다(사진은 비공개 폴더라 여기 남기면 렌더 목록에 계속 잡힌다)
      deleteUpload(ctx.api, mem.cardId, p.name).catch(() => {});
    }
    paintGrid(); onDirty();
  }

  host.appendChild(sec('①', '사진', '여러 장 한 번에 · 올리기 전 2048px·JPEG 로 줄여 올립니다'));
  host.appendChild(h('div', { class: 'row' }, addBtn, fileInput));
  host.appendChild(photoGrid);
  host.appendChild(photoNote);
  paintGrid();

  /* ② 장소 */
  const place = m.place;
  const pField = (key, label, ph, type) => {
    const el = h('input', { class: 'input', type: type || 'text', placeholder: ph || '', value: place[key] || '', autocomplete: 'off' });
    el.addEventListener('input', () => { place[key] = el.value; onDirty(); });
    return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), el);
  };
  host.appendChild(sec('②', '장소', '링크는 저장만 합니다 — 크롤링으로 값을 채우지 않습니다'));
  host.appendChild(pField('name', '가게 이름 · 주제 *', '예: 미미삼겹 유성점'));
  host.appendChild(h('div', { class: 'st-two' },
    pField('naver_url', '네이버 지도 링크', 'https://map.naver.com/…', 'url'),
    pField('kakao_url', '카카오맵 링크', 'https://map.kakao.com/…', 'url')));

  /* ③ 내용 */
  const c = m.content;
  const memo = h('textarea', { class: 'textarea', rows: '8', placeholder: '다녀온 이야기를 그대로 붙여넣으세요. 두 줄씩 끊은 호흡도 그대로 살립니다(이 문단은 AI 가 고치지 않습니다).' });
  memo.value = c.memo || '';
  memo.addEventListener('input', () => { c.memo = memo.value; onDirty(); });
  const cField = (key, label, ph) => {
    const el = h('input', { class: 'input', placeholder: ph || '', value: c[key] || '', autocomplete: 'off' });
    el.addEventListener('input', () => { c[key] = el.value; onDirty(); });
    return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), el);
  };
  host.appendChild(sec('③', '내용', '모르는 값은 비워 두세요 — [채우기]로 남깁니다'));
  host.appendChild(h('label', { class: 'field' },
    h('span', { class: 'field-label', text: '방문 메모(원문) — 한 글자도 바꾸지 않습니다' }), memo));
  host.appendChild(h('div', { class: 'st-two' }, cField('region_dong', '동네', '봉명동'), cField('category', '종류', '한식 · 고기')));
  host.appendChild(h('div', { class: 'st-two' }, cField('hours', '영업시간', '16:00~23:30'), cField('closed_days', '휴무', '매주 일요일')));
  host.appendChild(h('div', { class: 'st-two' }, cField('price_menu', '대표메뉴·가격', '삼겹 16,000원'), cField('wait_time', '대기', '평일 18:40 기준 15분')));
  host.appendChild(h('div', { class: 'st-two' }, cField('parking', '주차', '공영 1시간 1,200원'), cField('tel', '전화', '0507-…')));
  host.appendChild(cField('address', '주소', '대전 유성구 …'));

  /* ④ 컨셉 */
  host.appendChild(sec('④', '컨셉', '한 줄이 AI 에게 주는 유일한 지시입니다'));
  const kindRow = h('div', { class: 'st-chips' });
  CONCEPT_KINDS.forEach((k) => {
    const b = h('button', { class: 'st-chip' + (m.concept.kind === k.id ? ' on' : ''), type: 'button', text: k.label });
    b.addEventListener('click', () => {
      m.concept.kind = k.id; onDirty();
      kindRow.querySelectorAll('.st-chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
    kindRow.appendChild(b);
  });
  const toneRow = h('div', { class: 'st-chips' });
  TONES.forEach((t) => {
    const b = h('button', { class: 'st-chip' + (m.concept.tone === t.id ? ' on' : ''), type: 'button', text: t.label });
    b.addEventListener('click', () => {
      m.concept.tone = t.id; onDirty();
      toneRow.querySelectorAll('.st-chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
    toneRow.appendChild(b);
  });
  const hint = h('input', { class: 'input', placeholder: '예: 웃긴데 정보는 정확하게', value: m.concept.hint || '', autocomplete: 'off' });
  hint.addEventListener('input', () => { m.concept.hint = hint.value; onDirty(); });
  host.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '유형' }), kindRow));
  host.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '톤' }), toneRow));
  host.appendChild(h('p', { class: 'st-hint', text: '톤 → 목소리: 담백 rate +6% · 호들갑 rate +18%/pitch +6Hz/vol +10% · 충청도 아저씨 rate −4%/pitch −3Hz' }));
  host.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '한 줄 지시' }), hint));

  if (format === 'video') {
    const lenRow = h('div', { class: 'st-chips' });
    VIDEO_LENGTHS.forEach((sec2) => {
      const b = h('button', { class: 'st-chip' + (m.video.length_sec === sec2 ? ' on' : ''), type: 'button', text: sec2 + '초' });
      b.addEventListener('click', () => {
        m.video.length_sec = sec2; onDirty();
        lenRow.querySelectorAll('.st-chip').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        paintGrid();
      });
      lenRow.appendChild(b);
    });
    host.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '길이' }), lenRow));
  }
}

/* ────────────────────────── 카드 연결 줄 ────────────────────────── */

function cardRow(ctx, format, ui) {
  const { h, toast, api } = ctx;
  const line = h('p', { class: 'st-hint', text: '' });
  const btn = h('button', { class: 'btn primary', type: 'button', text: '💾 보드에 카드로 저장' });
  const open = h('button', { class: 'ghost-btn sm', type: 'button', text: '카드 상세 열기' });
  open.addEventListener('click', () => { if (mem.cardId) ctx.openDetail(mem.cardId, 'produce'); else toast('먼저 카드로 저장하세요', 'err'); });

  const refresh = () => {
    line.textContent = mem.cardId
      ? '이 작업은 카드 ' + mem.cardId + ' 에 담깁니다 — 사진은 이 카드의 드라이브 폴더에 올라갑니다.'
      : '카드를 만들면 사진·재료가 서버에 남고, 노트북 오더(대본·렌더)를 보낼 수 있습니다.';
    open.disabled = !mem.cardId;
  };
  refresh();
  ui.refreshCard = refresh;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '저장 중…';
    try {
      const id = await ensureCard(ctx, format, ui);
      toast('카드 ' + id + ' 에 담았습니다', 'ok');
      refresh();
    } catch (err) {
      toast(errorText(err && err.code) + (err && err.message ? ' — ' + err.message : ''), 'err');
    } finally { btn.disabled = false; btn.textContent = label; }
  });

  return h('div', { class: 'st-cardline' },
    h('div', { class: 'row' }, btn, open),
    line);
}

/**
 * 카드 확보 → 사진 올리기 → 재료를 payload.studio 에 저장.
 *  · 카드가 없으면 create_content 로 하나 만든다(시트 칸은 늘리지 않는다 — 재료는 payload 로만).
 *  · 저장은 언제나 studio.formats.<format> 안으로. 다른 포맷·구 루트 키는 건드리지 않는다.
 */
async function ensureCard(ctx, format, ui) {
  const { api } = ctx;
  const m = mem.materials;
  if (!m.place.name.trim() && !m.content.memo.trim() && !m.photos.length) {
    const e = new Error('가게 이름이나 메모, 사진 중 하나는 있어야 합니다'); e.code = 'ERR_VALIDATION_FAILED'; throw e;
  }
  if (!mem.cardId) {
    const res = await api.createContent({
      brand: ctx.state.brand,
      place_name: m.place.name.trim() || ('제작 스튜디오 ' + new Date().toISOString().slice(0, 10)),
      region_dong: m.content.region_dong.trim(),
      category: m.content.category.trim(),
      cluster_id: '제작 스튜디오',
      target_keywords: '',
      naver_place_url: m.place.naver_url.trim(),
      media_drive_url: '',
      receipt_verified: false,
      allow_partial_shortform: false
    });
    mem.cardId = (res && res.data && res.data.content_id) || '';
    if (!mem.cardId) { const e = new Error('카드 번호를 받지 못했습니다'); e.code = 'ERR_BAD_RESPONSE'; throw e; }
    lsSet(LS_CARD + mem.brand, mem.cardId);
    if (ui && ui.refreshCard) ui.refreshCard();
  }
  await uploadPendingPhotos(ctx);
  await saveMaterialsToStudio(ctx, format);
  pushRecent({ content_id: mem.cardId, format: format });
  saveMaterials();
  return mem.cardId;
}

/** 아직 안 올라간 사진을 이 카드 폴더로 올린다(장당 1조각 · 실패하면 그 사진만 남긴다). */
async function uploadPendingPhotos(ctx) {
  const { toast, api } = ctx;
  const list = pendingPhotos();
  for (const p of list) {
    const bank = mem.photos[p.id];
    if (!bank || !bank.file) continue;
    try {
      const r = await uploadPhoto({
        api: api, contentId: mem.cardId, file: bank.file, index: p.order ? p.order - 1 : 0,
        prepared: bank.prepared
      });
      p.uploaded = true;
      p.name = r.name;
      p.bytes = r.bytes;
      p.width = r.width;
      p.height = r.height;
      p.needs_upload = false;
      delete bank.file;   // 올린 파일은 메모리에서 놓는다(미리보기 URL 만 유지)
    } catch (err) {
      toast('사진 ' + p.name.slice(0, 20) + ' 을(를) 올리지 못했습니다: ' + errorText(err && err.code), 'err');
    }
  }
  saveMaterials();
}

/** 재료 + 포맷 상태를 카드 payload 에 쓴다. 버전 충돌은 최신본을 다시 읽어 병합한다. */
async function saveMaterialsToStudio(ctx, format, extra) {
  const { api } = ctx;
  const m = mem.materials;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await api.getContentDetail(mem.cardId);
    const d = (res && res.data) || {};
    const base = (d.payload && d.payload.studio) || {};
    let next = mergeMaterialsIntoStudio(base, m);
    next = mergeFormat(next, format, Object.assign({
      length_sec: m.video.length_sec,
      concept: m.concept,
      updated_at: new Date().toISOString()
    }, extra || {}));
    try {
      const out = await api.updateContent({ content_id: mem.cardId, expected_version: d.version, patch: { studio: next } });
      return out;
    } catch (err) {
      if (!err || err.code !== 'ERR_VERSION_CONFLICT' || attempt === 2) throw err;
      ctx.toast(errorText('ERR_VERSION_CONFLICT'), '');
    }
  }
  return null;
}

/* ────────────────────────── 오더 보내기·지켜보기 ────────────────────────── */

/** content_draft · content_render 오더 1회. 같은 화면에서 두 번 눌리지 않게 잠근다. */
async function sendOrder(ctx, key, payload, btn, onDone) {
  const { api, toast } = ctx;
  if (mem.busy[key]) { toast('이미 보낸 오더가 끝나기를 기다리는 중입니다', 'err'); return; }
  mem.busy[key] = true;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '오더 보내는 중…';
  try {
    const res = await api.post('hub_order', payload, null, { timeoutMs: 45000 });
    const d = (res && res.data) || {};
    const orderId = d.order_id || '';
    if (!orderId) throw new Error('오더 번호를 받지 못했습니다');
    toast('오더 접수 ' + orderId, 'ok');
    btn.textContent = '오더 접수 — 결과 기다리는 중';
    const line = h('p', { class: 'st-order', text: orderLine(d.status || 'PENDING').text });
    (mem.outHost || document.body).appendChild(line);
    pollOrder(ctx, orderId, line, () => {
      btn.disabled = false;
      btn.textContent = label;
      onDone && onDone();
    });
  } catch (err) {
    btn.disabled = false;
    btn.textContent = label;
    mem.busy[key] = false;
    const code = (err && err.code) || '';
    const msg = code === 'ERR_QUEUE_TYPE_UNKNOWN'
      ? '⚠️ 노트북 큐가 아직 이 오더 타입을 모릅니다 — 큐 재배포 뒤 다시 보내 주세요'
      : errorText(code) + (err && err.message ? ' — ' + String(err.message).slice(0, 120) : '');
    toast(msg, 'err');
  }
}

/** hub_order_status 15초 폴링 — 종료 상태·화면 이탈·탭 숨김이면 멈춘다. */
function pollOrder(ctx, orderId, line, onFinish) {
  const { api, toast } = ctx;
  let fails = 0;
  const tick = async () => {
    if (!line.isConnected) { mem.busy = {}; return; }
    if (typeof document !== 'undefined' && document.hidden) { setTimeout(tick, POLL_MS); return; }
    try {
      const d = await api.hubOrderStatus(orderId);
      fails = 0;
      const view = orderLine(d.status, d.result ? String(d.result).split('\n')[0].slice(0, 80) : '');
      line.textContent = orderId + ' · ' + view.text;
      line.className = 'st-order ' + (view.kind || '');
      if (view.done) {
        mem.busy = {};
        if (view.kind === 'ok') toast('오더가 끝났습니다 — 결과를 불러옵니다', 'ok');
        else toast(view.text, view.kind === 'err' ? 'err' : '');
        if (onFinish) onFinish(d);
        return;
      }
    } catch (err) {
      fails++;
      if (fails >= 3) {
        line.textContent = orderId + ' · 상태를 가져오지 못했습니다 — [관리] 탭에서 연결을 확인하세요';
        line.className = 'st-order err';
        mem.busy = {};
        if (onFinish) onFinish(null);
        return;
      }
    }
    setTimeout(tick, POLL_MS);
  };
  setTimeout(tick, 2500);
}

/* ────────────────────────── 블로그 ────────────────────────── */

function paintBlog(actions, out, ctx, ui) {
  const { h, toast, api } = ctx;
  const m = mem.materials;

  const free = h('button', { class: 'btn primary', type: 'button', text: '⚡ 바로 만들기 (무료 · 즉시)' });
  const ai = h('button', { class: 'btn', type: 'button', text: '🤖 AI 초안 생성 (노트북 1회)' });
  actions.appendChild(h('div', { class: 'row' }, free, ai));
  actions.appendChild(h('p', { class: 'st-hint', text: '바로 만들기는 내 메모와 사진만 배치합니다(토큰 0). AI 초안은 제목 3안·문단 사이 연결·빈 캡션·마무리만 씁니다 — 내 문단은 그대로 남습니다.' }));

  free.addEventListener('click', async () => {
    free.disabled = true;
    try {
      const kit = await signKit(buildBlogKit({ materials: m, links: m.links || [], title: seoTitleOf() }));
      mem.kit = kit;
      ui.out.replaceChildren();
      paintKit(out, ctx, kit, ui);
      if (mem.cardId) {
        await saveMaterialsToStudio(ctx, 'blog', { kit: { titles: kit.titles, captions: kit.captions, photo_plan: kit.photo_plan, outro: kit.outro } })
          .catch(() => {});
      }
      toast('붙여넣기 키트를 만들었습니다', 'ok');
    } catch (err) {
      toast('만들지 못했습니다 — ' + ((err && err.message) || err), 'err');
    } finally { free.disabled = false; }
  });

  ai.addEventListener('click', async () => {
    ai.disabled = true;
    const label = ai.textContent;
    try {
      const id = await ensureCard(ctx, 'blog', ui);
      const req = await buildDraftRequest({ contentId: id, brand: ctx.state.brand, format: 'blog', materials: m });
      mem.outHost = out;
      await sendOrder(ctx, 'draft-blog', req, ai, async () => {
        try {
          const res = await api.getContentDetail(id);
          const doc = (res && res.data && res.data.payload) || {};
          const st = readStudio(doc);
          const draft = (st.formats.blog && (st.formats.blog.draft || st.formats.blog.ai)) || null;
          if (!draft) { toast('카드에 초안이 아직 없습니다 — 잠시 뒤 [결과 새로고침]을 눌러 주세요', 'err'); return; }
          mem.draft = draft;
          const kit = await signKit(buildBlogKit({ materials: m, links: m.links || [], title: seoTitleOf() }));
          mem.kit = kit;
          paintKit(out, ctx, kit, ui, draft);
          toast('AI 초안을 카드에서 가져왔습니다', 'ok');
        } catch (err) {
          toast('결과를 가져오지 못했습니다 — ' + ((err && err.message) || err), 'err');
        }
      });
    } catch (err) {
      toast(errorText(err && err.code) + (err && err.message ? ' — ' + err.message : ''), 'err');
    } finally {
      ai.disabled = false;
      ai.textContent = label;
    }
  });

  if (mem.kit) paintKit(out, ctx, mem.kit, ui, mem.draft);
  else {
    out.replaceChildren(h('div', { class: 'panel' },
      h('h3', null, '결과'),
      h('p', { class: 'st-hint', text: '위에서 [바로 만들기]를 누르면 제목 3안 · 사진 위치 · 붙여넣기 키트가 여기에 나옵니다.' })));
  }
}

function paintKit(out, ctx, kit, ui, draft) {
  const { h } = ctx;
  const composed = draft ? composeBlogWithDraft(kit, draft) : null;
  const box = h('div', { class: 'panel' },
    h('h3', null, '제목 후보 3안'));
  (composed ? composed.titles : kit.titles).forEach((t, i) => {
    box.appendChild(h('div', { class: 'st-title-row' },
      h('strong', { text: t }),
      copyTextBtn(h, t, ctx.toast, '제목')));
  });
  if (draft && composed && !composed.verified.ok) {
    box.appendChild(h('p', { class: 'st-hint err', text: composed.verified.note }));
  }

  const text = composed ? composed.text : kit.text;
  const pre = h('pre', { class: 'st-pre' }, text);
  box.appendChild(h('h3', { text: '붙여넣기 키트' }));
  box.appendChild(h('p', { class: 'st-hint', text: '원문 ' + kit.blocks.length + '문단 · 사진 ' + kit.photo_plan.length + '장 · 해시 ' + (kit.user_body_sha256 || '').slice(0, 8) }));
  box.appendChild(pre);
  box.appendChild(h('div', { class: 'row' },
    copyTextBtn(h, text, ctx.toast, '키트 복사'),
    downloadBtn(h, '블로그키트.md', text, ctx.toast)));

  /* ── 톤 · 2줄 호흡 (제미니 확정안 A, 2026-11-21) ── */
  const bodyText = (kit.blocks || []).map((b) => b.text).join('\n\n');
  const rh = kit.rhythm || { stats: rhythmStats(bodyText), issues: lintRhythm(bodyText) };
  const rhBox = h('div', null);
  box.appendChild(h('h3', { text: '톤 · 2줄 호흡' }));
  box.appendChild(h('p', { class: 'st-hint', text: '문단 하나 = 모바일 2줄(' + RHYTHM.blockMin + '~' + RHYTHM.blockTargetHi + '자, 상한 ' + RHYTHM.blockMax + '자) · 1줄 문단 ' + Math.round(RHYTHM.oneLineRatio * 100) + '% 이내' }));
  box.appendChild(h('p', {
    class: 'st-hint' + (rh.issues.length ? ' err' : ''),
    text: rh.issues.length
      ? '⚠ ' + rh.issues.map((x) => x.text).join(' · ')
      : '✓ 문단 ' + rh.stats.blocks + '개 · 평균 ' + rh.stats.avg + '자 · 1줄 ' + Math.round(rh.stats.oneLineRatio * 100) + '% · 3줄 초과 0개'
  }));
  const presetRow = h('div', { class: 'st-chips' });
  TONE_PRESETS.forEach((p) => {
    const b = h('button', { class: 'st-chip', type: 'button', text: p.label, title: p.rule });
    b.addEventListener('click', () => {
      presetRow.querySelectorAll('.st-chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      ctx.toast(p.label + ' — ' + p.rule, '');
    });
    presetRow.appendChild(b);
  });
  box.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '톤' }), presetRow));
  const fix = h('button', { class: 'btn', type: 'button', text: '🎯 2줄 호흡으로 정리 (무료)' });
  fix.addEventListener('click', () => {
    const r = applyBlogRhythm(bodyText);
    rhBox.replaceChildren(
      h('p', { class: 'st-hint', text: '정리 후 — 문단 ' + r.stats.blocks + '개 · 평균 ' + r.stats.avg + '자 · 1줄 ' + Math.round(r.stats.oneLineRatio * 100) + '% · 3줄 초과 ' + r.stats.overMax + '개' }),
      h('pre', { class: 'st-pre' }, r.text),
      h('div', { class: 'row' }, copyTextBtn(h, r.text, ctx.toast, '본문 복사'), downloadBtn(h, '본문_2줄호흡.md', r.text, ctx.toast)),
      h('p', { class: 'st-hint', text: '⚠ 이 정리는 내가 쓴 문단까지 줄을 다시 나눕니다. 원문 해시는 위 키트 값 그대로이고, 마음에 안 들면 복사하지 않으면 됩니다.' })
    );
    ctx.toast('2줄 호흡으로 정리했습니다 — 복사해서 네이버에 붙이세요', 'ok');
  });
  box.appendChild(h('div', { class: 'row' }, fix));
  box.appendChild(rhBox);

  box.appendChild(h('h3', { text: '네이버에 붙이는 순서' }));
  box.appendChild(h('ol', { class: 'st-steps' }, kit.paste_steps.map((s) => h('li', { text: s }))));
  out.replaceChildren(box);
}

function copyTextBtn(h, text, toast, label) {
  return h('button', { class: 'ghost-btn sm', type: 'button', text: '⧉ ' + (label || '복사'), onclick: () => copyText(h, text, toast, label) });
}

function downloadBtn(h, filename, text, toast) {
  return h('button', {
    class: 'ghost-btn sm', type: 'button', text: '⬇ 내려받기',
    onclick: () => {
      try {
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        if (downloadBlob(blob, filename)) toast('내려받았습니다 — ' + filename, 'ok');
        else toast('내려받기에 실패했습니다', 'err');
      } catch (e) { toast('내려받기에 실패했습니다', 'err'); }
    }
  });
}

/* ────────────────────────── 영상 ────────────────────────── */

function paintVideo(actions, out, ctx, ui) {
  const { h, toast, api } = ctx;
  const m = mem.materials;
  const plan = photoPlanFor('video', { photos: m.photos, lengthSec: m.video.length_sec });

  const scriptBtn = h('button', { class: 'btn', type: 'button', text: '🤖 대본·자막·내레이션 만들기' });
  const renderBtn = h('button', { class: 'btn primary', type: 'button', text: '🎬 사진으로 완제품 렌더 (노트북)' });
  const stepsBtn = h('button', { class: 'btn sm', type: 'button', text: '영상 편집 단계(제작 스텝퍼) 열기' });

  actions.appendChild(h('div', { class: 'row' }, scriptBtn, renderBtn));
  actions.appendChild(h('div', { class: 'st-hint' },
    h('span', { text: '이 길이에 사진 ' + plan.target + '장 · 지금 ' + plan.count + '장 — ' + (plan.enough ? (plan.meets_target ? '충분합니다' : plan.missing + '장 더 있으면 더 좋습니다') : ('최소 ' + plan.min + '장이 필요합니다(' + (plan.min - plan.count) + '장 더)')) }),
    h('span', { text: ' · 렌더는 1080×1920 30fps, 켄번즈(장당 3.0초 이상·자막 길이에 맞춰 늘어남), 자막 번인+내레이션 포함입니다.' })));
  actions.appendChild(h('p', { class: 'st-hint', text: '영상이 이미 있으면 아래 [영상 편집 단계]에서 올리고 컷·자막·마무리를 하세요. 그 화면(제작 스텝퍼)은 그대로 살아 있습니다.' }));

  const stepsHost = h('div', { class: 'st-steps-host' });
  stepsHost.hidden = true;
  stepsBtn.addEventListener('click', async () => {
    stepsHost.hidden = !stepsHost.hidden;
    if (!stepsHost.hidden && !stepsHost.firstChild) {
      if (!mem.cardId) { toast('먼저 카드로 저장하면 영상 편집 단계가 열립니다', 'err'); return; }
      await mountProduce(stepsHost, ctx);
    }
  });
  actions.appendChild(stepsBtn);
  actions.appendChild(stepsHost);

  /* AI 클립(무료) — 구글 Flow·허깅페이스 프롬프트 빌더. 새 파일 js/aiClip.js 만 쓰고 style.css 는 건드리지 않는다. */
  paintAiClip(actions, ctx);

  /* 대본·자막·내레이션(content_draft format:'video') */
  scriptBtn.addEventListener('click', async () => {
    scriptBtn.disabled = true;
    try {
      const id = await ensureCard(ctx, 'video', ui);
      const req = await buildDraftRequest({ contentId: id, brand: ctx.state.brand, format: 'video', materials: m });
      mem.outHost = out;
      await sendOrder(ctx, 'draft-video', req, scriptBtn, async () => {
        try {
          const res = await api.getContentDetail(id);
          const payload = (res && res.data && res.data.payload) || {};
          const draft = (readStudio(payload).formats.video || {}).draft || null;
          if (!draft) { toast('카드에 대본이 아직 없습니다', 'err'); return; }
          // ④ 완제품 오더가 자막을 굽도록 production 에 넣는다(USER 대본은 그대로)
          const production = Object.assign({}, payload.production || {}, {
            captions: draft.captions || [], narration: draft.narration || [], script: draft.script || null,
            from: 'studio-draft', updated_at: new Date().toISOString()
          });
          await api.updateContent({ content_id: id, expected_version: res.data.version, patch: { production: production }, patch_mode: 'deep' }).catch(() => {});
          mem.draft = draft;
          paintScriptBox(out, ctx, draft, m);
          toast('대본·자막을 카드에 담았습니다', 'ok');
        } catch (err) {
          toast('결과를 가져오지 못했습니다 — ' + ((err && err.message) || err), 'err');
        }
      });
    } catch (err) {
      toast(errorText(err && err.code) + (err && err.message ? ' — ' + err.message : ''), 'err');
    } finally { scriptBtn.disabled = false; }
  });

  /* 사진만으로 완제품(content_render images[]) */
  renderBtn.addEventListener('click', async () => {
    if (!plan.enough) { toast('사진이 ' + plan.missing + '장 모자랍니다(최소 ' + plan.min + '장)', 'err'); return; }
    renderBtn.disabled = true;
    try {
      const id = await ensureCard(ctx, 'video', ui);
      const names = (mem.materials.photos || []).filter((p) => p.uploaded).map((p) => p.name);
      if (!names.length) throw new Error('올라간 사진이 없습니다');
      const draft = mem.draft || null;
      const payload = {
        type: 'content_render',
        content_id: id,
        brand: ctx.state.brand,
        images: names.slice(0, 25),
        profile: 'captions',
        sub_style: 'auto',
        template: 'auto',
      };
      if (draft && Array.isArray(draft.captions) && draft.captions.length) {
        payload.captions = draft.captions;
        payload.narration = draft.narration || [];
        payload.narrate = !!(draft.narration && draft.narration.length);
      }
      mem.outHost = out;
      await sendOrder(ctx, 'render-video', payload, renderBtn, async () => {
        try {
          const asset = await api.post('asset_get', { content_id: id, kind: 'report_clean' });
          const rep = asset && asset.data && asset.data.text ? JSON.parse(asset.data.text) : null;
          paintRenderBox(out, ctx, rep, id);
        } catch (e) {
          paintRenderBox(out, ctx, null, id);
        }
      });
    } catch (err) {
      toast(errorText(err && err.code) + (err && err.message ? ' — ' + err.message : ''), 'err');
    } finally { renderBtn.disabled = false; }
  });

  if (mem.draft) paintScriptBox(out, ctx, mem.draft, m);
  else {
    out.replaceChildren(h('div', { class: 'panel' },
      h('h3', null, '결과'),
      h('p', { class: 'st-hint', text: '대본을 먼저 만들거나, 사진만으로 바로 렌더할 수 있습니다. 결과는 여기에 남습니다.' })));
  }
}

async function mountProduce(host, ctx) {
  const { h, api, toast } = ctx;
  try {
    const res = await api.getContentDetail(mem.cardId);
    const d = (res && res.data) || {};
    host.appendChild(produceSection({
      h: h,
      detail: d,
      meta: d.meta || { content_id: mem.cardId, brand: ctx.state.brand },
      brand: ctx.state.brand,
      toast: toast,
      onNavigate: (hash) => { location.hash = hash; }
    }));
  } catch (err) {
    host.appendChild(h('p', { class: 'st-hint err', text: '영상 단계를 열지 못했습니다 — ' + ((err && err.message) || err) }));
  }
}

function paintScriptBox(out, ctx, draft, materials) {
  const { h } = ctx;
  const box = h('div', { class: 'panel' }, h('h3', null, '대본 · 자막 큐'));
  const script = draft.script || draft.titles || [];
  if (Array.isArray(script) && script.length) {
    box.appendChild(h('pre', { class: 'st-pre' }, typeof script === 'string' ? script : script.join('\n')));
  }
  const cues = Array.isArray(draft.captions) ? draft.captions : [];
  if (cues.length) {
    box.appendChild(h('p', { class: 'st-hint', text: '자막 ' + cues.length + '큐 · 내레이션 ' + (Array.isArray(draft.narration) ? draft.narration.length : 0) + '큐 — 이 값으로 렌더하면 자막·목소리가 함께 들어갑니다.' }));
    const list = h('div', { class: 'st-cues' });
    cues.slice(0, 60).forEach((c) => {
      const start = Array.isArray(c) ? c[0] : c.start;
      const end = Array.isArray(c) ? c[1] : c.end;
      const text = Array.isArray(c) ? c[2] : c.text;
      list.appendChild(h('div', { class: 'st-cue' },
        h('span', { class: 'st-cue-t', text: Number(start).toFixed(1) + '–' + Number(end).toFixed(1) + 's' }),
        h('span', { text: String(text || '') })));
    });
    box.appendChild(list);
    if (cues.length > 60) box.appendChild(h('p', { class: 'st-hint', text: '… ' + (cues.length - 60) + '큐 더 있습니다(카드에 저장됨)' }));
  }
  box.appendChild(h('p', { class: 'st-hint', text: '톤: ' + ((materials.concept && materials.concept.tone) || 'plain') + ' · 담백 rate +6% / 호들갑 +18%·pitch +6Hz / 충청도 아저씨 −4%·pitch −3Hz' }));
  out.replaceChildren(box);
}

function paintRenderBox(out, ctx, rep, contentId) {
  const { h } = ctx;
  const box = h('div', { class: 'panel' }, h('h3', null, '렌더 결과'));
  if (!rep) {
    box.appendChild(h('p', { class: 'st-hint', text: '렌더는 끝났지만 결과 보고를 아직 못 읽었습니다. 카드 ' + contentId + ' 의 제작 탭에서 결과를 확인하세요.' }));
  } else {
    box.appendChild(h('p', { class: 'st-hint', text: (rep.out || '') + ' · ' + (rep.width || '?') + '×' + (rep.height || '?') + ' · ' + (rep.duration ? Math.round(rep.duration) + '초' : '') + (rep.lufs !== null && rep.lufs !== undefined ? ' · ' + rep.lufs + ' LUFS' : '') }));
    if (rep.note) box.appendChild(h('p', { class: 'st-hint', text: rep.note }));
    const checks = Array.isArray(rep.checks) ? rep.checks : [];
    if (checks.length) {
      box.appendChild(h('div', { class: 'st-checks' }, checks.map((c) => h('span', {
        class: 'st-check ' + String(c.status || '').toLowerCase(),
        text: (c.status === 'PASS' ? '✓ ' : c.status === 'WARN' ? '! ' : '✗ ') + (c.id || '') + ' ' + (c.value || '')
      }))));
    }
  }
  out.replaceChildren(box);
}

/* ────────────────────────── 인스타 피드 ────────────────────────── */

function paintFeed(actions, out, ctx, ui) {
  const { h, toast } = ctx;
  const m = mem.materials;
  const cards = buildFeedCards({ materials: m });
  const caption = feedCaption(m) + '\n\n' + hashtagsOf(m).join(' ');

  actions.appendChild(h('p', { class: 'st-hint', text: '사진 → 1080×1350 카드 6장. 보정은 캔버스 필터로만(원본 파일은 그대로). PNG 로 내려받아 인스타에 직접 올립니다.' }));
  actions.appendChild(h('div', { class: 'row' },
    h('button', { class: 'btn primary', type: 'button', text: '⬇ 카드 6장 PNG 저장', onclick: () => saveCards() }),
    copyTextBtn(h, caption, toast, '캡션·해시태그 복사')));

  const filters = h('div', { class: 'st-chips' });
  FILTER_PRESETS.forEach((f) => {
    const b = h('button', { class: 'st-chip' + (mem.feedFilter === f.id ? ' on' : ''), type: 'button', text: f.label });
    b.addEventListener('click', () => {
      mem.feedFilter = f.id;
      filters.querySelectorAll('.st-chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      paintCards();
    });
    filters.appendChild(b);
  });
  actions.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '보정' }), filters));

  const grid = h('div', { class: 'st-cards' });
  out.replaceChildren(h('div', { class: 'panel' }, h('h3', null, '카드 미리보기'), grid));

  async function paintCards() {
    grid.replaceChildren();
    const theme = CARD_THEME[ctx.state.brand] || CARD_THEME.daejeon_youth;
    for (const card of cards) {
      const photo = (m.photos || []).find((p) => p.name === card.photo);
      const bank = photo ? mem.photos[photo.id] : null;
      const url = bank && bank.previewUrl ? bank.previewUrl : '';
      const img = url ? await loadImageSafe(url) : null;
      const canvas = drawCard(card, img, { theme: theme, filter: mem.feedFilter, brandName: ctx.BRANDS[ctx.state.brand].name });
      const holder = h('div', { class: 'st-card' },
        canvas || h('div', { class: 'st-card-fallback', text: '카드를 그리지 못했습니다' }),
        h('span', { class: 'st-card-cap', text: '0' + card.no + ' ' + card.kicker + ' — ' + card.headline }));
      grid.appendChild(holder);
    }
  }
  paintCards();

  async function saveCards() {
    const theme = CARD_THEME[ctx.state.brand] || CARD_THEME.daejeon_youth;
    let n = 0;
    for (const card of cards) {
      const photo = (m.photos || []).find((p) => p.name === card.photo);
      const bank = photo ? mem.photos[photo.id] : null;
      const img = bank && bank.previewUrl ? await loadImageSafe(bank.previewUrl) : null;
      const canvas = drawCard(card, img, { theme: theme, filter: mem.feedFilter, brandName: ctx.BRANDS[ctx.state.brand].name });
      const blob = await canvasToPng(canvas);
      if (blob && downloadBlob(blob, cardFileName(m.place.name, card.no))) n++;
    }
    toast(n ? '카드 ' + n + '장을 내려받았습니다' : '카드를 내려받지 못했습니다 — 브라우저를 확인하세요', n ? 'ok' : 'err');
  }
}

/** 사진 한 장을 카드에 그릴 수 있는 이미지로. 실패하면 null(글자만 그린다). */
function loadImageSafe(url) {
  if (typeof Image === 'undefined' || !url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
