/**
 * js/draftView.js — 카드 상세 '작성본' 탭 (2026-11-19)
 *
 * 왜 있나: 초안 카드에서 "무슨 내용인지" 알 수 없다는 지적(11/19) 뒤에 만든 화면.
 *  - 초안·작성 중·확인 대기·수정 중 카드는 상세가 이 탭으로 바로 열린다.
 *  - 있는 채널의 본문·대본을 글로 읽고, [본문 복사]로 폰에서 바로 붙여 쓴다.
 *  - 본문이 아예 없으면 그 사실을 크게 보여 주고, 붙여넣어 넣을 수 있게 한다.
 *
 * 데이터는 Drive payload 의 채널 키(blog·shorts·reels·ig_feed·clip·daangn)를 그대로 쓴다.
 * 서버·시트 스키마 변경 없음 — update_content 의 patch(최상위 키 교체)로만 저장한다.
 */

import { api } from './api.js';

/* 채널 순서는 길게 쓰는 글 → 짧은 영상 순. 라벨은 화면 말(쉬운 한국어). */
const CHANNELS = [
  { key: 'blog', label: '블로그', st: 'blog_status' },
  { key: 'shorts', label: '쇼츠', st: 'shorts_status' },
  { key: 'reels', label: '릴스', st: 'reels_status' },
  { key: 'ig_feed', label: '피드', st: 'ig_feed_status' },
  { key: 'clip', label: '클립', st: 'clip_status' },
  { key: 'daangn', label: '당근', st: 'daangn_status' }
];

const DRAFTISH = ['DRAFT', 'DRAFTING', 'GENERATING', 'REVIEW', 'EDITING'];

const STAGE_LABEL = {
  DRAFT: '초안', DRAFTING: '작성 중', GENERATING: '작성 중', REVIEW: '내용 확인',
  EDITING: '수정 중', READY: '올릴 준비', NEEDS_HUMAN: '확인 필요', PARTIAL_FAIL: '일부 실패'
};

/** 화면에 쓸 본문 후보 — 채널마다 부르는 이름이 다르다(body·script·caption·text) */
const BODY_KEYS = ['body', 'script', 'caption', 'text', 'description'];

function docOf(payload, key) {
  const d = payload && payload[key];
  return (d && typeof d === 'object') ? d : null;
}

function bodyOf(doc) {
  if (!doc) return '';
  for (const k of BODY_KEYS) {
    if (typeof doc[k] === 'string' && doc[k].trim()) return doc[k];
  }
  return '';
}

function chars(s) {
  return Array.from(String(s || '').replace(/\s+/g, ' ').trim()).length;
}

/** 본문이 있는 첫 채널의 글. 없으면 ''. (카드 요약은 제목과 겹치지 않게 본문만 쓴다) */
export function draftTextOf(payload) {
  for (const c of CHANNELS) {
    const body = bodyOf(docOf(payload, c.key));
    if (body.trim()) return body;
  }
  return '';
}

/** 제목만 있고 본문은 없는가 — 보드에서 '제목만 있음'과 '아무것도 없음'을 구분한다. */
export function draftTitleOnly(payload) {
  if (draftTextOf(payload).trim()) return false;
  return CHANNELS.some((c) => {
    const doc = docOf(payload, c.key);
    return !!(doc && String(doc.title || '').trim());
  });
}

/** 보드 카드에 넣을 미리보기 — 두 줄 정도로 자른다. */
export function draftPreview(payload, max = 90) {
  const text = draftTextOf(payload).replace(/\s+/g, ' ').trim();
  if (!text) return { text: '', empty: true, chars: 0, titleOnly: draftTitleOnly(payload) };
  const arr = Array.from(text);
  return {
    text: arr.length > max ? arr.slice(0, max).join('') + '…' : text,
    empty: false,
    chars: chars(text),
    titleOnly: false
  };
}

async function copyText(text, toast) {
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했어요 — 네이버·인스타에 붙여넣으면 됩니다', 'ok');
    return;
  } catch (e) { /* 아래 폴백 */ }
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.opacity = '0';
  document.body.appendChild(box);
  box.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  box.remove();
  toast(ok ? '복사했어요' : '복사가 막혔어요 — 길게 눌러 직접 복사해 주세요', ok ? 'ok' : 'err');
}

/* ─────────────────────────── 본체 ─────────────────────────── */

export function draftSection(ctx) {
  const { h, detail, meta, toast, onChanged, allowed } = ctx;
  const payload = Object.assign({}, detail.payload || {});
  const contentId = detail.content_id || meta.content_id;
  const chans = CHANNELS.filter((c) => !allowed || allowed.indexOf(c.key) >= 0);
  const skipped = (c) => meta[c.st] === 'SKIPPED';

  /* 기본 채널: 내용이 있는 첫 채널 → 없으면 열려 있는 첫 채널 */
  const withBody = chans.filter((c) => {
    const doc = docOf(payload, c.key);
    return doc && (bodyOf(doc) || String(doc.title || '').trim());
  });
  let cur = (withBody[0] || chans.find((c) => !skipped(c)) || chans[0] || CHANNELS[0]).key;

  const wrap = h('section', { class: 'draft' });
  const chips = h('div', { class: 'draft-chips', role: 'tablist', 'aria-label': '채널별 작성본' });
  const view = h('div', { class: 'draft-body' });
  const acts = h('div', { class: 'draft-acts' });
  const editor = h('div', { class: 'draft-editor', hidden: true });
  wrap.appendChild(chips);
  wrap.appendChild(view);
  wrap.appendChild(acts);
  wrap.appendChild(editor);

  const save = async (patch, extra) => {
    const body = Object.assign({
      content_id: contentId,
      expected_version: detail.version,
      patch
    }, extra || {});
    const res = await api.updateContent(body);
    const d = res.data || {};
    if (d.version) detail.version = d.version;
    if (d.status && meta) meta.status = d.status;
    if (extra && extra.status && meta) meta.status = extra.status;
    toast('저장했어요', 'ok');
    if (onChanged) onChanged();
    return res;
  };

  const moveTo = async (status, patch) => {
    try {
      await save(patch || {}, { status });
      const doc = docOf(payload, cur);
      if (doc && patch && patch[cur]) payload[cur] = patch[cur];
      paint();
    } catch (err) {
      toast(err && err.code === 'ERR_VERSION_CONFLICT'
        ? '다른 곳에서 먼저 바뀌었어요 — 창을 닫고 다시 열어 주세요'
        : '옮기지 못했어요: ' + ((err && err.message) || (err && err.code) || err), 'err');
    }
  };

  /* ── 채널 칩 ── */
  const paintChips = () => {
    chips.replaceChildren();
    chans.forEach((c) => {
      const doc = docOf(payload, c.key);
      const has = !!(doc && (bodyOf(doc) || String(doc.title || '').trim()));
      chips.appendChild(h('button', {
        class: 'draft-chip' + (c.key === cur ? ' on' : '') + (has ? ' has' : ''),
        type: 'button', role: 'tab', 'aria-selected': c.key === cur ? 'true' : 'false',
        title: has ? c.label + ' 작성본 있음' : c.label + ' 작성본 아직 없음',
        onclick: () => { cur = c.key; paintChips(); paintView(); }
      }, h('span', { class: 'dc-dot', 'aria-hidden': 'true' }), h('span', { text: c.label })));
    });
  };

  /* ── 본문 보기 ── */
  const paintView = () => {
    view.replaceChildren();
    const c = chans.find((x) => x.key === cur) || CHANNELS[0];
    const doc = docOf(payload, c.key);
    const body = bodyOf(doc);
    const title = String((doc && doc.title) || '').trim();

    if (!doc || (!body && !title)) {
      view.appendChild(emptyState(c));
    } else {
      view.appendChild(h('div', { class: 'db-head' },
        h('span', { class: 'db-chan', text: c.label }),
        h('span', { text: body ? Array.from(body.trim()).length.toLocaleString() + '자' : '본문 비어 있음' }),
        doc.updated_at ? h('span', { text: '저장 ' + rel(doc.updated_at) }) : null));
      if (title) view.appendChild(h('div', { class: 'db-title', text: title }));
      if (body) {
        view.appendChild(h('div', { class: 'db-text' },
          body.split(/\n{2,}/).map((para) => h('p', { text: para }))));
      } else {
        view.appendChild(h('p', { class: 'db-note', text: '제목만 있고 본문은 비어 있어요. [고치기]로 붙여넣어 주세요.' }));
      }
      if (Array.isArray(doc.hashtags) && doc.hashtags.length) {
        view.appendChild(h('div', { class: 'db-tags', text: doc.hashtags.join(' ') }));
      }
      if (doc.note) view.appendChild(h('p', { class: 'db-note', text: '메모: ' + doc.note }));
    }
  };

  /** 본문이 없을 때 — 왜 없는지(임시저장 메모)까지 보여 주고 넣는 길을 준다 */
  function emptyState(c) {
    const cap = (payload.capture && typeof payload.capture === 'object') ? payload.capture : {};
    const note = String(cap.draft_note || '').trim();
    const src = String(cap.draft_source || '').trim();
    const box = h('div', { class: 'db-empty' },
      h('div', { class: 'dbe-icon', 'aria-hidden': 'true', text: '📝' }),
      h('div', { class: 'dbe-title', text: c.label + ' 작성본이 아직 없어요' }),
      h('p', { class: 'dbe-hint', text: '허브에는 이 카드의 제목·메모만 들어 있습니다. 본문·대본을 붙여넣으면 여기 저장되고, 보드 카드에도 첫 줄이 보입니다.' }));
    if (src || note) {
      box.appendChild(h('p', { class: 'dbe-meta', text: [src, note].filter(Boolean).join(' · ') }));
    }
    box.appendChild(h('button', {
      class: 'btn sm primary', type: 'button', text: '＋ ' + c.label + ' 본문 붙여넣기',
      onclick: () => openEditor(c.key)
    }));
    return box;
  }

  /* ── 편집기 ── */
  function openEditor(key) {
    const c = chans.find((x) => x.key === key) || CHANNELS[0];
    const doc = docOf(payload, c.key) || {};
    editor.replaceChildren();
    const titleIn = h('input', { type: 'text', value: doc.title || (key === 'blog' ? (meta.blog_title || '') : ''), placeholder: '제목 (없어도 됩니다)', autocomplete: 'off' });
    const bodyIn = h('textarea', { rows: '14', placeholder: c.label + ' 본문 또는 대본·캡션을 붙여넣으세요' });
    bodyIn.value = bodyOf(doc);
    const tagIn = h('input', { type: 'text', value: (doc.hashtags || []).join(' '), placeholder: '해시태그 (선택)', autocomplete: 'off' });
    const urlIn = h('input', { type: 'url', value: doc.draft_url || '', placeholder: '임시저장 주소 (선택)', autocomplete: 'off' });
    const err = h('p', { class: 'hint', text: '' });
    const btn = h('button', { class: 'btn sm primary', type: 'button', text: '저장' });

    btn.addEventListener('click', async () => {
      const text = String(bodyIn.value || '').trim();
      const tags = String(tagIn.value || '').split(/[,\s]+/).map((t) => t.trim()).filter(Boolean)
        .map((t) => (t[0] === '#' ? t : '#' + t));
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = '저장 중…';
      err.textContent = '';
      const next = {
        title: String(titleIn.value || '').trim(),
        body: String(bodyIn.value || ''),
        hashtags: tags,
        updated_at: new Date().toISOString()
      };
      if (String(urlIn.value || '').trim()) next.draft_url = String(urlIn.value).trim();
      try {
        await save({ [key]: next });
        payload[key] = next;
        if (key === 'blog' && next.title && !String(meta.blog_title || '').trim()) {
          /* 시트 제목이 비어 있던 카드는 제목도 같이 채운다(보드에서 '(제목 없음)'으로 안 보이게) */
          try {
            await api.updateContent({ content_id: contentId, expected_version: detail.version, blog_title: next.title });
            meta.blog_title = next.title;
          } catch (e) { /* 제목은 보조 — 실패해도 본문 저장은 살아 있다 */ }
        }
        editor.hidden = true;
        paintChips();
        paintView();
        paintActs();
        toast('작성본을 저장했어요', 'ok');
      } catch (e2) {
        err.textContent = (e2 && e2.code === 'ERR_VERSION_CONFLICT')
          ? '다른 곳에서 먼저 바뀌었어요 — 창을 닫고 다시 열어 주세요'
          : '저장하지 못했어요: ' + ((e2 && e2.message) || (e2 && e2.code) || e2);
        btn.disabled = false;
        btn.textContent = label;
      }
    });

    editor.appendChild(h('div', { class: 'de-head' },
      h('strong', { text: c.label + ' 작성본 넣기·고치기' }),
      h('button', { class: 'ghost-btn', type: 'button', text: '닫기', onclick: () => { editor.hidden = true; } })));
    editor.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '제목' }), titleIn));
    editor.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '본문·대본' }), bodyIn));
    editor.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '해시태그' }), tagIn));
    editor.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '임시저장 주소' }), urlIn));
    editor.appendChild(err);
    editor.appendChild(h('div', { class: 'row' }, btn));
    editor.hidden = false;
    bodyIn.focus();
  }

  /* ── 아래 버튼줄: 복사·임시저장·고치기 + 단계 옮기기 ── */
  const paintActs = () => {
    acts.replaceChildren();
    const c = chans.find((x) => x.key === cur) || CHANNELS[0];
    const doc = docOf(payload, c.key);
    const body = bodyOf(doc);
    const title = String((doc && doc.title) || '').trim();
    const status = String(meta.status || '');

    const row = h('div', { class: 'da-row' });
    if (body || title) {
      row.appendChild(h('button', {
        class: 'btn sm primary', type: 'button', text: '본문 복사',
        onclick: () => copyText([title, body].filter(Boolean).join('\n\n'), toast)
      }));
      if (doc && doc.draft_url) {
        row.appendChild(h('a', { class: 'btn sm', href: doc.draft_url, target: '_blank', rel: 'noopener noreferrer', text: '임시저장 열기' }));
      }
      row.appendChild(h('button', { class: 'btn sm', type: 'button', text: '고치기', onclick: () => openEditor(cur) }));
    }
    /* 본문이 없을 때는 빈 상태 상자가 이미 [붙여넣기] 버튼을 준다 — 아래 줄에 또 두지 않는다 */
    if (row.childNodes.length) acts.appendChild(row);

    const flow = h('div', { class: 'da-row flow' });
    if (status === 'DRAFT' || status === 'DRAFTING' || status === 'GENERATING' || status === 'EDITING') {
      if (body || title) {
        flow.appendChild(h('button', {
          class: 'btn sm', type: 'button', text: '내용 확인으로 보내기',
          onclick: () => moveTo('REVIEW')
        }));
      }
      if (status === 'DRAFT' && (body || title)) {
        flow.appendChild(h('button', {
          class: 'btn sm ghost', type: 'button', text: '작성 중으로 표시',
          onclick: () => moveTo('DRAFTING')
        }));
      }
    } else if (status === 'REVIEW') {
      flow.appendChild(h('button', {
        class: 'btn sm ghost', type: 'button', text: '고칠 점 적기',
        onclick: () => {
          const memo = window.prompt('고칠 점을 한 줄로 적어 주세요 (카드 메모에 남습니다)');
          if (memo == null) return;
          const t = String(memo).trim();
          if (!t) return;
          const nextBlog = docOf(payload, 'blog') ? Object.assign({}, payload.blog, { note: t }) : null;
          moveTo('EDITING', nextBlog ? { blog: nextBlog } : {});
        }
      }));
    } else if (status === 'NEEDS_HUMAN' || status === 'PARTIAL_FAIL') {
      flow.appendChild(h('button', {
        class: 'btn sm', type: 'button', text: '막힘 풀기',
        onclick: () => moveTo('REVIEW')
      }));
    }
    if (flow.childNodes.length) {
      flow.appendChild(h('span', { class: 'hint', text: '지금: ' + (STAGE_LABEL[status] || status || '-') }));
      acts.appendChild(flow);
    }
  };

  paintChips();
  paintView();
  paintActs();
  return wrap;
}

function rel(iso) {
  const t = new Date(String(iso).replace(' ', 'T')).getTime();
  if (!t || Number.isNaN(t)) return String(iso).slice(0, 10);
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return min + '분 전';
  if (min < 1440) return Math.floor(min / 60) + '시간 전';
  if (min < 2880) return '어제';
  return String(iso).slice(0, 10);
}

export const DRAFT_STATUSES = DRAFTISH;
