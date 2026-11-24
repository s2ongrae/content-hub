/**
 * js/lintView.js — 발행 전 린터 화면(#/lint)
 *
 * 상위 24건 실측에서 뽑은 8항목을 기계적으로만 판정한다(사람 판단이 필요한 것은 판정하지 않음).
 * 제목·본문·사진 수·키워드를 넣고 [8항목 검사]를 누르면 PASS/WARN 과 고칠 것이 나온다.
 * 초안은 이 브라우저에만 저장한다(새로고침해도 남게).
 */

import { lintBlog, loadLintRules } from './blogLint.js?v=20261124';
import { analyzeCompliance, complianceLine, withDisclosureNote, stripProfitLinks, stripOwnMoney } from './blogCompliance.js?v=20261124';

const DRAFT_KEY = 'contenthub.lint_draft.v1';

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch (e) { return {}; }
}

function writeDraft(d) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) { /* 무시 */ }
}

const STATE_LABEL = { pass: '통과', near: '주의', warn: '고칠 것' };

export async function renderLintView(main, ctx) {
  const { h, pageHead, toast } = ctx;
  const rules = await loadLintRules();
  const t = rules.targets;
  const draft = readDraft();

  main.appendChild(pageHead('🔍 발행 전 린터',
    '상위 24건 실측 8항목 · 통과하면 그대로 올리면 됩니다'));

  const titleEl = h('input', { type: 'text', value: draft.title || '', placeholder: '예: [봉명동 삼겹살] 미미삼겹 유성점 솔직후기 : …', autocomplete: 'off' });
  const bodyEl = h('textarea', { rows: '14', placeholder: '본문을 붙여넣으세요(정보 카드 → 외관 → 메뉴 → 먹방 → 총평)' });
  bodyEl.value = draft.body || '';
  const photoEl = h('input', { type: 'number', min: '0', inputmode: 'numeric', value: draft.photoCount || '', placeholder: '예: 20' });
  const kwEl = h('input', { type: 'text', value: draft.keywords || '', placeholder: '봉명동맛집, 삼겹살, 늦게까지', autocomplete: 'off' });

  const form = h('div', { class: 'panel' },
    h('h3', null, '초안', h('span', { class: 'tag', text: rules.version })),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '제목' }), titleEl),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '본문' }), bodyEl),
    h('div', { class: 'form-grid two' },
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '사진 수' }), photoEl),
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '노리는 검색어 (쉼표)' }), kwEl)));

  const counters = h('div', { class: 'lint-counters' });
  const resultHost = h('div');
  const runBtn = h('button', { class: 'btn primary block', type: 'button', text: '8항목 검사' });
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
    const head = h('div', { class: 'lint-score' + (r.pass ? ' ok' : '') },
      h('div', { class: 'ls-num', text: String(r.score) }),
      h('div', { class: 'ls-txt' },
        h('strong', { text: r.pass ? '통과 — 발행해도 됩니다' : (warn.length >= 3 ? '미달 — 손볼 곳이 ' + warn.length + '개' : '보완 — ' + warn.length + '개만 고치면 통과') }),
        h('span', { text: '주의 ' + near.length + ' · 고칠 것 ' + warn.length + ' · 기준 ' + rules.version })));

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

  runBtn.addEventListener('click', () => {
    saveDraft();
    paintCounters();
    paintResult();
    const r = lintBlog({ title: titleEl.value, body: bodyEl.value, photoCount: photoEl.value === '' ? undefined : Number(photoEl.value), keywords: kwEl.value }, rules);
    toast(r.pass ? '통과 · ' + r.score + '점' : '고칠 것 ' + r.items.filter((i) => i.state === 'warn').length + '개 · ' + r.score + '점',
      r.pass ? 'ok' : 'err');
  });

  [titleEl, bodyEl, photoEl, kwEl].forEach((el) => el.addEventListener('input', () => { saveDraft(); paintCounters(); }));

  paintCounters();
  if (draft.title || draft.body) paintResult();

  /* 기준 요약 */
  const guide = h('div', { class: 'panel' },
    h('h3', null, '8항목 기준', h('span', { class: 'tag', text: '2026w48' })));
  const g = h('div', { class: 'gate' });
  rules.rules.forEach((r) => g.appendChild(h('div', { class: 'gate-row' },
    h('span', { text: r.label }),
    h('span', { class: 'gv na', text: r.pass || '' }))));
  guide.appendChild(g);
  guide.appendChild(h('p', { class: 'hint', style: 'margin-top:10px',
    text: '판정은 기계적으로 센 값만 봅니다. 톤(담백 구어체·자폭 유머)과 정보의 진위는 사람이 봅니다 — docs/BLOG_STANDARD_v4.md' }));
  main.appendChild(guide);
}
