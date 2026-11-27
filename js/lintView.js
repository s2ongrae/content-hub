/**
 * js/lintView.js — 발행 전 린터 화면(#/lint)
 *
 * 상위 24건 실측에서 뽑은 9항목(줄바꿈 배치 포함)을 기계적으로만 판정한다(사람 판단이 필요한 것은 판정하지 않음).
 * 제목·본문·사진 수·키워드를 넣고 [9항목 검사]를 누르면 PASS/WARN 과 고칠 것이 나온다.
 * 초안은 이 브라우저에만 저장한다(새로고침해도 남게).
 */

import { lintBlog, loadLintRules } from './blogLint.js?v=20261127c';
import { analyzeCompliance, complianceLine, withDisclosureNote, stripProfitLinks, stripOwnMoney } from './blogCompliance.js?v=20261124b';
import { friendlyError } from './uiState.js?v=20261126a';

const DRAFT_KEY = 'contenthub.lint_draft.v1';
/* 카드에서 불러온 값은 수동 초안과 섞지 않는다(수동 메모가 지워지지 않게 별도 키). */
const CARD_KEY = 'contenthub.lint_card.v1';

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch (e) { return {}; }
}

function writeDraft(d) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) { /* 무시 */ }
}

function readCard() {
  try {
    const d = JSON.parse(localStorage.getItem(CARD_KEY)) || {};
    return d && d.id ? d : null;
  } catch (e) { return null; }
}

function writeCard(d) {
  try { localStorage.setItem(CARD_KEY, JSON.stringify(d || {})); } catch (e) { /* 무시 */ }
}

const STATE_LABEL = { pass: '통과', near: '주의', warn: '고칠 것', fail: '보류' };
const AI_STATE_LABEL = { pass: '없음', near: '—', warn: '주의', fail: '보류' };

/** AI 티 8패턴 · D.I.A.+ · 키워드 판넬 — 9항목 점수와 따로 보여준다(점수에 안 섞임). */
function aiTonePanel(h, r) {
  const ai = r.aiTone || {};
  const patterns = ai.patterns || [];
  const dia = ai.dia || { elements: [], hits: 0, total: 5, state: 'near' };
  const kw = ai.keywords || { items: [], state: 'near', note: '' };
  const wrap = h('div', { class: 'aitione' },
    h('h3', null, 'AI 티 8패턴 · D.I.A.+',
      h('span', { class: 'tag', text: '적발 ' + (ai.count || 0) + '개 · ' + (ai.count >= 2 ? '발행 보류' : '표시만') })));

  if (ai.hold) {
    wrap.appendChild(h('p', { class: 'aitione-hold', text: '⛔ 발행 보류 — ' + (ai.holdReasons || []).join(' · ') }));
  }

  const list = h('div', { class: 'blint-list' });
  patterns.forEach((p) => {
    list.appendChild(h('div', { class: 'lr-row', 'data-state': p.state },
      h('span', { class: 'lr-badge', text: AI_STATE_LABEL[p.state] || p.state }),
      h('div', { class: 'lr-main' },
        h('div', { class: 'lr-title', text: p.no + '. ' + p.label + '  ·  ' + p.value }),
        h('div', { class: 'lr-note', text: p.note || p.judge || '' }),
        (p.state === 'pass' || p.state === 'near') ? null : h('div', { class: 'lr-fix', text: p.fix })),
      h('span', { class: 'lr-w', text: p.state === 'fail' ? 'FAIL' : p.state === 'warn' ? 'WARN' : '' })));
  });
  wrap.appendChild(list);

  const diaRow = h('div', { class: 'lr-row', 'data-state': dia.state },
    h('span', { class: 'lr-badge', text: STATE_LABEL[dia.state] || dia.state }),
    h('div', { class: 'lr-main' },
      h('div', { class: 'lr-title', text: '첫 400자 D.I.A.+  ·  ' + dia.hits + '/' + dia.total }),
      h('div', { class: 'lr-note', text: (dia.elements || []).map((e) => (e.state === 'pass' ? '✓ ' : e.state === 'near' ? '△ ' : '✗ ') + e.label).join('   ') }),
      dia.state === 'pass' ? null : h('div', { class: 'lr-fix', text: (dia.elements || []).filter((e) => e.state === 'warn').map((e) => e.fix).slice(0, 2).join(' ') })),
    h('span', { class: 'lr-w', text: '질문·답·조건·대상·결론' }));
  wrap.appendChild(diaRow);

  if ((kw.items || []).length) {
    const kwList = h('div', { class: 'blint-list', style: 'margin-top:6px' });
    kw.items.forEach((k) => {
      kwList.appendChild(h('div', { class: 'lr-row', 'data-state': k.state },
        h('span', { class: 'lr-badge', text: AI_STATE_LABEL[k.state] || k.state }),
        h('div', { class: 'lr-main' },
          h('div', { class: 'lr-title', text: '🔎 ' + k.keyword + '  ·  ' + k.count + '회' }),
          h('div', { class: 'lr-note', text: k.note })),
        h('span', { class: 'lr-w', text: k.state === 'fail' ? 'FAIL' : '' })));
    });
    wrap.appendChild(kwList);
  }

  wrap.appendChild(h('p', { class: 'hint', style: 'margin-top:8px',
    text: '판정은 기계적으로 센 값만 봅니다. AI 티 2개↑ 또는 결말 상투어·키워드 6회↑ 면 [발행 보류]로 표시합니다 — 고친 뒤 다시 검사하세요.' }));
  return wrap;
}

/** 블로그 본문 후보 — 채널마다 부르는 이름이 다르다(body·script·caption·text). */
function blogBodyOf(doc) {
  if (!doc || typeof doc !== 'object') return '';
  for (const k of ['body', 'script', 'caption', 'text', 'description']) {
    if (typeof doc[k] === 'string' && doc[k].trim()) return doc[k];
  }
  return '';
}

/** 카드 payload 에 남은 사진 수 — studio.media → media → photos 순. 배열이 아예 없으면 null(모르는 값은 비워 둔다). */
function photoCountOf(payload) {
  const p = payload || {};
  const blog = (p.blog && typeof p.blog === 'object') ? p.blog : {};
  const lists = [p.studio && p.studio.media, p.media, p.photos, blog.photos];
  for (const arr of lists) {
    if (Array.isArray(arr) && arr.length) {
      const n = arr.filter((x) => !x || !x.kind || /photo/i.test(String(x.kind))).length;
      if (n > 0) return n;
    }
  }
  /* 2026-11-24: 글 안에 사진 장수만 적어 둔 카드(blog.photo_count)도 있다 — 비워 두면 '사진 0장'으로 잘못 잡힌다. */
  const n = Number(blog.photo_count != null ? blog.photo_count : (blog.photoCount != null ? blog.photoCount : NaN));
  if (Number.isFinite(n) && n > 0) return n;
  return null;
}

const STATUS_ORDER = { REVIEW: 0, READY: 1, DRAFT: 2, DRAFTING: 3, GENERATING: 3, EDITING: 4, PUBLISHING: 6, PUBLISHED: 7, LINKED: 8, NEEDS_HUMAN: 9, PARTIAL_FAIL: 10 };
const sortCards = (list) => list.slice().sort((a, b) => {
  const oa = STATUS_ORDER[a.status] == null ? 5 : STATUS_ORDER[a.status];
  const ob = STATUS_ORDER[b.status] == null ? 5 : STATUS_ORDER[b.status];
  if (oa !== ob) return oa - ob;
  return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
});

const cut = (s, n) => { const a = Array.from(String(s || '')); return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };

export async function renderLintView(main, ctx) {
  const { h, pageHead, toast, api, state, statusLabel } = ctx;
  const rules = await loadLintRules();
  const t = rules.targets;
  const draft = readDraft();
  const contents = Array.isArray(state.contents) ? state.contents : [];
  const savedCard = readCard();
  let cardState = (savedCard && savedCard.brand === state.brand && contents.some((c) => c.content_id === savedCard.id))
    ? savedCard
    : null;
  const init = cardState ? cardState.values : draft;

  main.appendChild(pageHead('🔍 발행 전 글 점검',
    '상위 24건 실측 9항목(줄바꿈 배치 포함) + AI 티 8패턴·첫 400자 의도 검사 — 통과하면 그대로 올리면 됩니다'));

  /* ── 허브 카드에서 불러오기 (2026-11-23) — 수동 복붙은 그대로 두고 위에 얹는다 ── */
  const cardSel = h('select', { style: 'width:100%', 'aria-label': '허브 카드 고르기' });
  cardSel.appendChild(h('option', { value: '', text: contents.length ? '카드를 고르면 제목·본문을 채우고 바로 검사합니다' : '이 브랜드에 카드가 없어요' }));
  sortCards(contents).forEach((c) => {
    const label = '[' + statusLabel(c.status) + '] ' + (c.blog_title || c.place_name || c.content_id);
    cardSel.appendChild(h('option', { value: c.content_id, text: cut(label, 26) }));
  });
  cardSel.disabled = !contents.length;

  const cardInfo = h('p', { class: 'hint', text: contents.length ? '카드를 고르면 제목·본문·검색어를 채우고 바로 점검합니다. 아래 칸에서 고친 본문은 [이 카드에 본문 저장]을 눌러야 카드에 들어갑니다.' : '서버를 연결하면 이 브랜드의 카드가 여기에 나옵니다.' });
  const saveCardBtn = h('button', { class: 'btn sm primary', type: 'button', text: '이 카드에 본문 저장', disabled: true });
  const openCardBtn = h('button', { class: 'ghost-btn sm', type: 'button', text: '카드 상세 열기' });
  saveCardBtn.hidden = true;
  openCardBtn.hidden = true;

  const cardPanel = h('div', { class: 'panel' },
    h('h3', null, '허브 카드에서 불러오기', h('span', { class: 'tag', text: '선택 즉시 검사' })),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '카드' }), cardSel),
    cardInfo,
    h('div', { class: 'row', style: 'margin-top:8px;gap:8px' }, saveCardBtn, openCardBtn));
  main.appendChild(cardPanel);

  const titleEl = h('input', { type: 'text', value: init.title || '', placeholder: '예: [봉명동 삼겹살] 미미삼겹 유성점 솔직후기 : …', autocomplete: 'off' });
  const bodyEl = h('textarea', { rows: '14', placeholder: '본문을 붙여넣으세요(정보 카드 → 외관 → 메뉴 → 먹방 → 총평)' });
  bodyEl.value = init.body || '';
  const photoEl = h('input', { type: 'number', min: '0', inputmode: 'numeric', value: init.photoCount || '', placeholder: '예: 20' });
  const kwEl = h('input', { type: 'text', value: init.keywords || '', placeholder: '봉명동맛집, 삼겹살, 늦게까지', autocomplete: 'off' });

  const form = h('div', { class: 'panel' },
    h('h3', null, '초안', h('span', { class: 'tag', text: rules.version })),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '제목' }), titleEl),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '본문' }), bodyEl),
    h('div', { class: 'form-grid two' },
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '사진 수' }), photoEl),
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '노리는 검색어 (쉼표)' }), kwEl)));

  const counters = h('div', { class: 'lint-counters' });
  const resultHost = h('div');
  const runBtn = h('button', { class: 'btn primary block', type: 'button', text: '9항목 + AI 티 검사' });
  form.appendChild(runBtn);
  form.appendChild(counters);
  main.appendChild(form);
  main.appendChild(resultHost);

  function saveDraft() {
    writeDraft({
      title: titleEl.value, body: bodyEl.value,
      photoCount: photoEl.value, keywords: kwEl.value
    });
  }

  function paintCounters() {
    while (counters.firstChild) counters.removeChild(counters.firstChild);
    const r = lintBlog({
      title: titleEl.value, body: bodyEl.value,
      photoCount: photoEl.value === '' ? undefined : Number(photoEl.value),
      keywords: kwEl.value
    }, rules);
    const cells = [
      ['제목', r.stats.titleChars + '자', t.title_len[0] + '~' + t.title_len[1]],
      ['본문', r.stats.bodyChars.toLocaleString('ko-KR') + '자', t.body_len[0] + '~' + t.body_len[1]],
      ['사진', r.stats.photos + '장', t.photos_min + '장 이상'],
      ['장당 글자', (r.stats.photos ? Math.round(r.stats.bodyChars / r.stats.photos) : 0) + '자', t.chars_per_photo[0] + '~' + t.chars_per_photo[1]],
      ['문단 평균', r.stats.avgLine + '자', t.avg_line_max + '자 이하'],
      ['16자 이하 줄', r.stats.shortLines + '개', t.short_lines_min + '개 이상'],
      ['해시태그', r.stats.hashtags + '개', t.hashtag_count[0] + '~' + t.hashtag_count[1]]
    ];
    cells.forEach((c) => counters.appendChild(h('div', { class: 'lc' },
      h('span', { class: 'lc-k', text: c[0] }),
      h('b', { class: 'lc-v', text: c[1] }),
      h('span', { class: 'lc-t', text: '목표 ' + c[2] }))));
  }

  function paintResult() {
    while (resultHost.firstChild) resultHost.removeChild(resultHost.firstChild);
    const r = lintBlog({
      title: titleEl.value, body: bodyEl.value,
      photoCount: photoEl.value === '' ? undefined : Number(photoEl.value),
      keywords: kwEl.value
    }, rules);

    const warn = r.items.filter((i) => i.state === 'warn');
    const near = r.items.filter((i) => i.state === 'near');
    const ai = r.aiTone || { patterns: [], dia: { elements: [], hits: 0, total: 5 }, keywords: { items: [] }, holdReasons: [] };
    const hold = !!r.hold;
    const head = h('div', { class: 'lint-score' + (r.pass && !hold ? ' ok' : '') + (hold ? ' hold' : '') },
      h('div', { class: 'ls-num', text: String(r.score) }),
      h('div', { class: 'ls-txt' },
        h('strong', { text: hold ? '발행 보류 — ' + (ai.holdReasons || []).join(' · ') : (r.pass ? '통과 — 발행해도 됩니다' : (warn.length >= 3 ? '미달 — 손볼 곳이 ' + warn.length + '개' : '보완 — ' + warn.length + '개만 고치면 통과')) }),
        h('span', { text: '주의 ' + near.length + ' · 고칠 것 ' + warn.length + ' · AI 티 ' + (ai.count || 0) + ' · D.I.A.+ ' + (ai.dia ? ai.dia.hits : 0) + '/' + (ai.dia ? ai.dia.total : 5) + ' · 기준 ' + rules.version })));

    const panel = h('div', { class: 'panel lint-result' }, head);

    /* 공개 표시 자동 처리(2026-11-24) — 진단만 하고 끝내지 않고, 누르면 본문을 바로 고친다. */
    const comp = analyzeCompliance(bodyEl.value);
    const compBox = h('div', { class: 'panel' },
      h('h3', null, '공개 표시 · 네이버 기능'),
      h('p', { class: 'st-hint' + (comp.state === 'conflict' || comp.state === 'needs_notice' ? ' err' : ''), text: complianceLine(comp) }));
    if (comp.state === 'needs_notice' || comp.state === 'notice_late') {
      const b = h('button', { class: 'btn primary', type: 'button', text: '본문 맨 위에 대가 문구 넣기 (자동)' });
      b.addEventListener('click', () => {
        const r = withDisclosureNote(bodyEl.value);
        bodyEl.value = r.body;
        saveDraft(); paintCounters(); paintResult();
        toast(r.added ? '대가 문구를 맨 위에 넣었습니다' : '이미 표기되어 있습니다', 'ok');
      });
      compBox.appendChild(b);
    }
    if (comp.conflict) {
      const row = h('div', { class: 'row' });
      const b1 = h('button', { class: 'btn', type: 'button', text: '제휴 링크 걷어내기 (내돈내산 유지)' });
      b1.addEventListener('click', () => {
        const r = stripProfitLinks(bodyEl.value);
        bodyEl.value = r.body;
        saveDraft(); paintCounters(); paintResult();
        toast('제휴 링크 ' + r.removed.length + '개를 본문에서 뺐습니다', 'ok');
      });
      const b2 = h('button', { class: 'btn', type: 'button', text: '내돈내산 표기 지우기 (링크 유지)' });
      b2.addEventListener('click', () => {
        const r = stripOwnMoney(bodyEl.value);
        bodyEl.value = r.body;
        saveDraft(); paintCounters(); paintResult();
        toast('내돈내산 표기 ' + r.removed + '곳을 지웠습니다', 'ok');
      });
      row.appendChild(b1); row.appendChild(b2);
      compBox.appendChild(row);
    }
    compBox.appendChild(h('p', { class: 'hint', text: '기준: docs/BLOG_NATIVE_FEATURES_v1.md — 내돈내산(구매확정 6개월·예약 방문 1년) · 글감 카드 · 블로그씨 · 미션위젯' }));
    resultHost.appendChild(compBox);

    const list = h('div', { class: 'lint-list' });
    r.items.forEach((it) => {
      list.appendChild(h('div', { class: 'lr-row', 'data-state': it.state },
        h('span', { class: 'lr-badge', text: STATE_LABEL[it.state] || it.state }),
        h('div', { class: 'lr-main' },
          h('div', { class: 'lr-title', text: it.label + '  ·  ' + it.value }),
          h('div', { class: 'lr-note', text: it.note || '' }),
          it.state === 'pass' ? null : h('div', { class: 'lr-fix', text: it.fix })),
        h('span', { class: 'lr-w', text: it.weight ? '+' + it.weight : '' })));
    });
    panel.appendChild(list);

    /* ── AI 티 8패턴 · 첫 400자 D.I.A.+ · 키워드 3~5회 (2026-11-21, #44584) ── */
    panel.appendChild(aiTonePanel(h, r));

    if (warn.length) {
      panel.appendChild(h('p', { class: 'hint', style: 'margin-top:10px',
        text: '먼저 고칠 것: ' + warn.map((i) => i.label).join(' · ') }));
    }
    if (rules.benchmark) {
      const med = rules.benchmark.median || {};
      panel.appendChild(h('p', { class: 'hint', style: 'margin-top:8px',
        text: '상위 24건 중앙값: ' + med.chars + '자 · 사진 ' + med.photos + '장 · 장당 ' + med.chars_per_photo
          + '자 · 문단 ' + med.avg_paragraph_chars + '자 · 짧은 줄 ' + med.short_lines + '개 · 첫 화면 정보 '
          + (med.first_screen_info_rate_pct != null ? med.first_screen_info_rate_pct : med.first_screen_info_pct) + '%' }));
    }
    resultHost.appendChild(panel);
    panel.scrollIntoView({ block: 'start' });
  }

  /* ── 카드 모드: 불러오기 · 다시 저장 (수동 복붙 흐름은 아래 그대로) ── */
  let loadSeq = 0;

  function cardValues() {
    return { title: titleEl.value, body: bodyEl.value, photoCount: photoEl.value, keywords: kwEl.value };
  }

  function cardDirty() {
    if (!cardState) return false;
    const a = cardValues();
    const b = cardState.base || {};
    return ['title', 'body', 'photoCount', 'keywords'].some((k) => String(a[k] == null ? '' : a[k]) !== String(b[k] == null ? '' : b[k]));
  }

  function refreshCardBar() {
    saveCardBtn.hidden = !cardState;
    openCardBtn.hidden = !cardState;
    if (!cardState) return;
    const body = Array.from(String(bodyEl.value || '').replace(/\s+/g, ' ').trim()).length;
    const bits = ['카드 ' + cardState.id, body ? '본문 ' + body.toLocaleString('ko-KR') + '자' : '블로그 본문 없음'];
    if (photoEl.value !== '') bits.push('사진 ' + photoEl.value + '장');
    if (cardDirty()) bits.push('고친 내용은 아직 카드에 저장되지 않았어요');
    cardInfo.textContent = bits.join(' · ');
    saveCardBtn.disabled = !cardDirty();
  }

  function applyValues(v) {
    titleEl.value = v.title || '';
    bodyEl.value = v.body || '';
    photoEl.value = v.photoCount == null ? '' : String(v.photoCount);
    kwEl.value = v.keywords || '';
  }

  /** 카드를 골랐을 때 — 상세를 읽어 4칸을 채우고 바로 검사한다. 늦게 온 응답은 버린다. */
  async function loadCard(id) {
    const seq = ++loadSeq;
    cardInfo.textContent = '카드 불러오는 중…';
    try {
      const res = await api.getContentDetail(id);
      if (seq !== loadSeq) return;
      const d = (res && res.data) || {};
      const meta = d.meta || {};
      const payload = d.payload || {};
      const doc = (payload.blog && typeof payload.blog === 'object') ? payload.blog : {};
      const item = contents.find((c) => c.content_id === id) || {};
      const body = blogBodyOf(doc);
      const photos = photoCountOf(payload);
      const values = {
        title: String(doc.title || item.blog_title || '').trim(),
        body: body,
        photoCount: photos == null ? '' : String(photos),
        keywords: String(item.target_keywords || meta.target_keywords || '').trim()
      };
      applyValues(values);
      cardState = { id: d.content_id || id, brand: state.brand, values: Object.assign({}, values), base: Object.assign({}, values) };
      writeCard(cardState);
      refreshCardBar();
      paintCounters();
      paintResult();
      if (body.trim()) toast('카드 ' + cardState.id + ' 를 불러왔어요 · 바로 점검했습니다', 'ok');
      else toast('이 카드에는 블로그 본문이 없어요 — 본문을 넣고 [이 카드에 본문 저장]을 누르세요', 'err');
    } catch (err) {
      if (seq !== loadSeq) return;
      const why = friendlyError(err) || '카드를 불러오지 못했어요.';
      cardSel.value = '';
      cardInfo.textContent = why + ' 카드를 다시 고르면 또 시도합니다.';
      toast(why, 'err');
    }
  }

  /** 고친 제목·본문을 그 카드의 payload.blog 에만 쓴다(해시태그·메모·임시저장 주소 보존). */
  async function saveToCard() {
    if (!cardState) return;
    const id = cardState.id;
    saveCardBtn.disabled = true;
    saveCardBtn.textContent = '저장 중…';
    try {
      const res = await api.getContentDetail(id);
      const d = (res && res.data) || {};
      const payload = d.payload || {};
      const orig = (payload.blog && typeof payload.blog === 'object') ? payload.blog : {};
      /* 2026-11-24: 화면에서 고쳐 저장할 때도 점수·린트 요약을 같이 남긴다 —
         예전에는 본문만 써서 보드의 quality_score 가 옛 값으로 남았다(피클 체험기가 그랬다). */
      const r = lintBlog({
        title: titleEl.value, body: bodyEl.value,
        photoCount: photoEl.value === '' ? undefined : Number(photoEl.value), keywords: kwEl.value
      }, rules);
      const ai = r.aiTone || {};
      const dia = ai.dia || { hits: 0, total: 5 };
      const warnItems = r.items.filter((i) => i.state === 'warn');
      const snap = {
        tool: 'content-hub js/blogLint.js (rules ' + (rules.version || '2026w48') + ')',
        rules_version: rules.version || '2026w48',
        checked_at: new Date().toISOString(),
        score: r.score, pass: r.pass, hold: !!r.hold, hold_reasons: r.holdReasons || [],
        summary: '제목 ' + r.stats.titleChars + '자 · 본문 ' + r.stats.bodyChars.toLocaleString('ko-KR') + '자 · 사진 '
          + r.stats.photos + '장 · 문단 평균 ' + r.stats.avgLine + '자 · 2줄 이하 문단 ' + r.stats.shortLines + '개 · 해시태그 ' + r.stats.hashtags + '개',
        ai_tone: { summary: ai.summary || '', count: ai.count || 0, hold: !!ai.hold, dia: dia.hits + '/' + dia.total },
        verdict: '점수 ' + r.score + ' / 100 — ' + (r.pass ? '통과' : '고칠 것 ' + warnItems.length + '건: ' + warnItems.map((i) => i.label).join(' · ')),
        items: r.items.map((i) => ({ id: i.id, label: i.label, state: i.state, value: i.value, note: i.note }))
      };
      const next = Object.assign({}, orig, {
        title: titleEl.value.trim(),
        body: bodyEl.value,
        lint: snap,
        lint_checked_at: snap.checked_at,
        updated_at: new Date().toISOString()
      });
      await api.updateContent({
        content_id: id,
        expected_version: d.version,
        blog_title: titleEl.value.trim(),
        quality_score: r.score,
        patch: { blog: next }
      });
      const values = cardValues();
      cardState = { id: id, brand: state.brand, values: Object.assign({}, values), base: Object.assign({}, values) };
      writeCard(cardState);
      /* 보드·선택 목록의 제목도 같이 맞춘다(서버를 다시 읽지 않고 이 화면만) */
      const item = contents.find((c) => c.content_id === id);
      if (item) item.blog_title = titleEl.value.trim();
      saveCardBtn.textContent = '이 카드에 본문 저장';
      refreshCardBar();
      toast('카드에 저장했어요 · 본문 ' + Array.from(String(bodyEl.value).replace(/\s+/g, ' ').trim()).length.toLocaleString('ko-KR') + '자', 'ok');
    } catch (err) {
      saveCardBtn.textContent = '이 카드에 본문 저장';
      refreshCardBar();
      const code = err && err.code;
      if (code === 'ERR_VERSION_CONFLICT') toast('다른 곳에서 먼저 바뀌었어요 — 카드를 다시 불러온 뒤 저장해 주세요', 'err');
      else toast(friendlyError(err) || '저장하지 못했어요', 'err');
    }
  }

  cardSel.addEventListener('change', () => {
    const id = cardSel.value;
    if (!id) { loadSeq++; cardState = null; writeCard(null); refreshCardBar(); return; }
    loadCard(id);
  });
  saveCardBtn.addEventListener('click', saveToCard);
  openCardBtn.addEventListener('click', () => { if (cardState && ctx.openDetail) ctx.openDetail(cardState.id); });

  runBtn.addEventListener('click', () => {
    if (cardState) {
      cardState.values = cardValues();
      writeCard(cardState);
      refreshCardBar();
    } else {
      saveDraft();
    }
    paintCounters();
    paintResult();
    const r = lintBlog({ title: titleEl.value, body: bodyEl.value, photoCount: photoEl.value === '' ? undefined : Number(photoEl.value), keywords: kwEl.value }, rules);
    if (r.hold) toast('발행 보류 — ' + (r.holdReasons || []).join(' · '), 'err');
    else toast(r.pass ? '통과 · ' + r.score + '점' : '고칠 것 ' + r.items.filter((i) => i.state === 'warn').length + '개 · ' + r.score + '점',
      r.pass ? 'ok' : 'err');
  });

  /* 카드 모드에서는 수동 초안(DRAFT_KEY)을 건드리지 않는다 — 써 둔 메모가 지워지지 않게. */
  [titleEl, bodyEl, photoEl, kwEl].forEach((el) => el.addEventListener('input', () => {
    if (cardState) { cardState.values = cardValues(); writeCard(cardState); refreshCardBar(); }
    else saveDraft();
    paintCounters();
  }));

  if (cardState) {
    cardSel.value = cardState.id;
    refreshCardBar();
  }
  paintCounters();
  if ((cardState && (cardState.values.title || cardState.values.body)) || draft.title || draft.body) paintResult();

  /* 기준 요약 */
  const guide = h('div', { class: 'panel' },
    h('h3', null, '9항목 기준', h('span', { class: 'tag', text: '2026w48' })));  const g = h('div', { class: 'gate' });
  rules.rules.forEach((r) => g.appendChild(h('div', { class: 'gate-row' },
    h('span', { text: r.label }),
    h('span', { class: 'gv na', text: r.pass || '' }))));
  guide.appendChild(g);
  guide.appendChild(h('p', { class: 'hint', style: 'margin-top:10px',
    text: '판정은 기계적으로 센 값만 봅니다. 톤(담백 구어체·자폭 유머)과 정보의 진위는 사람이 봅니다 — docs/BLOG_STANDARD_v4.md' }));
  main.appendChild(guide);
}
