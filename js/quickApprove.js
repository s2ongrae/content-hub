/**
 * frontend/js/quickApprove.js — 모바일 10초 승인 카드 스택
 *
 * 목적: 이동 중 폰에서 "읽고 → 승인/반려"까지 10초.
 *  - 카드 1장에 판단에 필요한 것만: 브랜드 · 상호/주제 · 품질점수 · 핵심 3줄 · 단점 1줄
 *  - 하단 고정 액션바(엄지 영역 52px): [반려] [스킵] [✅ 승인]
 *  - 승인 1탭 = record_checklist + update_content(READY) 를 api.quickApprove 가 순서대로 수행
 *  - 처리 후 카드 즉시 사라지고 남은 건수 갱신
 *
 * 인스타 카드뉴스 초안 카드 (2026-11-26) — ig_feed_status='draft_ready' 인 카드는
 *   🖼️ 인스타 카드뉴스 N장 · 요약 · 드라이브 링크 · 3:4/4:5 미리보기 카드로 바뀌고,
 *   승인은 human_approved, 다시 쓰기는 queued 로 api.igCardApprove/igCardReject 가 보낸다.
 *   인스타 게시는 사람이 직접 한다(자동 발행 없음).
 *
 * 카드뉴스 2단계 (2026-11-27) — 미리보기 아래 [전체 저장]이 5~8장을 간격을 두고 순서대로
 *   PNG 로 내려받고, 카드마다 [저장]도 늘 남긴다(사파리가 여러 장을 막을 때의 폴백).
 *   저장 규칙은 js/cardExport.js 한 곳 — 스튜디오 피드도 같은 것을 쓴다.
 */

import { api } from './api.js';
import { friendlyError } from './uiState.js?v=20261126a';
import { drawCard, canvasToPng, downloadBlob, cardFileName, cardsFromSlides, cardPreset, CARD_THEME, CARD_WATERMARK_DEFAULT, loadImage, warmCardFonts } from './studioCanvas.js?v=20261128a';
import { saveCardsInOrder, exportHintText, exportProgressText, exportResultText, exportGapMs, isIosLike, CARD_EXPORT_GAP_MS } from './cardExport.js?v=20261127a';

export const QA_CARD_PHOTO_MAX = 8;         // 카드에 자동으로 앉히는 사진 장수 상한
const QA_UPLOAD_FETCH_MAX = 4 * 1024 * 1024;   // 한 장 4MB까지(브라우저가 올리기 전에 줄여 둔 사진)

/** 파일 이름 → 사진 MIME. 모르면 image/jpeg. */
export function photoMimeOf(name) {
  const n = String(name || '').toLowerCase();
  if (/\.png$/.test(n)) return 'image/png';
  if (/\.webp$/.test(n)) return 'image/webp';
  return 'image/jpeg';
}

/** base64 → 바이트. 조각을 이어 붙일 때 글자 경계에서 깨지지 않게 조각마다 돈다. */
export function base64ToBytes(b64) {
  const s = String(b64 || '');
  if (!s) return new Uint8Array(0);
  try {
    const bin = (typeof atob === 'function') ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) { return new Uint8Array(0); }
}

/** 카드 사진 배정 — 사진이 모자라면 처음으로 돌아가 다시 쓴다(같은 장이 연속으로는 안 나오게). */
export function photoForCard(index, total, count) {
  if (!count || count <= 0) return -1;
  const i = Math.max(0, Number(index) || 0);
  const n = Math.max(1, Number(total) || 1);
  if (n === 1) return 0;
  return i % count;
}

/**
 * 전체 저장 목록 — cardExport 는 카드를 복제해 넘기므로 원본 배열에서의 자리를 잊는다(2026-11-28 P0).
 *  복제본에 원본 자리(_saveIndex)를 실어 두고, 사진 배정은 그 자리로 한다. 원본 카드는 건드리지 않는다.
 *  nameOf(card, i) 로 파일 이름을 만든다(없으면 카드가 가진 name 그대로).
 */
export function cardsForSave(cards, nameOf) {
  const list = Array.isArray(cards) ? cards : [];
  return list.map((c, i) => Object.assign({}, c, {
    _saveIndex: i,
    name: typeof nameOf === 'function' ? String(nameOf(c, i) || '') : String((c && c.name) || '')
  }));
}

/** 저장 목록 항목의 원본 자리 — 없거나 이상하면 0, 범위 밖이면 마지막 장으로 자른다(안전한 기본). */
export function saveIndexOf(card, total) {
  const n = Number(card && card._saveIndex);
  if (!Number.isInteger(n) || n < 0) return 0;
  const t = Number(total);
  return (Number.isFinite(t) && t > 0) ? Math.min(n, t - 1) : n;
}

const BRAND_EMOJI = { daejeon_youth: '🍺 대전 청년', ppiyak_kimmary: '🐱 김메리' };
const BRAND_NAME = { daejeon_youth: '대전 청년', ppiyak_kimmary: '삐약 김메리' };

function brandNameOf(brand) { return BRAND_NAME[brand] || BRAND_NAME.daejeon_youth; }

/** 인스타 카드뉴스 초안 상태 — 승인 대기(draft_ready) · 승인됨(human_approved) */
const IG_READY = 'draft_ready';
const IG_APPROVED = 'human_approved';

/** 이 카드가 인스타 카드뉴스 초안인가: '' | 'ready' | 'approved' */
function igStateOf(item) {
  const s = String((item && item.ig_feed_status) || '');
  if (s === IG_READY) return 'ready';
  if (s === IG_APPROVED) return 'approved';
  return '';
}

export class QuickApproveView {
  constructor(rootEl, opts = {}) {
    this.root = rootEl;
    this.items = [];
    this.index = 0;
    this.busy = false;
    this.saving = false;            // 카드 PNG 전체 저장 중인가(중복 클릭 방지)
    this.onChanged = opts.onChanged || function () {};
    this.toast = opts.toast || function () {};
    this._keyHandler = null;
    this.igCache = {};              // content_id → { loading, feed, error } — 초안 요약(드라이브 payload) 캐시
    this.igPhotos = {};             // content_id → { loading, images, failed } — 승인 탭 카드 배경 사진 캐시(2026-11-28)
  }

  async mount() {
    this.root.replaceChildren();
    this.root.classList.add('quick-approve');

    const header = el('div', 'qa-header');
    this.countEl = el('span', 'qa-count', '승인할 카드 …');
    const reloadBtn = el('button', 'ghost-btn sm', '새로고침');
    reloadBtn.type = 'button';
    reloadBtn.addEventListener('click', () => this.reload());
    header.appendChild(this.countEl);
    header.appendChild(el('span', 'spacer'));
    header.appendChild(reloadBtn);
    this.root.appendChild(header);

    this.cardHost = el('div', 'qa-cards');
    this.root.appendChild(this.cardHost);

    this.actionBar = el('div', 'qa-actions');
    const rejectBtn = el('button', 'qa-btn qa-reject', '다시 쓰기');
    const skipBtn = el('button', 'qa-btn qa-skip', '보류');
    const approveBtn = el('button', 'qa-btn qa-approve', '✅ 승인');
    [rejectBtn, skipBtn, approveBtn].forEach((b) => { b.type = 'button'; });
    rejectBtn.addEventListener('click', () => this.reject());
    skipBtn.addEventListener('click', () => this.next());
    approveBtn.addEventListener('click', () => this.approve());
    this.rejectBtn = rejectBtn;
    this.approveBtn = approveBtn;
    this.actionBar.appendChild(rejectBtn);
    this.actionBar.appendChild(skipBtn);
    this.actionBar.appendChild(approveBtn);
    this.root.appendChild(this.actionBar);

    const kbd = el('p', 'qa-kbd', '키보드: ← 승인 · → 보류 · ↓ 다시 쓰기');
    this.root.appendChild(kbd);

    this._keyHandler = (ev) => {
      if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
      if (!this.root.isConnected) return;
      // 카드 내부나 액션바에 포커스가 있어도 동작하도록
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); this.approve(); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); this.next(); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); this.reject(); }
    };
    document.addEventListener('keydown', this._keyHandler);
    // 카드 호스트에도 포커스 가능하게 하고 키보드 이벤트 전달
    this.cardHost.setAttribute('tabindex', '0');
    this.cardHost.addEventListener('keydown', this._keyHandler);

    await this.reload();
  }

  unmount() {
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
  }

  async reload() {
    this.countEl.textContent = '불러오는 중…';
    this.cardHost.replaceChildren();
    this.igCache = {};
    try {
      const res = await api.listContents({ status: 'REVIEW', limit: 20 });
      this.items = (res.data && res.data.items) || [];
      this.index = 0;
      this.render();
    } catch (err) {
      this.items = [];
      this.countEl.textContent = '목록을 불러오지 못했어요';
      this.cardHost.appendChild(errorBox(this, err));
    }
  }

  current() {
    return this.items[this.index];
  }

  render() {
    this.cardHost.replaceChildren();
    const item = this.current();
    const left = this.items.length - this.index;
    this.countEl.textContent = item ? `승인할 원고 ${left}건` : '승인할 원고가 없어요';

    if (!item) {
      const box = el('div', 'qa-emptybox');
      box.style.cssText = 'margin:auto;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center';
      const text = el('p', 'qa-empty', '지금 승인할 원고가 없어요.\n제작 탭에서 새로 만들면 현황 보드에 쌓이고, 원고가 다 나오면 여기로 옵니다.');
      text.style.margin = '0';
      box.appendChild(text);
      const row = el('div', 'row');
      row.style.justifyContent = 'center';
      const go = el('button', 'btn sm primary', '제작으로 가기');
      const board = el('button', 'btn sm', '현황 보기');
      [go, board].forEach((b) => { b.type = 'button'; });
      go.addEventListener('click', () => { location.hash = '#/create'; });
      board.addEventListener('click', () => { location.hash = '#/board'; });
      row.appendChild(go);
      row.appendChild(board);
      box.appendChild(row);
      this.cardHost.appendChild(box);
      this.rejectBtn.disabled = true;
      this.approveBtn.disabled = true;
      return;
    }
    const ig = igStateOf(item);
    this.rejectBtn.disabled = false;
    this.approveBtn.disabled = ig === 'approved';
    this.approveBtn.textContent = ig === 'approved' ? '✅ 카드뉴스 승인됨' : (ig === 'ready' ? '✅ 카드뉴스 승인' : '✅ 승인');
    if (ig) {
      this.cardHost.appendChild(this.buildIgCard(item, ig));
      return;
    }

    const card = el('article', 'qa-card');
    const top = el('div', 'qa-top');
    top.appendChild(el('span', 'qa-brand', BRAND_EMOJI[item.brand] || item.brand));
    top.appendChild(el('strong', 'qa-title', item.place_name || item.content_id));
    top.appendChild(el('span', 'qa-score', item.quality_score ? `${item.quality_score}점` : '미채점'));
    card.appendChild(top);

    card.appendChild(el('p', 'qa-meta',
      [item.cluster_id, item.region_dong, item.content_id].filter(Boolean).join(' · ')));

    const summary = el('div', 'qa-summary');
    summary.appendChild(el('p', 'qa-line', item.blog_title || '(제목 미정)'));

    const preview = item.preview || null;
    if (preview && preview.hook) {
      summary.appendChild(el('p', 'qa-line dim', preview.hook));
    }
    if (preview && Array.isArray(preview.facts) && preview.facts.length) {
      const facts = el('div', 'qa-facts');
      preview.facts.slice(0, 3).forEach((f) => {
        const row = el('div', 'qa-fact');
        row.appendChild(el('b', null, '핵심'));
        row.appendChild(el('span', null, f));
        facts.appendChild(row);
      });
      summary.appendChild(facts);
    }
    if (preview && preview.weak) {
      const row = el('div', 'qa-fact');
      row.appendChild(el('b', null, '단점'));
      row.appendChild(el('span', null, preview.weak));
      summary.appendChild(row);
    }
    card.appendChild(summary);

    card.appendChild(el('p', 'qa-meta', channelLine(item)));
    this.cardHost.appendChild(card);
  }

  /**
   * 인스타 카드뉴스 초안 카드 (2026-11-26) — 🖼️ N장 · 요약 · 드라이브 링크 · 3:4/4:5 미리보기.
   * 승인하면 ig_feed_status 만 human_approved 로 바뀌고, 인스타 게시는 사람이 직접 한다.
   */
  buildIgCard(item, ig) {
    const count = Number(item.ig_carousel_count) || 0;
    const card = el('article', 'qa-card qa-card-ig');

    const top = el('div', 'qa-top');
    top.appendChild(el('span', 'qa-brand', BRAND_EMOJI[item.brand] || item.brand));
    top.appendChild(el('strong', 'qa-title', item.place_name || item.content_id));
    top.appendChild(el('span', 'qa-score', ig === 'approved' ? '승인함' : '카드뉴스'));
    card.appendChild(top);

    card.appendChild(el('p', 'qa-meta',
      [item.cluster_id, item.region_dong, item.content_id].filter(Boolean).join(' · ')));

    const summary = el('div', 'qa-summary');
    summary.appendChild(el('p', 'qa-line', `🖼️ 인스타 카드뉴스 ${count}장`));
    const lineEl = el('p', 'qa-line dim', '초안을 읽고 있어요…');
    summary.appendChild(lineEl);
    const tagsEl = el('p', 'qa-line dim', '');
    summary.appendChild(tagsEl);
    card.appendChild(summary);

    const links = el('div', 'row qa-ig-links');
    const driveUrl = String(item.media_drive_url || '').trim();
    if (driveUrl) {
      const a = el('a', 'qa-link', '↗ 드라이브에서 초안 보기');
      a.href = driveUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      links.appendChild(a);
    }
    const pv45 = el('button', 'ghost-btn sm', '4:5 미리보기');
    const pv34 = el('button', 'ghost-btn sm', '3:4 미리보기');
    [pv45, pv34].forEach((b) => { b.type = 'button'; });
    links.appendChild(pv45);
    links.appendChild(pv34);
    card.appendChild(links);

    const previewHost = el('div', 'qa-ig-preview');
    card.appendChild(previewHost);

    card.appendChild(el('p', 'qa-meta', ig === 'approved'
      ? '승인한 초안입니다. 인스타에는 직접 올립니다(자동 발행 없음).'
      : '승인하면 이 카드의 피드만 승인으로 바뀝니다. 인스타 게시는 직접 합니다.'));

    const open = (aspect) => {
      const st = this.igCache[item.content_id];
      if (!st || !st.feed) {
        this.toast('초안을 아직 읽지 못했어요 — 드라이브에서 확인하세요', 'err');
        return;
      }
      this.paintPreview(previewHost, item, st.feed, aspect);
    };
    pv45.addEventListener('click', () => open('4:5'));
    pv34.addEventListener('click', () => open('3:4'));

    this.fillIgCard(item, lineEl, tagsEl);
    return card;
  }

  /** 목록에는 요약이 없다 — 카드 payload(ig_feed)를 한 번만 읽어 요약·해시태그를 채운다. */
  async ensureIgDetail(item) {
    const id = item.content_id;
    const cached = this.igCache[id];
    if (cached && !cached.loading) return cached;
    this.igCache[id] = { loading: true, feed: null };
    try {
      const res = await api.getContentDetail(id);
      const feed = (res && res.data && res.data.payload && res.data.payload.ig_feed) || null;
      this.igCache[id] = { loading: false, feed: feed };
    } catch (err) {
      this.igCache[id] = { loading: false, feed: null, error: err };
    }
    return this.igCache[id];
  }

  async fillIgCard(item, lineEl, tagsEl) {
    const st = await this.ensureIgDetail(item);
    if (!lineEl || lineEl.isConnected === false) return;
    if (!st.feed) {
      lineEl.textContent = st.error
        ? friendlyError(st.error)
        : '초안 요약을 읽지 못했어요 — 드라이브에서 확인하세요';
      lineEl.classList.add('qa-warn');
      return;
    }
    const feed = st.feed;
    const first = Array.isArray(feed.slides) && feed.slides[0] ? String(feed.slides[0].headline || '') : '';
    lineEl.textContent = String(feed.summary || feed.hook || first || '');
    lineEl.classList.remove('qa-warn');
    const bits = [];
    if (Array.isArray(feed.hashtags) && feed.hashtags.length) bits.push(feed.hashtags.join(' '));
    if (feed.flags && feed.flags.fact_placeholder) bits.push('확인 안 된 값은 빈칸으로 두었어요');
    if (tagsEl) tagsEl.textContent = bits.join(' · ');
  }

  /**
   * 카드에 딸린 사진(카드 드라이브 폴더의 photo 업로드)을 브라우저 이미지로 읽는다. (2026-11-28)
   *  드라이브는 비공개라 <img src> 로 못 부른다(CSP img-src 'self') — upload_video_fetch 조각을 받아 Blob URL 로 만든다.
   *  실패해도 화면은 산다(사진 없이 4타입 단색 폴백으로 그린다).
   */
  async loadCardPhotos(item) {
    const id = item.content_id;
    const cached = this.igPhotos[id];
    if (cached && !cached.loading) return cached;
    const state = { loading: true, images: [], failed: false };
    this.igPhotos[id] = state;
    let images = [];
    try {
      const res = await api.post('upload_video_list', { content_id: id });
      const items = (res && res.data && Array.isArray(res.data.items)) ? res.data.items : [];
      const photos = items
        .filter((it) => it && it.kind === 'photo' && it.complete !== false && Number(it.size || 0) <= QA_UPLOAD_FETCH_MAX)
        .sort((a, b) => (String(a.name) < String(b.name) ? -1 : (String(a.name) > String(b.name) ? 1 : 0)))
        .slice(0, QA_CARD_PHOTO_MAX);
      for (let i = 0; i < photos.length; i += 1) {
        const img = await this.fetchCardPhoto(id, photos[i]);
        if (img) images.push(img);
      }
    } catch (err) {
      state.failed = true;
      images = [];
    }
    state.images = images;
    state.loading = false;
    return state;
  }

  /** 사진 한 장(조각 여러 개면 이어 붙인다) → 그릴 수 있는 Image. 실패하면 null. */
  async fetchCardPhoto(contentId, up) {
    const parts = Math.max(1, Math.min(800, Number(up && up.parts) || 1));
    const chunks = [];
    for (let i = 0; i < parts; i += 1) {
      const res = await api.post('upload_video_fetch', { content_id: contentId, name: up.name, parts: parts, index: i });
      const bytes = base64ToBytes(res && res.data && res.data.data);
      if (!bytes.length) return null;
      chunks.push(bytes);
    }
    try {
      if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
      const url = URL.createObjectURL(new Blob(chunks, { type: photoMimeOf(up.name) }));
      const img = await loadImage(url);
      try { URL.revokeObjectURL(url); } catch (e) { /* 이미 그렸다 */ }
      return img;
    } catch (e) { return null; }
  }

  /** 3:4 · 4:5 미리보기 — 초안 슬라이드를 그 비율의 카드로 그려 보여 준다.
   *  사진은 먼저 캐시된 것만으로 바로 그리고, 아직이면 읽어 온 뒤 한 번 다시 그린다(2026-11-28). */
  paintPreview(host, item, feed, aspect) {
    const cached = this.igPhotos[item.content_id];
    this.renderPreviewCards(host, item, feed, aspect, (cached && cached.images) || []);
    // 폰트가 늦게 오면 한 번 다시 그린다(머리 없는 브라우저·느린 회선에서 첫 그림이 콜백 글꼴이 된다)
    if (typeof document !== 'undefined' && document.fonts) {
      warmCardFonts().then(() => {
        if (!host.isConnected) return;
        const st = this.igPhotos[item.content_id];
        this.renderPreviewCards(host, item, feed, aspect, (st && st.images) || []);
      }).catch(() => {});
    }
    if (!cached || cached.loading) {
      this.loadCardPhotos(item).then((st) => {
        if (!host.isConnected) return;
        const line = host.querySelector ? host.querySelector('.qa-ig-photos') : null;
        if (line && line.isConnected !== false) line.textContent = this.photoLineText(st);
        if (st && st.images && st.images.length) this.renderPreviewCards(host, item, feed, aspect, st.images);
      }).catch(() => {});
    }
  }

  photoLineText(st) {
    const n = (st && st.images) ? st.images.length : 0;
    if (n) return `카드 사진 ${n}장을 4타입 레이아웃에 앉혔습니다 — 저장하면 이 카드 그대로 내려받힙니다.`;
    return (st && st.failed) ? '카드 사진을 읽지 못해 글자 카드로 그립니다(저장은 그대로 됩니다).' : '카드에 올린 사진이 없어 글자 카드로 그립니다.';
  }

  renderPreviewCards(host, item, feed, aspect, images) {
    host.replaceChildren();
    const preset = cardPreset(aspect);
    const cards = cardsFromSlides(feed.slides);
    if (!cards.length) {
      host.appendChild(el('p', 'qa-meta', '초안에 슬라이드가 없습니다'));
      return;
    }
    const theme = CARD_THEME[item.brand] || CARD_THEME.daejeon_youth;
    const head = el('div', 'row qa-ig-head');
    head.appendChild(el('span', 'qa-meta', `${preset.label} · ${preset.width}×${preset.height} 미리보기`));
    const saveBtn = el('button', 'ghost-btn sm', '전체 저장');
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', () => this.savePreview(cards, item, preset, theme, saveBtn));
    head.appendChild(saveBtn);
    host.appendChild(head);
    // 아이폰·사파리는 여러 장 저장을 막을 수 있다 — 시작 전에 폴백을 알려 준다.
    host.appendChild(el('p', 'qa-meta qa-ig-hint', exportHintText(cards.length, { ios: isIosLike(uaText()) })));
    host.appendChild(el('p', 'qa-meta qa-ig-photos', this.photoLineText(this.igPhotos[item.content_id] || { images: images })));

    const grid = el('div', 'qa-ig-cards');
    cards.forEach((c, i) => {
      const pi = photoForCard(i, cards.length, images.length);
      const canvas = drawCard(c, pi >= 0 ? images[pi] : null, {
        theme: theme, aspect: preset.id, brandName: brandNameOf(item.brand), watermark: CARD_WATERMARK_DEFAULT, index: i, total: cards.length, type: c.type
      });
      const holder = el('div', 'qa-ig-card');
      holder.appendChild(canvas || el('div', 'qa-ig-card-fallback', '카드를 그리지 못했어요'));
      holder.appendChild(el('span', 'qa-ig-cap', `0${c.no} ${c.headline}`));
      // 폴백 — 한 장씩 저장. 여러 장이 막히는 브라우저에서도 이 버튼은 남는다.
      const one = el('button', 'ghost-btn sm qa-ig-save', '저장');
      one.type = 'button';
      one.addEventListener('click', () => this.saveOne(c, item, preset, theme, i, cards.length));
      holder.appendChild(one);
      grid.appendChild(holder);
    });
    host.appendChild(grid);
  }

  /** 카드 한 장만 저장 — 여러 장이 막힐 때 쓰는 폴백. */
  async saveOne(card, item, preset, theme, index, total) {
    const st = this.igPhotos[item.content_id];
    const images = (st && st.images) || [];
    const i = Number.isFinite(Number(index)) ? Number(index) : 0;
    const pi = photoForCard(i, Number(total) || 1, images.length);
    const canvas = drawCard(card, pi >= 0 ? images[pi] : null, {
      theme: theme, aspect: preset.id, brandName: brandNameOf(item.brand), watermark: CARD_WATERMARK_DEFAULT, index: i, total: Number(total) || 1, type: card.type
    });
    const blob = canvas ? await canvasToPng(canvas) : null;
    const name = cardFileName(item.place_name, `${card.no}_${preset.id.replace(':', 'x')}`);
    if (blob && downloadBlob(blob, name)) this.toast(name + ' 저장을 시작했습니다', 'ok');
    else this.toast('저장하지 못했어요 — 브라우저를 확인하세요', 'err');
  }

  /**
   * 카드 전체 저장 — 간격을 두고 순서대로(cardExport.saveCardsInOrder).
   *  한 장이 막혀도 나머지를 계속하고, 끝나면 시도 결과만 말한다(브라우저가 저장 여부를 알려 주지 않는다).
   */
  async savePreview(cards, item, preset, theme, btn) {
    if (this.saving) { this.toast('카드를 저장하는 중입니다', 'ok'); return; }
    this.saving = true;
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = exportProgressText(1, cards.length); }
    let res = null;
    try {
      res = await saveCardsInOrder({
        cards: cardsForSave(cards, (c) => cardFileName(item.place_name, `${c.no}_${preset.id.replace(':', 'x')}`)),
        render: (c) => {
          // 복제본이라 indexOf 로는 자리를 못 찾는다 — 저장 목록에 실어 둔 원본 자리로 사진을 고른다(2026-11-28 P0)
          const i = saveIndexOf(c, cards.length);
          const st = this.igPhotos[item.content_id];
          const images = (st && st.images) || [];
          const pi = photoForCard(i, cards.length, images.length);
          const canvas = drawCard(c, pi >= 0 ? images[pi] : null, {
            theme: theme, aspect: preset.id, brandName: brandNameOf(item.brand), watermark: CARD_WATERMARK_DEFAULT, index: i, total: cards.length
          });
          return canvas ? canvasToPng(canvas) : null;
        },
        save: (blob, name) => downloadBlob(blob, name),
        gapMs: exportGapMs(CARD_EXPORT_GAP_MS),
        onProgress: (p) => { if (btn) btn.textContent = exportProgressText(p.index, p.total); },
        isCancelled: () => !!(btn && btn.isConnected === false)
      });
    } finally {
      this.saving = false;
      if (btn) { btn.disabled = false; btn.textContent = label || '전체 저장'; }
    }
    const text = exportResultText(res);
    this.toast(text, res && res.saved > 0 ? 'ok' : 'err');
  }

  async approve() {
    if (this.busy || !this.current()) return;
    const item = this.current();
    const ig = igStateOf(item);
    if (ig === 'approved') { this.toast('이미 승인한 카드뉴스입니다', 'ok'); return; }
    this.busy = true;
    this.actionBar.classList.add('busy');
    try {
      if (ig === 'ready') {
        // 인스타 피드 초안은 승인(human_approved)만 기록한다 — 인스타 게시는 사람이 직접(자동 발행 없음)
        await api.igCardApprove(item.content_id);
        item.ig_feed_status = IG_APPROVED;
        this.render();
        this.toast(`${item.place_name || item.content_id} 인스타 카드뉴스 → 승인`, 'ok');
        this.onChanged();
        return;
      }
      await api.quickApprove(item.content_id, {
        channel: item.blog_status === 'SKIPPED' ? 'youtube_shorts' : 'naver_blog'
      });
      this.items.splice(this.index, 1);
      if (this.index >= this.items.length) this.index = Math.max(0, this.items.length - 1);
      this.render();
      this.toast(`${item.place_name || item.content_id} → 발행 준비`, 'ok');
      this.onChanged();
    } catch (err) {
      this.toast(friendlyError(err), 'err');
      // 다른 곳에서 먼저 고쳤으면 이 카드는 낡은 것이다 — 목록을 최신으로 다시 읽는다
      if (err && err.code === 'ERR_VERSION_CONFLICT') this.reload();
    } finally {
      this.busy = false;
      this.actionBar.classList.remove('busy');
    }
  }

  async reject() {
    if (this.busy || !this.current()) return;
    const item = this.current();
    const ig = igStateOf(item);
    const reason = prompt(ig
      ? '카드뉴스에서 어떤 점을 고칠까요? (한 줄) — 예: 3장 가격이 사실과 달라요'
      : '어떤 점을 고칠까요? (한 줄) — 예: 말투, 사실관계, 첫 문장이 약함') || '대표님 다시 쓰기';
    this.busy = true;
    this.actionBar.classList.add('busy');
    try {
      if (ig) {
        // 반려 = queued — 다음 밤 초안이 다시 만들어진다
        await api.igCardReject(item.content_id, reason);
        this.items.splice(this.index, 1);
        if (this.index >= this.items.length) this.index = Math.max(0, this.items.length - 1);
        this.render();
        this.toast(`카드뉴스 다시 쓰기: ${reason}`, 'ok');
        this.onChanged();
        return;
      }
      await api.quickReject(item.content_id, reason);
      this.items.splice(this.index, 1);
      if (this.index >= this.items.length) this.index = Math.max(0, this.items.length - 1);
      this.render();
      this.toast(`다시 쓰기: ${reason}`, 'ok');
      this.onChanged();
    } catch (err) {
      this.toast(friendlyError(err), 'err');
    } finally {
      this.busy = false;
      this.actionBar.classList.remove('busy');
    }
  }

  next() {
    if (this.items.length < 2) return;
    this.index = (this.index + 1) % this.items.length;
    this.render();
  }
}

function channelLine(item) {
  const map = [
    ['블로그', item.blog_status],
    ['쇼츠', item.shorts_status],
    ['릴스', item.reels_status],
    ['피드', item.ig_feed_status],
    ['클립', item.clip_status],
    ['당근', item.daangn_status]
  ];
  return map.filter((m) => m[1] && m[1] !== 'SKIPPED').map((m) => `${m[0]} ${statusKo(m[1])}`).join(' · ');
}

function statusKo(s) {
  if (!s) return '-';
  if (s === 'SKIPPED') return '건너뜀';
  if (s === 'PENDING') return '대기';
  if (s === 'UPLOADED') return '완료';
  if (s === 'PUBLISHED') return '발행';
  if (s === IG_READY) return '초안 완료';
  if (s === IG_APPROVED) return '승인';
  if (s === 'drafting') return '작성 중';
  if (s === 'queued') return '대기';
  return s;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;   // innerHTML 금지
  return node;
}

/** 이 브라우저의 사용자 에이전트 — 아이폰·사파리면 저장 안내를 더 분명히 한다. */
function uaText() {
  try { return (typeof navigator !== 'undefined' && navigator && navigator.userAgent) || ''; } catch (e) { return ''; }
}

/** 목록을 못 읽었을 때 — 사람 말로 사유를 보여 주고 [다시 시도]를 붙인다. */
function errorBox(view, err) {
  const box = el('div', 'qa-errorbox');
  box.style.cssText = 'margin:auto;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center;max-width:420px';
  box.setAttribute('role', 'alert');
  box.appendChild(el('p', 'qa-empty', friendlyError(err) || '목록을 불러오지 못했어요.'));
  const retry = el('button', 'btn sm primary', '다시 시도');
  retry.type = 'button';
  retry.addEventListener('click', () => view.reload());
  const board = el('button', 'btn sm', '현황 보기');
  board.type = 'button';
  board.addEventListener('click', () => { location.hash = '#/board'; });
  const row = el('div', 'row');
  row.style.justifyContent = 'center';
  row.appendChild(retry);
  row.appendChild(board);
  box.appendChild(row);
  return box;
}
