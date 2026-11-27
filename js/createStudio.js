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

import { produceSection } from './produceView.js?v=20261127a';
import { uploadPhoto, deleteUpload, isPhotoFile, PHOTO_MAX_COUNT, bytesToBase64, uploadVideo, listUploads } from './uploadVideo.js?v=20261127a';
import {
  FORMATS, TRACK_B_NOTE, formatsFor, formatLabel, CONCEPT_KINDS, TONES, VIDEO_LENGTHS,
  normalizeMaterials, materialSummary, hasMaterial, autoOrderPhotos, photoRole,
  photoPlanFor, buildBlogKit, signKit, buildFeedCards, feedCaption, hashtagsOf, buildDraftRequest,
  composeBlogWithDraft, readStudio, mergeFormat, mergeMaterialsIntoStudio,
  errorText, orderLine, FEED_CARDS,
  MV_DENSITIES, MV_MOODS, MV_LYRIC_MODES, MV_LENGTHS, MV_AUDIO_MAX_BYTES, MV_CHUNK_BYTES, mvLyricLines, mvOrderPayload, mvAudioFileName,
  MV_MAX_CLIPS, MV_VIDEO_EXT_RE, mvClipNames, mvMediaPlan
} from './studioLogic.js?v=20261127a';
import { drawCard, canvasToPng, downloadBlob, cardFileName, FILTER_PRESETS, CARD_THEME, CARD_WATERMARK_DEFAULT } from './studioCanvas.js?v=20261127a';
import { WATERMARK_POSITIONS } from './designModel.js?v=20261127a';
import { applyBlogRhythm, rhythmStats, lintRhythm, RHYTHM, PRESETS as TONE_PRESETS } from './blogTone.js?v=20261124';
import { DISCLOSURE_TEXT } from './blogCompliance.js?v=20261124b';
import { lintAiTone } from './blogAiTone.js?v=20261123c';
import { peekSeoSeed, clearSeoSeed } from './blogSeo.js?v=20261123c';
import { paintAiClip } from './aiClip.js?v=20261123c';
import { copyText } from './clipboard.js?v=20261126a';

const LS_MAT = 'contenthub.studio.v1.';
const LS_CARD = 'contenthub.studio.card.';
const LS_RECENT = 'contenthub.studio.recent.v1';
const POLL_MS = 15000;

const mem = {
  brand: '',
  materials: null,
  cardId: '',
  photos: {},          // id → { file, previewUrl, prepared }
  busy: {},
  poll: {},
  kit: null,
  draft: null,
  draftCardId: '',     // 이 draft 가 어느 카드의 것인지 — 카드를 바꾸면 버린다
  track: '',           // 상품 카드의 클립 트랙(product.track) — 수익화면 고정댓글 문구를 보여 준다
  // 공개 표시·네이버 기능(2026-11-24) — 블로그 스튜디오에서 한 번만 고르면 키트에 자동 반영된다.
  compliance: { paid: false, ownMoney: false, blogseTopic: '' },
  feedFilter: 'none',
  // 사진·카드뉴스 워터마크(2026-11-25) — 기본 @s2ongrae. 카드마다 그려지고, 끄거나 문구·위치를 바꿀 수 있다.
  watermark: Object.assign({}, CARD_WATERMARK_DEFAULT),
  mvLinked: false
};

function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 저장소가 막혀도 화면은 산다 */ } }

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
  // 딥링크: #/create/video?mv=1 이면 뮤직비디오 모드로 바로 연다(점검·북마크용). 한 번만 적용한다.
  if (format === 'video' && !mem.mvLinked && /(?:^|[?#&])mv=1(?:&|$)/.test(String(location.hash || ''))) {
    mem.materials.video.mv.on = true;
    mem.mvLinked = true;
  }
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
    '무엇을 만들지 먼저 고르면 재료 넣는 칸이 그 포맷에 맞게 바뀝니다 · 재료는 한 번만 넣으면 됩니다',
    h('button', { class: 'btn sm', type: 'button', title: '가게·아이디어만 적어 초안 카드를 바로 만듭니다', onclick: () => { location.hash = '#/capture'; }, text: '⚡ 빠른 카드' })));

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
    h('button', { class: 'btn sm', type: 'button', text: '채널 조립기 (예전 화면) 열기', onclick: () => { location.hash = '#/create/legacy'; } })));
  return null;
}

/* ────────────────────────── 포맷 화면 ────────────────────────── */

function renderFormat(main, ctx, format) {
  const { h, api, toast } = ctx;
  const brand = ctx.state.brand;
  const m = mem.materials;
  const cardFromHash = parseCardParam();
  if (cardFromHash) {
    if (mem.draftCardId && mem.draftCardId !== cardFromHash) { mem.draft = null; mem.track = ''; }
    mem.cardId = cardFromHash;
  }

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
  /* 사진 한 줄 메모(2026-11-25) — 사진마다 적으면 ▲ 캡션·(괄호 애드리브)가 추정 대신 이 사실로 만들어진다. */
  const memoBox = h('div', { class: 'st-ph-memos' });
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
      m.photos.push({ id: id, name: file.name, role: photoRole(file.name), caption: '', memo: '', order: m.photos.length + 1, uploaded: false, bytes: file.size });
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
    paintMemoList(ordered);
  }

  /* 사진별 한 줄 메모 — 빈 칸으로 두면 예전처럼 역할 기반 캡션이 된다(하위 호환). */
  function paintMemoList(ordered) {
    if (!ordered.length) { memoBox.replaceChildren(); return; }
    const rows = [h('p', { class: 'st-hint',
      text: '사진 한 줄 메모(선택) — 적은 사진은 그 사실로 ▲ 캡션·(괄호 애드리브)를 만듭니다. 비우면 역할(외관·음식…)로 만듭니다.' })];
    ordered.forEach((p, i) => {
      const input = h('input', {
        class: 'input st-memo-input', type: 'text', maxlength: '60',
        placeholder: '예) 사장님이 직접 구워주심 / 반찬 8가지',
        value: p.memo || '', autocomplete: 'off', 'aria-label': '사진 ' + (i + 1) + ' 메모'
      });
      input.addEventListener('input', () => {
        const row = m.photos[i];           // paintGrid 가 방금 넣은 그 사진(순서 같다)
        if (row) row.memo = input.value.slice(0, 60);
        else p.memo = input.value.slice(0, 60);
        onDirty();
      });
      rows.push(h('label', { class: 'st-memo-row' },
        h('span', { class: 'st-memo-no', text: String(i + 1) }),
        h('span', { class: 'st-memo-name', text: (p.role || photoRole(p.name)) + ' · ' + p.name }),
        input));
    });
    memoBox.replaceChildren(...rows);
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
  host.appendChild(memoBox);
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
  if (!m.place.name.trim() && !m.content.memo.trim() && !m.photos.length && !(m.video && m.video.mv && m.video.mv.on)) {
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
      mv: m.video.mv,
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

  /* ── 공개 표시 · 네이버 기능 (2026-11-24 자동화) ──
     사람이 글마다 규칙을 외우지 않게 두 가지 사실만 고르면
     ① 대가성 문구를 본문 맨 앞에 자동 배치 ② 내돈내산 × 제휴링크 충돌 자동 해소
     ③ 글감·블로그씨·미션위젯 단계를 붙여넣기 순서에 자동 삽입 한다. */
  const paidBox = h('input', { type: 'checkbox' });
  paidBox.checked = !!(mem.compliance && mem.compliance.paid);
  const ownBox = h('input', { type: 'checkbox' });
  ownBox.checked = !!(mem.compliance && mem.compliance.ownMoney);
  const seEl = h('input', { type: 'text', value: (mem.compliance && mem.compliance.blogseTopic) || '', placeholder: '예: 이번 주 절약 습관 (없으면 비움)', autocomplete: 'off' });
  const noticeLine = h('p', { class: 'st-hint' });

  function syncCompliance() {
    mem.compliance = { paid: paidBox.checked, ownMoney: ownBox.checked, blogseTopic: seEl.value.trim() };
    noticeLine.textContent = paidBox.checked
      ? '본문 맨 앞에 표시 문구가 자동으로 들어갑니다: ' + DISCLOSURE_TEXT
      : '대가를 받지 않은 직접 결제·방문 글이면 [내돈내산 인증] 단계가 자동으로 붙습니다(글감·블로그씨·미션위젯 포함).';
  }
  [paidBox, ownBox].forEach((el) => el.addEventListener('change', syncCompliance));
  seEl.addEventListener('input', syncCompliance);
  syncCompliance();

  actions.appendChild(h('div', { class: 'panel', style: 'margin-bottom:10px' },
    h('h3', null, '공개 표시 · 네이버 기능'),
    h('label', { class: 'st-check' }, paidBox, h('span', { text: ' 업체에서 제공받은 글이다(체험단·협찬)' })),
    h('label', { class: 'st-check' }, ownBox, h('span', { text: ' 내 돈 주고 산 물건·직접 예약한 방문이다(내돈내산 인증)' })),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '블로그씨 오늘의 주제 (선택)' }), seEl),
    noticeLine));

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

  /* ── 🖋️ 내 스타일 본문 (2026-11-25, #50347) — 성래 님 발행글 문법으로 0토큰 조립한 본문을 맨 위에 ──
     인용구 섹션·▲ 캡션·📌 정보카드·⭐ 총평·펀치라인 순서. 비는 자리는 ⟦⟧ 로 보이게 둔다. */
  const style = kit.style;
  const panels = [];   // 🖋️ 내 스타일 본문 등 — 마지막에 box 와 함께 한 번에 그린다
  if (style && style.text) {
    const kindLabel = style.kind === 'place' ? '맛집·장소' : style.kind === 'story' ? '자기서사·정산' : '정보·리뷰';
    const sBox = h('div', { class: 'panel' },
      h('h3', null, '🖋️ 내 스타일 본문 ', h('span', { class: 'tag', text: kindLabel })),
      h('p', { class: 'st-hint', text: '성래 님 발행글 문법(인용구 섹션 → ▲ 캡션 → 📌 정보카드 → ⭐ 총평 → 펀치라인 → 해시태그)으로 조립했습니다. 내가 쓴 문단은 그대로 옮겼습니다.' }),
      h('p', { class: 'st-hint' + (style.lint.warns.length ? ' err' : ''), text: '목소리 점수 ' + style.lint.score + ' · ' + style.lint.summary }),
      style.quality ? h('p', { class: 'st-hint' + (style.quality.warns.length ? ' err' : ''), text: '품질 점수 ' + style.quality.score + ' · ' + style.quality.summary + ' (' + style.quality.chars + '자, 공백 제외)' }) : null,
      h('pre', { class: 'st-pre' }, style.text),
      h('div', { class: 'row' },
        copyTextBtn(h, style.text, ctx.toast, '내 스타일 본문 복사'),
        downloadBtn(h, '내스타일본문.md', style.text, ctx.toast)),
      h('p', { class: 'st-hint', text: '⟦⟧ 는 채울 자리입니다 — 직접 채우거나 [🤖 AI 초안]으로 판정 한 줄·캡션·펀치라인만 받으세요.' }));
    sBox.appendChild(h('div', { class: 'gate' }, style.lint.items
      .filter((it) => it.id !== 'slots')
      .map((it) => h('div', { class: 'gate-row' },
        h('span', { text: it.label + ' — ' + (it.value || '') }),
        h('span', { class: 'gv ' + (it.state === 'pass' ? 'ok' : it.state === 'near' ? 'na' : 'no'), text: it.state === 'pass' ? '✓' : it.state === 'near' ? '△' : '✗' })))));
    if (style.quality) {
      sBox.appendChild(h('h3', { text: '품질 7지침 (스레드 @k.sh0000_ · 제미니 확정)' }));
      sBox.appendChild(h('p', { class: 'st-hint', text: '경험·AI투·장단점·정보 중복·메뉴 묘사·종결 반복·분량. 이 점수는 발행을 막지 않습니다 — 고칠 것만 보세요.' }));
      sBox.appendChild(h('div', { class: 'gate' }, style.quality.items.map((it) => h('div', { class: 'gate-row' },
        h('span', { text: it.label + ' — ' + (it.value || '') }),
        h('span', { class: 'gv ' + (it.state === 'pass' ? 'ok' : it.state === 'near' ? 'na' : 'no'), text: it.state === 'pass' ? '✓' : it.state === 'near' ? '△' : '✗' })))));
    }
    panels.push(sBox);
  }

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

  /* ── 공개 표시 · 네이버 기능 자동 결과 (2026-11-24) ── */
  const comp = kit.compliance || {};
  const compBox = h('div', null);
  box.appendChild(h('h3', { text: '공개 표시 · 네이버 기능' }));
  if (comp.paid) {
    compBox.appendChild(h('p', { class: 'st-hint', text: '✅ 대가성 문구를 본문 맨 앞에 넣었습니다 — ' + DISCLOSURE_TEXT }));
  }
  if (comp.pulled_links && comp.pulled_links.length) {
    compBox.appendChild(h('p', { class: 'st-hint err',
      text: '⛔ 내돈내산 인증 글이라 제휴 링크 ' + comp.pulled_links.length + '개를 본문에서 자동으로 뺐습니다(운영정책·표시광고법) — 아래 링크 카드 자리로 옮겼습니다.' }));
    comp.pulled_links.forEach((u) => compBox.appendChild(h('p', { class: 'st-hint', text: '· ' + u })));
  } else if (comp.conflict) {
    compBox.appendChild(h('p', { class: 'st-hint err', text: '⛔ 내돈내산 인증 + 제휴 링크가 한 글에 있습니다 — 내돈내산을 끄거나 링크를 빼 주세요.' }));
  }
  const steps = Array.isArray(kit.native) ? kit.native : [];
  if (steps.length) {
    const list = h('div', { class: 'gate' });
    steps.forEach((n) => list.appendChild(h('div', { class: 'gate-row' },
      h('span', { text: n.label }), h('span', { class: 'gv na', text: '자동 단계' }))));
    compBox.appendChild(list);
    compBox.appendChild(h('p', { class: 'st-hint', text: '붙이는 순서에 위 단계가 들어 있습니다 — 기능 설명은 docs/BLOG_NATIVE_FEATURES_v1.md' }));
  }
  box.appendChild(compBox);

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

  /* ── AI 티 8패턴 · 첫 400자 D.I.A.+ (2026-11-21, #44584) — 점검 탭과 같은 엔진 ── */
  const mat = mem.materials || {};
  const kws = [
    (mat.place && mat.place.name) || '',
    (mat.content && mat.content.region_dong) || '',
    (mat.content && mat.content.category) || ''
  ].filter(Boolean).join(',');
  const ai = lintAiTone({
    title: (kit.titles || [])[0] || '', body: bodyText, keywords: kws,
    tonePreset: (kit.rhythm && kit.rhythm.preset) || ''
  });
  box.appendChild(h('h3', { text: 'AI 티 8패턴 · D.I.A.+' }));
  if (ai.hold) box.appendChild(h('p', { class: 'st-hint err', text: '⛔ 발행 보류 — ' + ai.holdReasons.join(' · ') }));
  box.appendChild(h('p', { class: 'st-hint' + (ai.count ? ' err' : ''),
    text: ai.count
      ? '⚠ AI 티 ' + ai.count + '개 — ' + ai.patterns.filter((p) => p.state === 'warn' || p.state === 'fail').map((p) => p.label + '(' + p.value + ')').join(' · ')
      : '✓ AI 티 0개 — 문장 ' + ai.stats.sentences + '개 · SD ' + ai.stats.sentenceSd + ' · 1인칭 ' + ai.stats.firstPerson }));
  box.appendChild(h('p', { class: 'st-hint' + (ai.dia.state === 'pass' ? '' : ' err'),
    text: 'D.I.A.+ ' + ai.dia.hits + '/' + ai.dia.total + ' — '
      + ai.dia.elements.map((e) => (e.state === 'pass' ? '✓' : e.state === 'near' ? '△' : '✗') + e.label).join('  ') }));
  if (ai.keywords.items.length) {
    box.appendChild(h('p', { class: 'st-hint' + (ai.keywords.state === 'fail' ? ' err' : ''),
      text: '검색어 — ' + ai.keywords.items.map((k) => k.keyword + ' ' + k.count + '회').join(' · ') }));
  }

  box.appendChild(h('h3', { text: '네이버에 붙이는 순서' }));
  box.appendChild(h('ol', { class: 'st-steps' }, kit.paste_steps.map((s) => h('li', { text: s }))));
  /* (2026-11-25 결함 수정) 예전에는 여기서 out.replaceChildren(box) 만 해서 위의 🖋️ 내 스타일 본문 판이 지워졌다. */
  out.replaceChildren(...panels.concat([box]));
}

function copyTextBtn(h, text, toast, label) {
  return h('button', { class: 'ghost-btn sm', type: 'button', text: '⧉ ' + (label || '복사'), onclick: () => copyText(text, toast, label) });
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
  const { h } = ctx;
  const host = h('div', { class: 'st-video' });
  actions.appendChild(host);
  const paint = () => {
    host.replaceChildren();
    paintVideoBody(host, out, ctx, ui);
  };
  ui.repaintVideo = paint;
  paint();
  /* ?card= 로 들어왔으면 카드에 저장된 대본·트랙을 먼저 보여 준다 — 상품 수집 카드의 고정댓글 문구가 여기 있다(v3). */
  loadCardDraft(ctx, ui);
}

/** 카드에 이미 저장된 영상 대본·상품 트랙을 읽어 결과 칸에 붙인다(없으면 아무 것도 하지 않는다). */
async function loadCardDraft(ctx, ui) {
  const { api } = ctx;
  const id = mem.cardId;
  if (!id || !api) return;
  if (mem.draftCardId === id && mem.draft) return;
  if (mem.draftTriedFor === id) return;
  mem.draftTriedFor = id;
  try {
    const res = await api.getContentDetail(id);
    const payload = (res && res.data && res.data.payload) || {};
    const st = readStudio(payload);
    const draft = (st.video && st.video.draft) || null;
    const product = (st.studio && st.studio.product) || null;
    if (product && product.track) mem.track = String(product.track);
    if (!draft || !Array.isArray(draft.captions) || !draft.captions.length) return;
    mem.draft = draft;
    mem.draftCardId = id;
    if (ui && ui.repaintVideo) ui.repaintVideo();
  } catch (e) { /* 카드 읽기 실패는 화면을 막지 않는다 — [대본 만들기]로 다시 뽑을 수 있다 */ }
}

/** 영상 화면 본문 — [일반 영상 | 🎵 뮤직비디오] 토글 하나로 갈아 끼운다(새 라우트 없음). */
function paintVideoBody(host, out, ctx, ui) {
  const { h } = ctx;
  const m = mem.materials;
  const mv = m.video.mv;
  const setMv = (on) => {
    if (m.video.mv.on === on) return;
    m.video.mv.on = on;
    saveMaterials();
    if (ui && ui.repaintVideo) ui.repaintVideo();
  };
  const chip = (label, on, fn) => {
    const b = h('button', { class: 'st-chip' + (on ? ' on' : ''), type: 'button', text: label });
    b.addEventListener('click', fn);
    return b;
  };
  host.appendChild(h('div', { class: 'st-field-row st-mode-row' },
    h('span', { class: 'field-label', text: '모드' }),
    h('div', { class: 'st-chips' },
      chip('일반 영상', !mv.on, () => setMv(false)),
      chip('🎵 뮤직비디오', mv.on, () => setMv(true)))));

  if (mv.on) { paintMvPanel(host, out, ctx, ui); return; }
  paintNormalVideo(host, out, ctx, ui);
}

/* ── 일반 영상 — 지금까지의 화면 그대로 ── */

function paintNormalVideo(host, out, ctx, ui) {
  const { h, toast, api } = ctx;
  const m = mem.materials;
  const plan = photoPlanFor('video', { photos: m.photos, lengthSec: m.video.length_sec });

  const scriptBtn = h('button', { class: 'btn', type: 'button', text: '🤖 대본·자막·내레이션 만들기' });
  const renderBtn = h('button', { class: 'btn primary', type: 'button', text: '🎬 사진으로 완제품 렌더 (노트북)' });
  const stepsBtn = h('button', { class: 'btn sm', type: 'button', text: '영상 편집 단계 열기' });

  host.appendChild(h('div', { class: 'row' }, scriptBtn, renderBtn));
  host.appendChild(h('div', { class: 'st-hint' },
    h('span', { text: '이 길이에 사진 ' + plan.target + '장 · 지금 ' + plan.count + '장 — ' + (plan.enough ? (plan.meets_target ? '충분합니다' : plan.missing + '장 더 있으면 더 좋습니다') : ('최소 ' + plan.min + '장이 필요합니다(' + (plan.min - plan.count) + '장 더)')) }),
    h('span', { text: ' · 렌더는 1080×1920 30fps, 켄번즈(장당 3.0초 이상·자막 길이에 맞춰 늘어남), 자막 번인+내레이션 포함입니다.' })));
  host.appendChild(h('p', { class: 'st-hint', text: '영상이 이미 있으면 아래 [영상 편집 단계]에서 올리고 컷·자막·마무리를 하세요. 그 화면은 그대로 살아 있습니다.' }));

  const stepsHost = h('div', { class: 'st-steps-host' });
  stepsHost.hidden = true;
  stepsBtn.addEventListener('click', async () => {
    stepsHost.hidden = !stepsHost.hidden;
    if (!stepsHost.hidden && !stepsHost.firstChild) {
      if (!mem.cardId) { toast('먼저 카드로 저장하면 영상 편집 단계가 열립니다', 'err'); return; }
      await mountProduce(stepsHost, ctx);
    }
  });
  host.appendChild(stepsBtn);
  host.appendChild(stepsHost);

  /* AI 클립(무료) — 구글 Flow·허깅페이스 프롬프트 빌더. 새 파일 js/aiClip.js 만 쓰고 style.css 는 건드리지 않는다. */
  paintAiClip(host, ctx);

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
            // 대본 AI 가 뽑은 질문형 훅·무음 보조 글자(2026-11-21) — 제작 스텝퍼가 이어받는다.
            hook: draft.hook || null, hook_sub: draft.hook_sub || null,
            from: 'studio-draft', updated_at: new Date().toISOString()
          });
          await api.updateContent({ content_id: id, expected_version: res.data.version, patch: { production: production }, patch_mode: 'deep' }).catch(() => {});
          // 제작 스텝퍼의 훅 칸이 비어 있으면 대본이 뽑은 훅으로 채운다(내가 쓴 값이 있으면 그게 이긴다 — 덮지 않는다).
          try {
            const vs = readStudio(payload).formats.video || {};
            const preset = {};
            if (draft.hook && !String(vs.hook || '').trim()) preset.hook = draft.hook;
            if (draft.hook_sub && !String(vs.hook_sub || '').trim()) preset.hook_sub = draft.hook_sub;
            if (Object.keys(preset).length) await saveMaterialsToStudio(ctx, 'video', preset);
          } catch (e) { /* 훅 자동 채우기는 실패해도 대본 저장은 끝난 상태다 */ }
          mem.draft = draft;
          mem.draftCardId = id;
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

/* ────────────────────────── 🎵 뮤직비디오 모드 (Phase 1) ──────────────────────────
 *  사진 + 음원(내 파일·보관 BGM) + 가사 + 비트 컷 + 카라오케. 유료 API 없음.
 *  음원은 허브 _bgm 보관함에 올려 두고 이름만 오더에 싣는다(bgm_put → 노트북 bgm_fetch).
 *  노래가 목소리라서 내레이션(TTS)과 자막 레이어는 끈다 — 가사 레이어만 쓴다.
 */

const MV_AUDIO_ACCEPT = '.mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav';

/** 보관함의 음원 목록 — 내가 올린 파일과 무료 BGM 이 함께 온다. */
async function loadBgmLibrary(api) {
  const d = await api.post('bgm_list', {});
  return Array.isArray(d && d.data && d.data.items) ? d.data.items : [];
}

function paintMvPanel(host, out, ctx, ui) {
  const { h, toast, api } = ctx;
  const m = mem.materials;
  const mv = m.video.mv;
  const photos = (m.photos || []).filter((p) => p.uploaded).map((p) => p.name);
  const save = () => { saveMaterials(); ui.refreshSummary && ui.refreshSummary(); };

  host.appendChild(h('p', { class: 'st-hint', text: '노래가 목소리라서 내레이션(목소리)은 끄고, 자막 대신 가사를 카라오케처럼 띄웁니다. 사진과 영상 컷을 번갈아 비트에 맞춰 굽고, 사진이 컷보다 적으면 돌려 씁니다(같은 사진이 3컷 안에 다시 나오지 않게).' }));
  const mediaLine = h('p', { class: 'st-hint', text: '' });
  host.appendChild(mediaLine);

  /* ① 영상 컷(선택, 2026-11-27 P0) — 사진 전용이 아니다. 카드에 올라간 mp4·mov·m4v 를 고른다. */
  host.appendChild(h('h3', { text: '① 영상 컷 (선택)' }));
  const clipRows = h('div', { class: 'st-chips' });
  const clipNote = h('p', { class: 'st-hint', text: '' });
  const clipList = () => mvClipNames(mv.clips);
  const setClips = (list) => {
    mv.clips = mvClipNames(list);
    save();
    paintClips();
    paintMediaLine();
    if (ui && ui.repaintVideo) ui.repaintVideo();
  };
  function paintMediaLine() {
    const plan = mvMediaPlan({ images: photos, clips: clipList() });
    const bits = ['사진 ' + photos.length + '장', '영상 컷 ' + plan.videos + '개'];
    mediaLine.textContent = bits.join(' · ') + (plan.ok ? ' — 이대로 렌더할 수 있습니다' : ' — 사진 3장 이상 또는 영상 컷 1개 이상이 필요합니다');
  }
  async function paintClips() {
    const picked = clipList();
    clipRows.replaceChildren();
    const chip = (name, on, onClick) => {
      const b = h('button', { class: 'st-chip' + (on ? ' on' : ''), type: 'button', text: (on ? '✓ ' : '+ ') + name });
      b.addEventListener('click', onClick);
      return b;
    };
    picked.forEach((n) => clipRows.appendChild(chip(n, true, () => setClips(picked.filter((x) => x !== n)))));
    let items = [];
    if (mem.cardId) {
      try { items = (await listUploads(ctx.api, mem.cardId)).filter((it) => it && it.kind === 'video' && it.complete !== false); } catch (e) { items = []; }
    }
    items.filter((it) => picked.indexOf(it.name) < 0).forEach((it) => {
      clipRows.appendChild(chip(it.name, false, () => {
        if (picked.length >= MV_MAX_CLIPS) { toast('영상 컷은 ' + MV_MAX_CLIPS + '개까지입니다', 'err'); return; }
        setClips(picked.concat([it.name]));
      }));
    });
    if (!picked.length && !items.length) {
      clipRows.appendChild(h('span', { class: 'st-hint', text: '카드에 올린 영상이 없습니다 — [🎬 영상 올리기]로 mp4·mov·m4v 를 올리면 사진과 함께 컷으로 들어갑니다(최대 ' + MV_MAX_CLIPS + '개).' }));
    }
  }
  const clipInput = h('input', { type: 'file', accept: 'video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v', multiple: true, style: 'display:none' });
  const clipAdd = h('button', { class: 'btn sm', type: 'button', text: '🎬 영상 올리기 (mp4·mov·m4v)' });
  clipAdd.addEventListener('click', () => clipInput.click());
  clipInput.addEventListener('change', async () => {
    const files = Array.from(clipInput.files || []);
    clipInput.value = '';
    if (!files.length) return;
    clipAdd.disabled = true;
    try {
      const id = await ensureCard(ctx, 'video', ui);
      for (const file of files) {
        if (!MV_VIDEO_EXT_RE.test(String((file && file.name) || ''))) {
          toast('mp4·mov·m4v 만 올릴 수 있습니다: ' + String((file && file.name) || '').slice(0, 30), 'err');
          continue;
        }
        if (clipList().length >= MV_MAX_CLIPS) { toast('영상 컷은 ' + MV_MAX_CLIPS + '개까지입니다', 'err'); break; }
        try {
          const r = await uploadVideo({
            api: ctx.api, contentId: id, file: file,
            onProgress: (p) => { clipNote.textContent = '올리는 중… ' + p.index + '/' + p.parts; }
          });
          setClips(clipList().concat([r.name]));
          clipNote.textContent = '';
        } catch (err) {
          clipNote.textContent = '';
          toast('영상 ' + String((file && file.name) || '').slice(0, 20) + ' 을(를) 올리지 못했습니다 — ' + errorText(err && err.code), 'err');
        }
      }
    } catch (err) {
      toast(errorText(err && err.code) + (err && err.message ? ' — ' + err.message : ''), 'err');
    } finally { clipAdd.disabled = false; }
  });
  host.appendChild(h('div', { class: 'row' }, clipAdd, clipInput));
  host.appendChild(clipRows);
  host.appendChild(clipNote);
  host.appendChild(h('p', { class: 'st-hint', text: '영상 컷은 자기 길이만큼 그대로 들어가고, 모자라는 자리는 사진이 비트에 맞춰 채웁니다. 컷을 8개 넘게 쓰려면 나누어 렌더하세요.' }));
  paintClips();
  paintMediaLine();

  /* ② 음원 */
  host.appendChild(h('h3', { text: '② 음원' }));
  const audioLine = h('p', { class: 'st-hint', text: mv.audio.name ? '고른 곡: ' + (mv.audio.title || mv.audio.name) : '아직 고르지 않았습니다' });
  const srcRow = h('div', { class: 'st-chips' });
  const setSource = (src) => {
    mv.audio.source = src;
    save();
    if (ui && ui.repaintVideo) ui.repaintVideo();
  };
  [[ 'file', '내 파일'], ['library', '보관함에서 고르기']].forEach(([id, label]) => {
    const b = h('button', { class: 'st-chip' + (mv.audio.source === id ? ' on' : ''), type: 'button', text: label });
    b.addEventListener('click', () => setSource(id));
    srcRow.appendChild(b);
  });
  host.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '가져오기' }), srcRow));

  const progress = h('p', { class: 'st-hint', text: '' });
  if (mv.audio.source === 'file') {
    const input = h('input', { type: 'file', accept: MV_AUDIO_ACCEPT, style: 'display:none' });
    const pick = h('button', { class: 'btn sm', type: 'button', text: '🎵 내 음원 올리기 (mp3·m4a·wav)' });
    pick.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      const name = mvAudioFileName(file.name);
      if (!name) { toast('mp3·m4a·wav 만 올릴 수 있습니다', 'err'); return; }
      if (Number(file.size) > MV_AUDIO_MAX_BYTES) { toast('30MB 가 넘습니다 — mp3·m4a 로 바꿔 주세요', 'err'); return; }
      pick.disabled = true;
      try {
        const parts = Math.max(1, Math.ceil(file.size / MV_CHUNK_BYTES));
        for (let i = 0; i < parts; i++) {
          const blob = file.slice(i * MV_CHUNK_BYTES, Math.min(file.size, (i + 1) * MV_CHUNK_BYTES));
          const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
          const r = await api.post('bgm_put', {
            name: name, index: i, parts: parts, total_size: file.size, data: data,
            title: file.name.replace(/\.[^.]+$/, '').slice(0, 80)
          }, null, { timeoutMs: 120000 });
          progress.textContent = '올리는 중… ' + (i + 1) + '/' + parts;
          if (i === parts - 1 && r && r.data && r.data.done === false) {
            throw new Error('조각이 덜 올라갔습니다(' + r.data.received + '/' + parts + ')');
          }
        }
        mv.audio = { name: name, title: file.name.replace(/\.[^.]+$/, '').slice(0, 80), source: 'file' };
        save();
        toast('음원을 허브 보관함에 올렸습니다', 'ok');
        if (ui && ui.repaintVideo) ui.repaintVideo();
      } catch (err) {
        progress.textContent = '';
        toast('음원 올리기 실패 — ' + errorText(err && err.code) + (err && err.message ? ' ' + String(err.message).slice(0, 80) : ''), 'err');
      } finally { pick.disabled = false; }
    });
    host.appendChild(h('div', { class: 'row' }, pick, input));
    host.appendChild(h('p', { class: 'st-hint', text: '내가 만든 노래(허깅페이스 ACE-Step·Suno 등)나 녹음 파일을 그대로 올리면 됩니다. mp3·m4a 25MB, wav 30MB 까지.' }));
  } else {
    const listHost = h('div', { class: 'st-chips' });
    const loadBtn = h('button', { class: 'btn sm', type: 'button', text: '📂 보관함 목록 불러오기' });
    loadBtn.addEventListener('click', async () => {
      loadBtn.disabled = true;
      try {
        const items = await loadBgmLibrary(api);
        listHost.replaceChildren();
        if (!items.length) {
          listHost.appendChild(h('span', { class: 'st-hint', text: '보관함이 비어 있습니다 — 내 음원을 올리거나, [영상 편집 단계] ⑥에서 무료 BGM을 골라 보관하세요.' }));
        }
        items.slice(0, 20).forEach((it) => {
          const label = (it.title || it.name) + (it.source === 'user' ? ' · 내 파일' : (it.credit_required ? ' · 출처 표기' : ''));
          const b = h('button', { class: 'st-chip' + (mv.audio.name === it.name ? ' on' : ''), type: 'button', text: label });
          b.addEventListener('click', () => {
            mv.audio = { name: it.name, title: it.title || it.name, source: 'library' };
            save();
            toast('곡을 골랐습니다: ' + (it.title || it.name), 'ok');
            if (ui && ui.repaintVideo) ui.repaintVideo();
          });
          listHost.appendChild(b);
        });
      } catch (err) {
        toast('목록을 불러오지 못했습니다 — ' + errorText(err && err.code), 'err');
      } finally { loadBtn.disabled = false; }
    });
    host.appendChild(h('div', { class: 'row' }, loadBtn));
    host.appendChild(listHost);
    host.appendChild(h('p', { class: 'st-hint', text: '무료 BGM(CC0·퍼블릭 도메인·CC BY)도 여기에서 고릅니다. CC BY 곡은 영상 설명란에 출처 문구를 넣어야 하며, 그 문구는 마무리 보고에 함께 나옵니다.' }));
  }
  host.appendChild(audioLine);

  /* ③ 가사 */
  host.appendChild(h('h3', { text: '③ 가사' }));
  const lyricChips = h('div', { class: 'st-chips' });
  MV_LYRIC_MODES.forEach((lm) => {
    const b = h('button', { class: 'st-chip' + (mv.lyric_mode === lm.id ? ' on' : ''), type: 'button', text: lm.label });
    b.addEventListener('click', () => {
      mv.lyric_mode = lm.id;
      save();
      if (ui && ui.repaintVideo) ui.repaintVideo();
    });
    lyricChips.appendChild(b);
  });
  host.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '종류' }), lyricChips));
  if (mv.lyric_mode !== 'none') {
    const ta = h('textarea', { class: 'textarea', rows: '8', placeholder: '한 줄에 한 마디씩 적으세요.\n예)\n대전 밤거리 불빛 아래\n우리 둘만의 노래를 불러' });
    ta.value = mv.lyrics || '';
    const count = h('p', { class: 'st-hint', text: '' });
    const upd = () => { count.textContent = '가사 ' + mvLyricLines(ta.value).length + '줄 — 줄 하나가 한 마디 안팎에 붙습니다(곡 길이에 맞춰 나눕니다).'; };
    ta.addEventListener('input', () => { mv.lyrics = ta.value; upd(); save(); });
    upd();
    host.appendChild(ta);
    host.appendChild(count);
    host.appendChild(h('p', { class: 'st-hint', text: 'AI 가사 자동 작성은 다음 단계에서 붙습니다. 지금은 AI 채팅에서 받은 가사를 그대로 붙여넣으면 됩니다. 한 줄 14자 안팎이 화면에서 읽기 좋습니다.' }));
  } else {
    host.appendChild(h('p', { class: 'st-hint', text: '연주곡으로 갑니다 — 가사·카라오케 없이 컷과 다운비트 이펙트만 들어갑니다.' }));
  }

  /* ④ 분위기 */
  host.appendChild(h('h3', { text: '④ 분위기' }));
  const moodRow = h('div', { class: 'st-chips' });
  MV_MOODS.forEach((mo) => {
    const b = h('button', { class: 'st-chip' + (mv.mood === mo.id ? ' on' : ''), type: 'button', text: mo.label });
    b.addEventListener('click', () => {
      mv.mood = mo.id; save();
      moodRow.querySelectorAll('.st-chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
    moodRow.appendChild(b);
  });
  host.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '곡 분위기' }), moodRow));
  host.appendChild(h('p', { class: 'st-hint', text: '지금은 고른 분위기를 기록·보고에만 씁니다(컷 밀도 추천에 참고). 곡 생성은 Phase 3.' }));

  /* ⑤ 길이 · 컷 밀도 */
  host.appendChild(h('h3', { text: '⑤ 길이 · 컷 밀도' }));
  const lenRow = h('div', { class: 'st-chips' });
  MV_LENGTHS.forEach((sec) => {
    const b = h('button', { class: 'st-chip' + (mv.length_sec === sec ? ' on' : ''), type: 'button', text: sec === 0 ? '곡 끝까지' : sec + '초' });
    b.addEventListener('click', () => {
      mv.length_sec = sec; save();
      lenRow.querySelectorAll('.st-chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
    lenRow.appendChild(b);
  });
  host.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '길이' }), lenRow));
  const denRow = h('div', { class: 'st-chips' });
  MV_DENSITIES.forEach((d) => {
    const b = h('button', { class: 'st-chip' + (mv.density === d.id ? ' on' : ''), type: 'button', text: d.label });
    b.addEventListener('click', () => {
      mv.density = d.id; save();
      denRow.querySelectorAll('.st-chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
    denRow.appendChild(b);
  });
  host.appendChild(h('div', { class: 'st-field-row' }, h('span', { class: 'field-label', text: '컷 밀도' }), denRow));

  /* 이펙트 */
  const eff = h('input', { type: 'checkbox' });
  eff.checked = mv.effects === 'pulse';
  eff.addEventListener('change', () => { mv.effects = eff.checked ? 'pulse' : 'none'; save(); });
  host.appendChild(h('label', { class: 'st-field-row' },
    h('span', { class: 'field-label', text: '이펙트' }),
    h('span', { class: 'st-chips' }, h('label', { class: 'st-chip' + (mv.effects === 'pulse' ? ' on' : ''), style: 'display:inline-flex;gap:6px;align-items:center' }, eff, h('span', { text: '다운비트 번쩍임' })))));
  host.appendChild(h('p', { class: 'st-hint', text: '번쩍임은 1마디 첫 박에만 넣습니다(매 박자·강한 플래시·글리치 없음). 끄면 컷만 남습니다.' }));

  /* 보컬 무료 경로 안내 */
  const guide = h('details', { class: 'panel' },
    h('summary', { text: '🎤 노래(보컬)는 어디서 무료로 만들까 — 안내' }),
    h('div', { class: 'st-hint' },
      h('p', { text: '① 허깅페이스 ACE-Step Space — 설치 없이 웹에서 한국어 노래를 만들 수 있습니다(무료, 대기열 있음). 뽑은 파일을 위 [내 음원 올리기]로 올리면 끝.' }),
      h('p', { text: '② 내 PC에서 ACE-Step 실행 — MIT 라이선스라 상업 이용 가능. NVIDIA VRAM 8GB 이상이면 3분 곡이 1분 안팎, CPU만이면 곡당 수 분~수십 분이라 권하지 않습니다.' }),
      h('p', { text: '③ 이미 만든 곡(Suno 등)이 있으면 mp3 로 내려받아 그대로 올리면 됩니다 — 이 화면은 곡을 만들지 않고 굽기만 합니다.' }),
      h('p', { text: '④ 노래에서 보컬만 떼고 싶으면 TuneSplit·Free.ai 같은 무료 보컬 분리 웹툴을 쓰고, 결과 mp3 를 올리세요.' }),
      h('p', { text: '출처 표기: AI 로 만든 곡은 유튜브에서 “변경된 콘텐츠” 표시가 필요할 수 있습니다. 보관함의 CC BY 곡은 설명란에 출처 문구를 넣어야 합니다.' })));
  host.appendChild(guide);

  /* 렌더 */
  const renderBtn = h('button', { class: 'btn primary', type: 'button', text: '🎵 뮤직비디오 렌더 (노트북)' });
  host.appendChild(h('div', { class: 'row' }, renderBtn));
  host.appendChild(h('p', { class: 'st-hint', text: '1080×1920 30fps · 하드컷(프레임 격자 스냅) · 가사 카라오케 · 음량 −14 LUFS. 노래는 이미 곡 길이 그대로 쓰고, 고른 길이까지만 자릅니다.' }));
  renderBtn.addEventListener('click', async () => {
    if (!mv.audio.name) { toast('음원을 먼저 고르세요', 'err'); return; }
    const plan = mvMediaPlan({ images: photos, clips: clipList() });
    if (!plan.ok) { toast('사진 ' + plan.missing + '장이 더 필요합니다 — 또는 영상 컷을 1개 이상 골라 주세요', 'err'); return; }
    renderBtn.disabled = true;
    const label = renderBtn.textContent;
    try {
      const id = await ensureCard(ctx, 'video', ui);
      const payload = mvOrderPayload({ contentId: id, brand: ctx.state.brand, images: photos, mv: mv });
      mem.outHost = out;
      await sendOrder(ctx, 'render-mv', payload, renderBtn, async () => {
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
    } finally { renderBtn.disabled = false; renderBtn.textContent = label; }
  });

  out.replaceChildren(h('div', { class: 'panel' },
    h('h3', null, '결과'),
    h('p', { class: 'st-hint', text: '렌더를 보내면 BPM·컷 수·박자 오차가 여기에 남습니다. 결과 영상은 카드 ④·⑥의 [만든 파일]에서 내려받습니다.' })));
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
  if (mem.track) {
    box.appendChild(h('p', { class: 'st-hint', text: '트랙: ' + (mem.track === 'commerce' ? 'B · 쇼핑커넥트 수익화' : 'A · 챌린지') + (mem.track === 'commerce' ? ' — 쇼핑커넥트 태그 필수 · #오늘클립챌린지 금지' : ' — #오늘클립챌린지 · 쇼핑커넥트 태그 금지') }));
  }
  /* 클립 수익화 트랙의 대가성 문구는 첫 고정댓글이 공식 위치다(v3) — 카드 draft 에 있으면 그대로 복사하게 둔다. */
  const pin = String(draft.pinned_comment || '');
  if (pin) {
    const pinBox = h('div', { class: 'st-pin' },
      h('h4', null, '첫 고정댓글 — 그대로 복사'),
      h('pre', { class: 'st-pre' }, pin),
      copyTextBtn(h, pin, ctx.toast, '고정댓글 문구 복사'),
      h('p', { class: 'st-hint', text: '본문 첫 부분 [광고]는 상품 태그를 붙이면 자동 표시됩니다. 안 보이면 직접 넣으세요.' }));
    box.appendChild(pinBox);
  }
  out.replaceChildren(box);
}

function paintRenderBox(out, ctx, rep, contentId) {
  const { h } = ctx;
  const box = h('div', { class: 'panel' }, h('h3', null, '렌더 결과'));
  if (!rep) {
    box.appendChild(h('p', { class: 'st-hint', text: '렌더는 끝났지만 결과 보고를 아직 못 읽었습니다. 카드 ' + contentId + ' 의 제작 탭에서 결과를 확인하세요.' }));
  } else {
    box.appendChild(h('p', { class: 'st-hint', text: (rep.out || '') + ' · ' + (rep.width || '?') + '×' + (rep.height || '?') + ' · ' + (rep.duration ? Math.round(rep.duration) + '초' : '') + (rep.lufs !== null && rep.lufs !== undefined ? ' · ' + rep.lufs + ' LUFS' : '') }));
    // 뮤직비디오 보고 — 박자에 붙었는지를 기계가 확인한 값을 그대로 보여 준다
    if (rep.mv || rep.detected_bpm) {
      const mvBits = [];
      if (rep.detected_bpm) mvBits.push('BPM ' + rep.detected_bpm);
      if (rep.cut_count) mvBits.push('컷 ' + rep.cut_count);
      if (rep.max_snap_drift_ms !== undefined && rep.max_snap_drift_ms !== null) mvBits.push('박자 오차 최대 ' + rep.max_snap_drift_ms + 'ms');
      if (rep.beat_fallback) mvBits.push('비트 감지를 못 해 2초 균등 컷으로 대체');
      if (rep.lyrics_source) mvBits.push('가사 ' + (rep.lyrics_source === 'none' ? '없음(연주곡)' : rep.lyric_lines + '줄'));
      if (mvBits.length) box.appendChild(h('p', { class: 'st-hint', text: '🎵 ' + mvBits.join(' · ') }));
      if (rep.effects_used) box.appendChild(h('p', { class: 'st-hint', text: '이펙트: ' + rep.effects_used + (rep.scene_check ? ' · 장면 전환 검사 ' + rep.scene_check : '') }));
    }
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

  /* 워터마크(2026-11-25) — 기본 @s2ongrae. 사진·카드뉴스에도 영상과 같은 계정 표시를 넣는다. */
  const wmOn = h('input', { type: 'checkbox' });
  wmOn.checked = mem.watermark.enabled !== false;
  wmOn.addEventListener('change', () => { mem.watermark.enabled = wmOn.checked; paintCards(); });
  const wmText = h('input', { class: 'input st-wm-text', type: 'text', maxlength: '24', value: mem.watermark.text || '', placeholder: '@s2ongrae', 'aria-label': '워터마크 문구' });
  wmText.addEventListener('input', () => { mem.watermark.text = wmText.value; paintCards(); });
  const wmPos = h('select', { class: 'input st-wm-pos', 'aria-label': '워터마크 위치', onchange: () => { mem.watermark.position = wmPos.value; paintCards(); } },
    ...WATERMARK_POSITIONS.map((p) => h('option', { value: p.id, selected: mem.watermark.position === p.id ? '' : null, text: p.label })));
  const wmRow = h('div', { class: 'st-field-row' },
    h('span', { class: 'field-label', text: '워터마크' }),
    h('label', { class: 'st-wm-on' }, wmOn, h('span', { text: '넣기' })),
    wmText, wmPos);
  actions.appendChild(wmRow);
  actions.appendChild(h('p', { class: 'st-hint', text: '카드에도 영상과 같은 계정 표시(@s2ongrae)가 들어갑니다 — 옅은 흰 글씨로 오른쪽 아래에. 끄거나 문구·위치를 바꿀 수 있어요.' }));

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
      const canvas = drawCard(card, img, { theme: theme, filter: mem.feedFilter, brandName: ctx.BRANDS[ctx.state.brand].name, watermark: mem.watermark });
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
      const canvas = drawCard(card, img, { theme: theme, filter: mem.feedFilter, brandName: ctx.BRANDS[ctx.state.brand].name, watermark: mem.watermark });
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
