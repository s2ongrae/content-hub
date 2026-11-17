/**
 * js/draftView.js — 카드 상세 '작성본' 탭
 *
 * 발행 전 본문·대본을 카드 안에서 바로 읽고, 임시저장 링크로 이동하고,
 * 한 줄 수정 요청을 남기고, 작성본을 직접 붙여넣어 저장한다.
 * 데이터는 Drive payload 의 채널 키(blog·shorts·reels·ig_feed·clip)를 그대로 쓴다.
 * 서버·시트 스키마 변경 없음 — update_content 의 patch 로만 저장한다.
 */

import { api } from './api.js';

const CHAN = [
  { key: 'blog', label: '블로그', st: 'blog_status' },
  { key: 'shorts', label: '쇼츠', st: 'shorts_status' },
  { key: 'reels', label: '릴스', st: 'reels_status' },
  { key: 'ig_feed', label: '피드', st: 'ig_feed_status' },
  { key: 'clip', label: '클립', st: 'clip_status' }
];

const STAGE = {
  DRAFT: '초안', DRAFTING: '작성 중', GENERATING: '작성 중', REVIEW: '확인 대기',
  EDITING: '수정 중', READY: '발행 대기', PUBLISHING: '올리는 중', PUBLISHED: '발행 완료',
  LINKED: '최종', NEEDS_HUMAN: '막힘', PARTIAL_FAIL: '일부 실패'
};

const REASON_CH = { naver_blog: 'blog', youtube_shorts: 'shorts', instagram_reels: 'reels', instagram_feed: 'ig_feed', naver_clip: 'clip' };

function draftOf(payload, key) {
  const d = payload && payload[key];
  return d && typeof d === 'object' ? d : null;
}

function plainText(m, d) {
  if (!d) return m.blog_title || m.place_name || '';
  const parts = [d.title || m.blog_title || '', d.body || '', (d.hashtags || []).join(' ')].filter(Boolean);
  return parts.join('\n\n');
}

async function copyText(text, toast) {
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했어요', 'ok');
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

export function draftSection(ctx) {
  const { h, detail, meta, toast, onChanged } = ctx;
  const payload = Object.assign({}, detail.payload || {});
  const contentId = detail.content_id || meta.content_id;

  const skipped = (c) => meta[c.st] === 'SKIPPED';
  const first = CHAN.find((c) => draftOf(payload, c.key) && !skipped(c)) || CHAN.find((c) => !skipped(c)) || CHAN[0];
  let cur = first.key;

  const wrap = h('div', { class: 'draft' });
  const chips = h('div', { class: 'draft-chips' });
  const view = h('div', { class: 'draft-view' });
  const acts = h('div', { class: 'draft-acts' });
  const editorBox = h('div', { class: 'draft-edit' });
  wrap.appendChild(chips);
  wrap.appendChild(view);
  wrap.appendChild(acts);
  wrap.appendChild(editorBox);

  const save = async (body, okMsg) => {
    const res = await api.updateContent(body);
    const d = res.data || {};
    detail.version = d.version || detail.version + 1;
    if (d.status) meta.status = d.status;
    toast(okMsg || '저장했어요', 'ok');
    if (onChanged) onChanged();
    return res;
  };

  const moveTo = async (status, patch = {}) => {
    try {
      await save({ content_id: contentId, expected_version: detail.version, status, patch }, '옮겼어요 · ' + (STAGE[status] || status));
      paint();
    } catch (err) {
      toast(err.code === 'ERR_VERSION_CONFLICT' ? '다른 곳에서 먼저 바뀌었어요 — 창을 닫고 다시 열어 주세요'
        : '옮기지 못했어요: ' + (err.message || err.code), 'err');
    }
  };

  const toggleEditor = (open) => {
    editorBox.hidden = open == null ? !editorBox.hidden : !open;
  };

  const paintEditor = () => {
    editorBox.replaceChildren();
    const d = draftOf(payload, cur) || {};
    const titleIn = h('input', { type: 'text', placeholder: '제목 (없어도 됨)', value: d.title || meta.blog_title || '' });
    const bodyIn = h('textarea', { rows: '12', placeholder: '본문 또는 영상 대본·캡션을 붙여넣으세요' });
    bodyIn.value = d.body || '';
    const tagIn = h('input', { type: 'text', placeholder: '해시태그 (쉼표 또는 공백)', value: (d.hashtags || []).join(' ') });
    const urlIn = h('input', { type: 'url', placeholder: '임시저장 글 주소 (선택)', value: d.draft_url || '' });
    const saveBtn = h('button', {
      class: 'btn sm primary', type: 'button', text: '저장',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '저장 중…';
        const tags = String(tagIn.value || '').split(/[,\s]+/).map((t) => t.trim()).filter(Boolean)
          .map((t) => (t[0] === '#' ? t : '#' + t));
        const next = {
          title: String(titleIn.value || '').trim(),
          body: String(bodyIn.value || ''),
          hashtags: tags,
          draft_url: String(urlIn.value || '').trim(),
          updated_at: new Date().toISOString()
        };
        const keep = meta.status;
        const toDrafting = keep === 'DRAFT' || keep === 'GENERATING';
        try {
          await save({
            content_id: contentId, expected_version: detail.version,
            patch: { [cur]: next },
            status: toDrafting ? 'DRAFTING' : undefined
          }, '작성본을 저장했어요');
          payload[cur] = next;
          toggleEditor(false);
          paint();
        } catch (err) {
          toast(err.code === 'ERR_VERSION_CONFLICT' ? '다른 곳에서 먼저 바뀌었어요 — 창을 닫고 다시 열어 주세요'
            : '저장하지 못했어요: ' + (err.message || err.code), 'err');
          btn.disabled = false;
          btn.textContent = '저장';
        }
      }
    });
    editorBox.appendChild(h('p', { class: 'hint', text: '여기 넣은 내용은 이 카드의 ' + (CHAN.find((c) => c.key === cur) || {}).label + ' 작성본으로 저장돼요. 그대로 복사해 네이버·유튜브·인스타에 붙여넣으면 됩니다.' }));
    editorBox.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '제목' }), titleIn));
    editorBox.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '본문 · 대본' }), bodyIn));
    editorBox.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '해시태그' }), tagIn));
    editorBox.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '임시저장 주소' }), urlIn));
    editorBox.appendChild(h('div', { class: 'row' }, saveBtn,
      h('button', { class: 'btn sm', type: 'button', text: '닫기', onclick: () => toggleEditor(false) })));
  };

  const paint = () => {
    chips.replaceChildren(...CHAN.map((c) => {
      const has = !!draftOf(payload, c.key);
      return h('button', {
        type: 'button',
        class: 'draft-chip' + (c.key === cur ? ' on' : '') + (skipped(c) ? ' off' : ''),
        'aria-selected': c.key === cur ? 'true' : 'false',
        title: (has ? '작성본 있음' : '아직 없음') + (skipped(c) ? ' · 이 트랙은 건너뜀' : ''),
        onclick: () => { cur = c.key; paintEditor(); paint(); }
      }, h('span', { text: (has ? '● ' : '○ ') + c.label }));
    }));

    const d = draftOf(payload, cur);
    view.replaceChildren();
    if (!d) {
      view.appendChild(h('p', { class: 'draft-empty', text: '이 채널 작성본이 아직 없어요.' }));
      view.appendChild(h('p', { class: 'hint', text: '[작성본 넣기]에 제목·본문을 붙여넣어 두면, 다음부터 카드에서 바로 읽고 승인할 수 있어요.' }));
    } else {
      view.appendChild(h('div', { class: 'draft-title', text: d.title || meta.blog_title || '(제목 없음)' }));
      const info = [
        d.updated_at ? '저장 ' + String(d.updated_at).slice(0, 16).replace('T', ' ') : '',
        d.body ? String(d.body).length + '자' : '본문 없음',
        (d.hashtags || []).length ? '태그 ' + (d.hashtags || []).length : ''
      ].filter(Boolean).join(' · ');
      view.appendChild(h('div', { class: 'draft-meta', text: info }));
      const bodyBox = h('div', { class: 'draft-body' });
      String(d.body || '').split(/\n{2,}/).forEach((para) => {
        if (para.trim()) bodyBox.appendChild(h('p', { text: para }));
      });
      if (!d.body) bodyBox.appendChild(h('p', { class: 'hint', text: '(본문이 비어 있어요)' }));
      view.appendChild(bodyBox);
      if ((d.hashtags || []).length) view.appendChild(h('p', { class: 'draft-tags', text: (d.hashtags || []).join(' ') }));
      if (d.note) view.appendChild(h('p', { class: 'hint', text: '메모: ' + d.note }));
    }

    acts.replaceChildren();
    acts.appendChild(h('button', {
      class: 'btn sm primary', type: 'button', text: '본문 복사',
      title: '제목·본문·해시태그를 한 번에 복사합니다',
      onclick: () => copyText(plainText(meta, d), toast)
    }));
    if (d && d.draft_url) {
      acts.appendChild(h('a', {
        class: 'btn sm', href: d.draft_url, target: '_blank', rel: 'noopener noreferrer', text: '임시저장 열기'
      }));
    }
    acts.appendChild(h('button', {
      class: 'btn sm', type: 'button', text: d ? '작성본 고치기' : '작성본 넣기',
      onclick: () => { paintEditor(); toggleEditor(true); }
    }));

    const st = meta.status;
    if (st === 'REVIEW') {
      acts.appendChild(h('button', {
        class: 'btn sm', type: 'button', text: '고칠 점 적기',
        title: '한 줄로 적으면 카드가 "수정 중"으로 옮겨집니다',
        onclick: async () => {
          const reason = window.prompt('어떤 점을 고칠까요? (한 줄)\n예: 첫 문단이 약함 / 3번째 문단 사실관계 확인');
          if (!reason) return;
          const next = Object.assign({}, draftOf(payload, cur) || {}, { note: reason });
          await moveTo('EDITING', { [cur]: next, review_note: reason, prev_status: 'REVIEW' });
          payload[cur] = next;
          paint();
        }
      }));
    } else if (st === 'DRAFT' || st === 'GENERATING' || st === 'EDITING') {
      acts.appendChild(h('button', {
        class: 'btn sm', type: 'button', text: '확인 대기로 보내기', title: '다 쓰면 여기를 눌러 검수 차례로 넘깁니다',
        onclick: () => moveTo('REVIEW')
      }));
    } else if (st === 'NEEDS_HUMAN' || st === 'PARTIAL_FAIL') {
      const back = payload.prev_status || 'REVIEW';
      acts.appendChild(h('button', {
        class: 'btn sm', type: 'button', text: '막힘 풀기 (' + (STAGE[back] || back) + '로)',
        title: '로그인·인증·오류를 해결한 뒤 상태를 되돌립니다',
        onclick: () => moveTo(back, { prev_status: '' })
      }));
    }
  };

  paintEditor();
  toggleEditor(false);
  paint();
  return wrap;
}
