/**
 * js/create-view.js — 만들기(#/create)
 *
 * 재료(팩트·원문 메모·미디어)를 한 번 넣고 채널 카테고리를 고르면,
 * 그 채널의 규격 체크리스트·슬롯 표·완성본이 브라우저에서 바로 나온다.
 * 원문은 조립기에 넘겨서만 쓰고 화면에서 고치지 않는다(말투 보존).
 *
 * 원칙: textContent/createElement만(h() 사용). 폰 360px 가로 스크롤 0.
 */

import { buildSlotGuide, parseMediaPaste, normalizeMedia, sha256Hex } from './slot-engine.js?v=20261123b';
import { composeBlog } from './assembler.js?v=20261123b';
import { composeShorts, composeClip, composeDaangn, composeInstagram } from './assembler-channels.js?v=20261123b';

const SAVE_KEY = 'contenthub.create.v1';

const CHANNELS = [
  { id: 'blog', label: '네이버 블로그', emoji: '📝' },
  { id: 'ig', label: '인스타그램', emoji: '📷' },
  { id: 'shorts', label: '유튜브 쇼츠', emoji: '🎬' },
  { id: 'clip', label: '네이버 클립', emoji: '📎' },
  { id: 'daangn', label: '당근 스토리', emoji: '🥕' }
];

const EMPTY = {
  place_name: '', region_dong: '', category: '', cluster_id: '', target_keywords: '', naver_place_url: '',
  hours: '', closed_days: '', parking: '', wait_time: '', price_menu: '', tel: '', address: '',
  receipt_verified: false, media_drive_url: '', media_paste: '', memo: '',
  channel: 'blog', igKind: 'reels', mode: 'preserve',
  links: [{ url: '', title: '' }]
};

let S = null;

function load() {
  if (S) return S;
  try { S = Object.assign({}, EMPTY, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch (e) { S = Object.assign({}, EMPTY); }
  if (!Array.isArray(S.links) || !S.links.length) S.links = [{ url: '', title: '' }];
  return S;
}

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* 저장 실패는 무시 */ }
}

const text = (v) => (v == null ? '' : String(v));

export function renderCreateView(main, ctx) {
  const { h, api, toast, pageHead, friendlyError } = ctx;
  const st = load();

  const guideHost = h('div', { class: 'panel' }, h('h3', null, '③ 채널별 슬롯'), h('p', { class: 'hint', text: '재료를 넣으면 여기에 채널별 배치가 나옵니다.' }));
  const resultHost = h('div');
  const warnHost = h('div');

  main.appendChild(pageHead('🎬 채널 조립기 (예전 화면)', '재료를 넣으면 채널별 완성본이 바로 나옵니다 — 원문은 한 글자도 바꾸지 않습니다'));

  /* ───────── 1단계: 재료 ───────── */
  const F = {};
  const field = (key, label, placeholder, opts) => {
    const o = opts || {};
    const el = h(o.tag || 'input', {
      type: o.type || 'text', placeholder: placeholder || '', autocomplete: 'off',
      value: text(st[key]), inputmode: o.inputmode || null
    });
    el.addEventListener('input', () => { st[key] = el.value; save(); queue(); });
    F[key] = el;
    return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), el);
  };

  const receipt = h('input', { type: 'checkbox' });
  receipt.checked = !!st.receipt_verified;
  receipt.addEventListener('change', () => { st.receipt_verified = receipt.checked; save(); });

  const memoEl = h('textarea', { rows: '9', placeholder: '다녀온 이야기를 그대로 붙여넣으세요. 두 줄씩 끊은 호흡도 그대로 살립니다.' });
  memoEl.value = text(st.memo);
  memoEl.addEventListener('input', () => { st.memo = memoEl.value; save(); queue(); });

  const mediaEl = h('textarea', { rows: '4', placeholder: '한 줄에 파일 하나 (영상은 앞에 "영상:") 예) 01_외관.jpg' });
  mediaEl.value = text(st.media_paste);
  mediaEl.addEventListener('input', () => { st.media_paste = mediaEl.value; save(); queue(); });

  const driveEl = h('input', { type: 'url', placeholder: '드라이브 폴더 링크(선택)', value: text(st.media_drive_url), autocomplete: 'off' });
  driveEl.addEventListener('input', () => { st.media_drive_url = driveEl.value; save(); });
  F.media_drive_url = driveEl;

  const saveCard = h('button', { class: 'btn sm', type: 'button', text: '💾 현황 보드에 초안 카드로 저장' });
  saveCard.addEventListener('click', async () => {
    if (!text(st.place_name).trim()) { toast('가게 이름·주제를 먼저 적어 주세요', 'err'); return; }
    saveCard.disabled = true; saveCard.textContent = '저장 중…';
    try {
      const r = await api.createContent({
        brand: ctx.state.brand,
        place_name: text(st.place_name).trim(),
        region_dong: text(st.region_dong).trim(),
        category: text(st.category).trim(),
        cluster_id: text(st.cluster_id).trim(),
        target_keywords: text(st.target_keywords).trim(),
        naver_place_url: text(st.naver_place_url).trim(),
        media_drive_url: text(st.media_drive_url).trim(),
        receipt_verified: !!st.receipt_verified,
        allow_partial_shortform: false
      });
      const id = (r && r.data && r.data.content_id) || '';
      toast('보드에 저장했습니다 ' + id, 'ok');
    } catch (err) {
      toast('저장하지 못했습니다 — 서버 연결을 확인하세요', 'err');
    } finally { saveCard.disabled = false; saveCard.textContent = '💾 현황 보드에 초안 카드로 저장'; }
  });

  const form = h('div', { class: 'panel' },
    h('h3', null, '① 재료 넣기'),
    h('p', { class: 'hint', text: '이 화면 하나로 끝납니다: 재료 → 채널 → 복사·내려받기·오더. 서버가 없어도 브라우저에서 바로 계산합니다.' }),
    h('p', { class: 'hint', text: '모르는 값은 비워 두세요. 비운 값은 지어내지 않고 [확인 필요]로 남깁니다.' }),
    field('place_name', '가게 이름 · 주제 *', '예: 미미삼겹 유성점'),
    h('div', { class: 'form-grid two' },
      field('region_dong', '동네', '봉명동'),
      field('category', '종류', '한식 · 고기')),
    h('div', { class: 'form-grid two' },
      field('cluster_id', '주제 묶음', '유성 삼겹살'),
      field('target_keywords', '노릴 검색어', '봉명동 고기집, 봉명동 야장')),
    field('naver_place_url', '네이버 지도 링크', 'https://map.naver.com/...'),
    h('div', { class: 'form-grid two' },
      field('hours', '영업시간', '16:00~23:30'),
      field('closed_days', '휴무', '매주 일요일')),
    h('div', { class: 'form-grid two' },
      field('parking', '주차', '전용 없음 · 공영 1시간 1,200원'),
      field('wait_time', '대기', '평일 18:40 기준 15분')),
    h('div', { class: 'form-grid two' },
      field('price_menu', ' 대표메뉴·가격', '삼겹 16,000원 · 돌판짜파게티 6,500원'),
      field('tel', '전화', '0507-1462-1028')),
    field('address', '주소', '대전 유성구 대학로 60'),
    h('label', { class: 'switch' }, receipt, h('span', { text: '영수증·방문 사진 있음' })),

    h('div', { style: 'margin-top:14px' },
      h('span', { class: 'field-label', text: '방문 메모(원문) *  — 이 본문은 한 글자도 바꾸지 않습니다' }),
      memoEl),
    h('div', { class: 'field' },
      h('span', { class: 'field-label', text: '사진·영상 목록' }),
      driveEl,
      mediaEl),
    h('p', { class: 'hint', text: '드라이브 폴더 링크를 넣고 [📁 드라이브 폴더 읽기]를 누르면 파일 목록을 가져옵니다(최대 100개). 안 되면 파일명을 한 줄에 하나씩 붙여넣어도 됩니다.' }),
    (() => {
      const scan = h('button', { class: 'btn sm', type: 'button', text: '📁 드라이브 폴더 읽기' });
      scan.addEventListener('click', async () => {
        const url = text(st.media_drive_url).trim();
        if (!url) { toast('드라이브 폴더 링크를 먼저 넣어 주세요', 'err'); return; }
        scan.disabled = true; scan.textContent = '읽는 중…';
        try {
          const r = await api.post('list_drive_media', { folder_url: url });
          const items = (r && r.data && r.data.items) || [];
          if (!items.length) throw new Error('폴더에 파일이 없습니다');
          st.media_paste = items.map((it) => (it.kind === 'VIDEO' ? '영상: ' : '') + it.name).join('\n');
          mediaEl.value = st.media_paste; save(); queue();
          toast('파일 ' + items.length + '개를 가져왔습니다', 'ok');
        } catch (err) {
          toast('폴더를 읽지 못했습니다 — 파일명을 붙여넣어 주세요', 'err');
          warnHost.appendChild(h('div', { class: 'result err', text: friendlyError(err) }));
        } finally { scan.disabled = false; scan.textContent = '📁 드라이브 폴더 읽기'; }
      });
      return h('div', { class: 'row', style: 'margin:8px 0;gap:6px;flex-wrap:wrap' }, scan, saveCard);
    })()
  );
  main.appendChild(form);

  /* ───────── 2단계: 채널 카테고리 ───────── */
  const chips = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-bottom:10px' });
  CHANNELS.forEach((c) => {
    const b = h('button', { class: 'btn sm' + (st.channel === c.id ? ' primary' : ''), type: 'button', text: c.emoji + ' ' + c.label });
    b.setAttribute('data-chan', c.id);
    b.addEventListener('click', () => {
      st.channel = c.id; save();
      chips.querySelectorAll('[data-chan]').forEach((x) => x.classList.toggle('primary', x.dataset.chan === st.channel));
      paint();
    });
    chips.appendChild(b);
  });

  const igToggle = h('div', { class: 'row', style: 'gap:6px;margin:6px 0' });
  ['reels', 'feed'].forEach((k) => {
    const b = h('button', { class: 'btn sm' + (st.igKind === k ? ' primary' : ''), type: 'button', text: k === 'reels' ? '릴스' : '피드 카드뉴스' });
    b.setAttribute('data-ig', k);
    b.addEventListener('click', () => {
      st.igKind = k; save();
      igToggle.querySelectorAll('[data-ig]').forEach((x) => x.classList.toggle('primary', x.dataset.ig === st.igKind));
      paint();
    });
    igToggle.appendChild(b);
  });

  main.appendChild(h('div', { class: 'panel' },
    h('h3', null, '② 채널 고르기'),
    chips, igToggle,
    h('p', { class: 'hint', text: '고른 채널의 규격·슬롯·완성본만 보여줍니다. 재료는 위에서 한 번만 넣으면 됩니다.' })));

  main.appendChild(guideHost);
  main.appendChild(warnHost);
  main.appendChild(resultHost);

  /* ───────── 계산·그리기 ───────── */
  let timer = null;
  let seq = 0;
  function queue() {
    clearTimeout(timer);
    timer = setTimeout(paint, 220);
  }

  function mediaItems() {
    return normalizeMedia(parseMediaPaste(st.media_paste));
  }

  const FACT_KEYS = ['place_name', 'region_dong', 'category', 'cluster_id', 'target_keywords', 'naver_place_url',
    'hours', 'closed_days', 'parking', 'wait_time', 'price_menu', 'tel', 'address'];
  function facts() {
    const out = {};
    FACT_KEYS.forEach((k) => { out[k] = text(st[k]).trim(); });
    out.receipt_verified = !!st.receipt_verified;
    return out;
  }

  async function build() {
    const g = await buildSlotGuide({ facts: facts(), userMemo: st.memo, mediaItems: mediaItems(), brand: ctx.state.brand });
    return g;
  }

  function copyBtn(h, textToCopy, toast) {
    const b = h('button', { class: 'btn sm', type: 'button', text: '복사' });
    b.addEventListener('click', () => {
      const done = () => toast('복사했습니다', 'ok');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textToCopy).then(done).catch(fallback);
      else fallback();
      function fallback() {
        const ta = document.createElement('textarea');
        ta.value = textToCopy; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { toast('복사에 실패했습니다', 'err'); }
        ta.remove();
      }
    });
    return b;
  }

  function safeName(s) { return String(s || '원스톱').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40); }

  function downloadBtn(h, filename, content, toast) {
    const b = h('button', { class: 'btn sm', type: 'button', text: '⬇ 내려받기' });
    b.addEventListener('click', () => {
      try {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        toast('내려받았습니다 — ' + filename, 'ok');
      } catch (e) { toast('내려받기에 실패했습니다', 'err'); }
    });
    return b;
  }

  async function packageText(g) {
    const place = g.facts.place_name || '제목 없음';
    const blog = await composeBlog({ facts: g.facts, blocks: g.blocks, media: g.media, mode: st.mode,
      linkTargets: (st.links || []).filter((l) => l && l.url).map((l) => ({ url: l.url, anchor: l.title })), brand: ctx.state.brand });
    const shorts = composeShorts({ facts: g.facts, blocks: g.blocks, slots: g.channels.shorts, brand: ctx.state.brand });
    const clip = composeClip({ facts: g.facts, blocks: g.blocks, slots: g.channels.clip });
    const daangn = composeDaangn({ facts: g.facts, blocks: g.blocks, slots: g.channels.daangn });
    const reels = composeInstagram('reels', { facts: g.facts, blocks: g.blocks, slots: g.channels.ig_reels });
    const feed = composeInstagram('feed', { facts: g.facts, blocks: g.blocks, slots: g.channels.ig_feed });
    const parts = [
      '# ' + place + ' — 원스톱 패키지',
      '원문 ' + g.blocks.length + '문단 · 해시 ' + g.user_body_sha256.slice(0, 12) + ' · 모드 ' + st.mode,
      '',
      '## 1) 네이버 블로그', blog.title, '', blog.head, '', blog.body, '', blog.tail,
      '', '### 붙이는 순서(링크 카드)', ...blog.paste_steps.map((x, i) => (i + 1) + '. ' + x),
      '', '## 2) 유튜브 쇼츠 (' + shorts.length_sec + '초 · ' + shorts.cut_count + '컷)', shorts.title,
      ...shorts.cuts.map((c) => c.no + '. ' + c.time + ' | ' + c.media + ' | ' + c.subtitle),
      '고정댓글: ' + shorts.pinned_comment,
      '', '## 3) 네이버 클립', clip.title, clip.hashtags.join(' '), '장소 태그: ' + clip.place_tag,
      '', '## 4) 당근 스토리 (' + daangn.duration_sec + '초)', daangn.description, daangn.tags.join(' '), '장소: ' + daangn.place_tag,
      '', '## 5) 인스타 릴스', reels.caption, reels.hashtags.join(' '),
      '', '## 6) 인스타 피드', ...feed.slides.map((s) => s.no + '. ' + s.media + ' — ' + s.copy), '', feed.caption, feed.hashtags.join(' '),
      '', '---', '슬롯: ' + Object.keys(g.channels).map((k) => k + ' ' + g.channels[k].length).join(' · ')
    ];
    return parts.filter((x) => x != null).join('\n');
  }

  function pre(h, content) {
    return h('pre', { style: 'white-space:pre-wrap;word-break:break-word;font:inherit;margin:0;line-height:1.55' }, content);
  }

  function slotTable(h, rows) {
    const wrap = h('div', { style: 'overflow-x:auto' });
    const tb = h('table', { style: 'width:100%;border-collapse:collapse;font-size:12px' },
      h('thead', null, h('tr', null, ['#', '위치', '미디어', '메모'].map((t) => h('th', { style: 'text-align:left;padding:4px;border-bottom:1px solid #2a3550', text: t })))),
      h('tbody', null, rows.map((r, i) => h('tr', null,
        h('td', { style: 'padding:4px;opacity:.7', text: String(i + 1) }),
        h('td', { style: 'padding:4px', text: (r.time ? r.time + ' · ' : '') + (r.role || r.slot_id || '') }),
        h('td', { style: 'padding:4px', text: r.media || '—' }),
        h('td', { style: 'padding:4px;opacity:.7', text: r.note || '' })))));
    wrap.appendChild(tb);
    return wrap;
  }

  function checks(h, list) {
    return h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin:8px 0' },
      (list || []).map((c) => h('span', { class: 'tag', style: c.ok ? 'border-color:#2f6f4f' : 'border-color:#7a3b2a', text: (c.ok ? '✓ ' : '! ') + c.msg })));
  }

  async function paint() {
    const my = ++seq;
    const hasInput = !!(text(st.place_name).trim() || text(st.memo).trim() || text(st.media_paste).trim());
    if (!hasInput) {
      while (warnHost.firstChild) warnHost.removeChild(warnHost.firstChild);
      while (guideHost.firstChild) guideHost.removeChild(guideHost.firstChild);
      guideHost.appendChild(h('h3', null, '③ 채널별 슬롯'));
      guideHost.appendChild(h('p', { class: 'hint', text: '위에 재료를 넣으면 채널별 배치가 여기에 나옵니다.' }));
      while (resultHost.firstChild) resultHost.removeChild(resultHost.firstChild);
      resultHost.appendChild(h('div', { class: 'panel' },
        h('h3', null, '④ 완성본'),
        h('p', { class: 'hint', text: '가게 이름이나 방문 메모를 넣으면 그 자리에서 완성본이 나옵니다. AI가 문장을 고쳐 쓰지 않습니다.' })));
      return;
    }
    const g = await build();
    if (my !== seq) return;
    const ch = st.channel;

    /* 경고 */
    while (warnHost.firstChild) warnHost.removeChild(warnHost.firstChild);
    if (g.warnings.length) {
      warnHost.appendChild(h('div', { class: 'panel' },
        h('h3', null, '확인이 필요한 것'),
        h('ul', { style: 'margin:0;padding-left:18px' }, g.warnings.map((w) => h('li', { class: 'hint', text: w.msg + ' (' + w.code + ')' })))));
    }

    /* 슬롯 가이드 */
    while (guideHost.firstChild) guideHost.removeChild(guideHost.firstChild);
    const title = h('h3', null, '③ 채널별 슬롯');
    guideHost.appendChild(title);
    guideHost.appendChild(h('p', { class: 'hint', text: '원문 ' + g.blocks.length + '문단 · 해시 ' + g.user_body_sha256.slice(0, 8) + '… · 미디어 ' + g.media.length + '개' }));
    const pick = ch === 'ig' ? (st.igKind === 'feed' ? 'ig_feed' : 'ig_reels') : ch;
    const rows = (g.channels[pick] || []).slice(0, 24);
    guideHost.appendChild(slotTable(h, rows));

    /* 결과 */
    while (resultHost.firstChild) resultHost.removeChild(resultHost.firstChild);
    const box = h('div', { class: 'panel' });
    resultHost.appendChild(box);

    if (ch === 'blog') {
      const links = (st.links || []).filter((l) => l && l.url).map((l) => ({ url: l.url, anchor: l.title }));
      const r = await composeBlog({
        facts: g.facts, blocks: g.blocks, media: g.media, mode: st.mode,
        linkTargets: links, brand: ctx.state.brand
      });
      if (my !== seq) return;
      box.appendChild(h('h3', null, '📝 네이버 블로그 — ' + (r.mode === 'preserve' ? '원문 보존' : '새로 쓰기')));
      box.appendChild(checks(h, [
        { ok: r.ok, msg: r.ok ? '원문 변형 0 (해시 ' + r.user_body_sha256.slice(0, 8) + ')' : '원문이 바뀌었습니다' },
        { ok: r.tone_checks.banned.length === 0, msg: '금지어 ' + r.tone_checks.banned.length + '건' },
        { ok: !r.tone_checks.exposed_url, msg: '줄글 URL 없음(링크 카드)' },
        { ok: (r.link_cards || []).length <= 2, msg: '링크 카드 ' + (r.link_cards || []).length + '개' }
      ]));
      box.appendChild(pre(h, r.text));
      box.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-top:10px' },
        copyBtn(h, r.text, toast),
        downloadBtn(h, safeName(g.facts.place_name) + '_블로그.md', r.text, toast)));
      if (r.paste_steps) {
        box.appendChild(h('h4', { style: 'margin:14px 0 6px', text: '링크 카드 붙이는 순서' }));
        box.appendChild(h('ol', { style: 'margin:0;padding-left:18px' }, r.paste_steps.map((s) => h('li', { class: 'hint', text: s }))));
      }
      box.appendChild(linkEditor(h, toast));
    } else if (ch === 'ig') {
      const r = composeInstagram(st.igKind, { facts: g.facts, blocks: g.blocks, slots: g.channels[pick] });
      box.appendChild(h('h3', null, '📷 인스타그램 — ' + (r.kind === 'feed' ? '피드 카드뉴스' : '릴스')));
      box.appendChild(checks(h, r.checks));
      if (r.slides) box.appendChild(slotTable(h, r.slides.map((s) => ({ role: s.no + '. ' + s.role, media: s.media, note: s.copy }))));
      const t = r.caption + '\n\n' + r.hashtags.join(' ');
      box.appendChild(pre(h, t));
      box.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-top:10px' },
        copyBtn(h, t, toast), downloadBtn(h, safeName(g.facts.place_name) + '_인스타.md', t, toast)));
    } else if (ch === 'shorts') {
      const r = composeShorts({ facts: g.facts, blocks: g.blocks, slots: g.channels.shorts, brand: ctx.state.brand });
      box.appendChild(h('h3', null, '🎬 유튜브 쇼츠 — ' + r.length_sec + '초 · ' + r.cut_count + '컷'));
      box.appendChild(checks(h, r.checks));
      box.appendChild(slotTable(h, r.cuts));
      const t = r.title + '\n\n' + r.cuts.map((c) => c.no + '. ' + c.time + ' | ' + c.media + ' | ' + (c.subtitle || '—')).join('\n')
        + '\n\n고정댓글: ' + r.pinned_comment;
      box.appendChild(pre(h, t));
      box.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-top:10px' },
        copyBtn(h, t, toast), downloadBtn(h, safeName(g.facts.place_name) + '_쇼츠.md', t, toast)));
    } else if (ch === 'clip') {
      const r = composeClip({ facts: g.facts, blocks: g.blocks, slots: g.channels.clip });
      box.appendChild(h('h3', null, '📎 네이버 클립'));
      box.appendChild(checks(h, r.checks));
      box.appendChild(slotTable(h, r.segments.map((s) => ({ time: s.time, role: '컷', media: s.media, note: s.overlay }))));
      const t = r.title + '\n' + r.hashtags.join(' ') + '\n장소 태그: ' + r.place_tag;
      box.appendChild(pre(h, t));
      box.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-top:10px' },
        copyBtn(h, t, toast), downloadBtn(h, safeName(g.facts.place_name) + '_클립.md', t, toast)));
    } else {
      const r = composeDaangn({ facts: g.facts, blocks: g.blocks, slots: g.channels.daangn });
      box.appendChild(h('h3', null, '🥕 당근 스토리 — ' + (r.duration_sec || 0) + '초'));
      box.appendChild(checks(h, r.checks));
      box.appendChild(slotTable(h, g.channels.daangn));
      const t = r.description + '\n\n' + r.tags.join(' ') + '\n장소: ' + r.place_tag;
      box.appendChild(pre(h, t));
      box.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-top:10px' },
        copyBtn(h, t, toast), downloadBtn(h, safeName(g.facts.place_name) + '_당근.md', t, toast)));
    }

    /* 오더 — 문구는 언제나 그대로 복사할 수 있게 둔다(셀프서비스) */
    const orderText = '[제작 오더] ' + (g.facts.place_name || '') + ' · 채널 ' + ch
      + ' · 슬롯 ' + (g.channels[pick] || []).length + '개 · 조립본 해시 ' + g.user_body_sha256.slice(0, 8)
      + '\n모드: ' + st.mode + ' · 톤 시드: seeds/skills/tone_reference_v1.md';
    const order = h('button', { class: 'btn primary', type: 'button', text: '🤖 노트북에 오더 보내기' });
    order.addEventListener('click', async () => {
      order.disabled = true; order.textContent = '보내는 중…';
      try {
        const r = await api.post('hub_order', {
          type: 'content_render', channel: ch, place_name: g.facts.place_name,
          user_body_sha256: g.user_body_sha256, slot_count: (g.channels[pick] || []).length,
          tone_seed: 'seeds/skills/tone_reference_v1.md'
        });
        const id = (r && r.data && (r.data.order_id || r.data.order)) || '';
        toast('오더를 보냈습니다 ' + id, 'ok');
        order.textContent = '✓ 오더 접수 ' + (id || '');
      } catch (err) {
        order.textContent = '🤖 노트북에 오더 보내기';
        toast('오더를 보내지 못했습니다 — [복사]로 문구를 복사해 포털 오더함에 붙여넣으면 그대로 실행됩니다', 'err');
      } finally { order.disabled = false; }
    });

    const pkgOut = h('div');
    const pkgBtn = h('button', { class: 'btn sm', type: 'button', text: '📦 전체 패키지 만들기(5채널)' });
    pkgBtn.addEventListener('click', async () => {
      pkgBtn.disabled = true; pkgBtn.textContent = '만드는 중…';
      try {
        const t = await packageText(g);
        while (pkgOut.firstChild) pkgOut.removeChild(pkgOut.firstChild);
        pkgOut.appendChild(pre(h, t));
        pkgOut.appendChild(h('div', { class: 'row', style: 'gap:6px;margin-top:8px' },
          copyBtn(h, t, toast),
          downloadBtn(h, safeName(g.facts.place_name) + '_원스톱패키지.md', t, toast)));
      } finally { pkgBtn.disabled = false; pkgBtn.textContent = '📦 전체 패키지 만들기(5채널)'; }
    });

    resultHost.appendChild(h('div', { class: 'panel' },
      h('h3', null, '④ 오더 · 내보내기'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, order, copyBtn(h, orderText, toast), pkgBtn),
      h('p', { class: 'hint', text: '노트북이 꺼져 있어도 됩니다 — [복사]로 오더 문구를 복사해 포털 오더함에 붙여넣으면 그대로 실행됩니다.' }),
      pkgOut));
  }

  /* 링크 입력(교차링크) — 결과 상자에서 고친다 */
  function linkEditor(h, toast) {
    const box = h('div', { style: 'margin-top:14px' }, h('h4', { style: 'margin:0 0 6px', text: '링크 카드로 넣을 내 글' }));
    (st.links || []).slice(0, 2).forEach((l, i) => {
      const url = h('input', { type: 'url', placeholder: 'https://blog.naver.com/youth-daejeon/…', value: l.url || '' });
      const title = h('input', { type: 'text', placeholder: '설명 한 줄 (예: 같은 봉명동 술상 편: 미미삼겹 냉삼 솔직후기)', value: l.title || '' });
      url.addEventListener('input', () => { st.links[i].url = url.value; save(); queue(); });
      title.addEventListener('input', () => { st.links[i].title = title.value; save(); queue(); });
      box.appendChild(h('div', { class: 'form-grid two', style: 'margin-bottom:6px' },
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'URL ' + (i + 1) }), url),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: '설명 ' + (i + 1) }), title)));
    });
    return box;
  }

  paint();
  return null;
}

if (typeof window !== 'undefined') {
  window.renderCreateView = renderCreateView;
}
