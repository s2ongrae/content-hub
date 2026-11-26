/**
 * frontend/js/quickApprove.js — 모바일 10초 승인 카드 스택
 *
 * 목적: 이동 중 폰에서 "읽고 → 승인/반려"까지 10초.
 *  - 카드 1장에 판단에 필요한 것만: 브랜드 · 상호/주제 · 품질점수 · 핵심 3줄 · 단점 1줄
 *  - 하단 고정 액션바(엄지 영역 52px): [반려] [스킵] [✅ 승인]
 *  - 승인 1탭 = record_checklist + update_content(READY) 를 api.quickApprove 가 순서대로 수행
 *  - 처리 후 카드 즉시 사라지고 남은 건수 갱신
 */

import { api } from './api.js';
import { friendlyError } from './uiState.js?v=20261126a';

const BRAND_EMOJI = { daejeon_youth: '🍺 대전 청년', ppiyak_kimmary: '🐱 김메리' };

export class QuickApproveView {
  constructor(rootEl, opts = {}) {
    this.root = rootEl;
    this.items = [];
    this.index = 0;
    this.busy = false;
    this.onChanged = opts.onChanged || function () {};
    this.toast = opts.toast || function () {};
    this._keyHandler = null;
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
    this.rejectBtn.disabled = false;
    this.approveBtn.disabled = false;

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

  async approve() {
    if (this.busy || !this.current()) return;
    const item = this.current();
    this.busy = true;
    this.actionBar.classList.add('busy');
    try {
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
    const reason = prompt('어떤 점을 고칠까요? (한 줄) — 예: 말투, 사실관계, 첫 문장이 약함') || '대표님 다시 쓰기';
    this.busy = true;
    this.actionBar.classList.add('busy');
    try {
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
  return s;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;   // innerHTML 금지
  return node;
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
