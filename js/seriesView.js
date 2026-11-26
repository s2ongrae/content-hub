/**
 * js/seriesView.js — 시리즈 · 키워드팩 · 훅 A/B (M2)
 *
 * 시드 JSON(seeds/series_pack_2026w47.json)을 그대로 읽어 화면에 그린다.
 *  · 시리즈: 10편의 커버 문구·첫 2초 훅·20초 대본·해시태그·크로스 포인트. 여기서 바로 DRAFT 콘텐츠를 만들 수 있다.
 *  · 키워드팩: 네이버 자동완성 실측값과 제목 공식. 검색량 수치가 아님을 화면에도 적는다.
 *  · 훅 A/B: 발행 전 체크리스트(편별 저장)와 A/B 설계·판정 규칙.
 *
 * 원칙: 렌더링은 textContent/createElement 만 쓴다(innerHTML 금지). 시드는 읽기 전용이며 여기서 수정하지 않는다.
 */

import { api } from './api.js';
import { renderStudio } from './studioView.js?v=20261126c';
import { loadFormulas, scoreHook } from './yt/hookscore.js';
import { loadingPanel, errorPanel } from './uiState.js?v=20261126a';
import { copyText } from './clipboard.js?v=20261126a';

const PACK_URL = 'seeds/series_pack_2026w47.json';
const AB_KEY = 'contenthub.hook_ab.v1';

let packCache = null;
let openKey = null;      // 열려 있는 편 (seriesId:ep)
let subTab = 'series';   // series | studio | keywords | hooks
let abTarget = null;     // 체크리스트 대상 편

/** 다른 화면(카드 상세 '제작' 탭)에서 연재 화면의 하위 탭을 정해 두고 들어올 때 쓴다. */
export function openSeriesTab(key) {
  if (['series', 'studio', 'keywords', 'hooks'].indexOf(key) >= 0) subTab = key;
}

export async function loadPack(force) {
  if (packCache && !force) return packCache;
  const res = await fetch(`${PACK_URL}?v=2026w47`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`기획 파일을 불러오지 못했습니다 (HTTP ${res.status})`);
  packCache = await res.json();
  return packCache;
}

const STATUS_LABEL = {
  PUBLISHED: '발행 완료',
  READY_TO_SHOOT: '촬영 가능',
  BLOCKED_FACTS: '팩트 확인 필요',
  PLANNED: '앞 편 후 제작'
};
const STATUS_CLASS = {
  PUBLISHED: 'LINKED',
  READY_TO_SHOOT: 'READY',
  BLOCKED_FACTS: 'DRAFT',
  PLANNED: 'DRAFT'
};

function readAB() {
  try { return JSON.parse(localStorage.getItem(AB_KEY)) || {}; } catch (e) { return {}; }
}
function writeAB(obj) {
  try { localStorage.setItem(AB_KEY, JSON.stringify(obj)); } catch (e) { /* 용량 초과 무시 */ }
}


function scriptToText(series, ep) {
  const head = [
    `[${series.name} ${ep.ep}/${series.total}] ${ep.seo_title}`,
    `커버: ${ep.cover_text.replace(/\n/g, ' / ')}`,
    `첫 2초 훅: ${ep.hook_2s}`,
    ep.hook_subtitle ? `첫 2초 자막: ${ep.hook_subtitle.replace(/\n/g, ' / ')}` : '',
    ''
  ].filter(Boolean);
  const rows = ep.script.map((s) => `${s.t}\t${s.shot}\t${s.caption}\t${s.sound}`);
  const tail = [
    '',
    '해시태그: ' + ep.hashtags.join(' '),
    '팩트 슬롯: ' + ep.fact_slots.join(', '),
    '다음 할 일: ' + ep.next_action
  ];
  return head.concat(['구간\t화면\t자막\t소리'], rows, tail).join('\n');
}

export function renderSeriesView(main, ctx) {
  const { h, state, toast } = ctx;
  const brand = state.brand;

  main.replaceChildren();
  main.appendChild(h('div', { class: 'page-head' },
    h('div', null,
      h('h1', { text: '🎬 연재' }),
      h('p', { class: 'sub', text: '연재 대본 · 네이버 자동완성 실측 · 첫 문장 비교' })),
    h('div', { class: 'head-actions' },
      h('span', { class: 'tag', text: brand === 'ppiyak_kimmary' ? '삐약 김메리' : '대전 청년' }))));

  const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': '시리즈 화면 전환' });
  [['series', '연재 대본'], ['studio', '숏폼 작업실'], ['keywords', '검색어'], ['hooks', '첫 문장']].forEach(([key, label]) => {
    seg.appendChild(h('button', {
      type: 'button', class: 'seg-btn', role: 'tab', 'data-sub': key,
      'aria-selected': subTab === key ? 'true' : 'false',
      text: label,
      onclick: () => { subTab = key; renderSeriesView(main, ctx); }
    }));
  });
  main.appendChild(seg);

  const host = h('div', { id: 'series-host' });
  main.appendChild(host);
  host.appendChild(loadingPanel(h, '기획 파일을 불러오는 중이에요…'));

  ctx.main = main;
  loadPack().then((pack) => {
    host.replaceChildren();
    if (subTab === 'series') renderSeries(host, pack, brand, ctx);
    else if (subTab === 'studio') renderStudio(host, { ...ctx, _seedHooks: seedHooks(pack, brand) });
    else if (subTab === 'keywords') renderKeywords(host, pack, brand, ctx);
    else renderHooks(host, pack, brand, ctx);
  }).catch((err) => {
    host.replaceChildren(errorPanel(h, err, {
      title: '기획 파일을 불러오지 못했어요',
      hint: '주소가 https://s2ongrae.github.io/content-hub/ 인지, seeds/series_pack_2026w47.json 이 함께 배포됐는지 확인하세요.',
      onRetry: () => { if (ctx.renderRoute) ctx.renderRoute(); else location.reload(); },
      forceRetry: true
    }));
  });
}

/* 이 브랜드 시드 편들의 첫 2초 훅(중복 제거) — 공방에서 채점·대본 뼈대에 바로 쓴다 */
function seedHooks(pack, brand) {
  const out = [];
  pack.series.filter((s) => s.brand === brand).forEach((s) => s.episodes.forEach((e) => {
    const v = (e.hook_2s || '').trim();
    if (v && out.indexOf(v) < 0 && out.length < 8) out.push(v);
  }));
  return out;
}

/* ────────────────────────── 시리즈 ────────────────────────── */

function renderSeries(host, pack, brand, ctx) {
  const { h, toast, friendlyError } = ctx;
  const list = pack.series.filter((s) => s.brand === brand);
  if (!list.length) {
    host.appendChild(h('div', { class: 'panel' }, h('p', { class: 'hint', text: '이 브랜드의 연재 기획이 아직 없습니다.' })));
    return;
  }

  host.appendChild(h('div', { class: 'panel' },
    h('h3', null, '이 기획 묶음에 대해'),
    h('p', { class: 'hint', text: `${pack.meta.pack_id} · ${pack.meta.generated_at.slice(0, 10)} · 원본 문서 ${pack.meta.source_doc}` }),
    h('p', { class: 'hint', text: '숫자가 [ ] 로 비어 있는 곳은 촬영 당일 직접 채우는 빈칸입니다. 확인하지 않은 숫자는 자막에 쓰지 않습니다.' })));

  list.forEach((series) => {
    const done = series.episodes.filter((e) => e.status === 'PUBLISHED').length;
    const panel = h('div', { class: 'panel' },
      h('h3', null,
        `「${series.name}」`,
        h('span', { class: 'tag', text: `${series.total}편` }),
        h('span', { class: 'tag', text: series.series_id }),
        h('span', { class: 'tag', text: `발행 ${done}` })),
      h('p', { class: 'hint', text: series.promise }),
      h('p', { class: 'hint', text: '연결: ' + series.connection.name_rule + ' / ' + series.connection.next_tease }));

    const wrap = h('div', { class: 'list' });
    series.episodes.forEach((ep) => {
      const key = `${series.series_id}:${ep.ep}`;
      const open = openKey === key;
      wrap.appendChild(h('button', {
        type: 'button', class: 'lrow seed-row', 'aria-expanded': open ? 'true' : 'false',
        onclick: () => { openKey = open ? null : key; renderSeriesView(ctx.main, ctx); }
      },
        h('div', { class: 'l-main' },
          h('div', { class: 'l-title', text: `EP${ep.ep} · ${ep.seo_title}` }),
          h('div', { class: 'l-sub', text: ep.cover_text.replace(/\n/g, ' / ') })),
        h('div', { class: 'l-side' },
          h('span', { class: 'badge ' + (STATUS_CLASS[ep.status] || 'DRAFT'), text: STATUS_LABEL[ep.status] || ep.status }),
          h('span', { class: 'seed-caret', text: open ? '▾' : '▸' }))));

      if (open) wrap.appendChild(episodeDetail(series, ep, ctx));
    });
    panel.appendChild(wrap);
    host.appendChild(panel);
  });

  host.appendChild(connectionPanel(list, h));
}

function kvRow(h, label, value, mono) {
  if (!value) return null;
  return h('div', { class: 'kv' },
    h('span', { class: 'kv-k', text: label }),
    h('span', { class: 'kv-v' + (mono ? ' mono' : ''), text: value }));
}

function episodeDetail(series, ep, ctx) {
  const { h, toast, friendlyError } = ctx;
  const box = h('div', { class: 'seed-detail' });

  const facts = h('div', { class: 'kv-grid' },
    kvRow(h, '제목(SEO)', ep.seo_title),
    kvRow(h, '표지 제목', ep.cover_text.replace(/\n/g, ' / '), true),
    kvRow(h, '첫 2초에 띄울 말', `${ep.hook_2s}  (${ep.hook_type})`),
    kvRow(h, '첫 2초 자막', ep.hook_subtitle ? ep.hook_subtitle.replace(/\n/g, ' / ') : '', true),
    kvRow(h, '중간에 넣을 편 번호', ep.position_anchor),
    kvRow(h, '다음 편 궁금하게 남기는 힌트', ep.open_loop),
    kvRow(h, '해시태그', ep.hashtags.join(' '), true));
  box.appendChild(facts);

  // 생성된 시드의 첫 문장을 같은 규칙으로 즉시 채점한다(공방 ①과 같은 함수)
  const hookLine = h('p', { class: 'hint', text: '첫 문장 채점 중…' });
  loadFormulas().then((formulas) => {
    const r = scoreHook(ep.hook_2s, formulas);
    hookLine.textContent = `첫 문장 채점: ${r.verdict}점 · ${r.band} · 공식 ${r.formula} · 가장 약한 곳 ${r.weakest_label} — ${r.fix}`;
  }).catch(() => { hookLine.textContent = '첫 문장 채점을 불러오지 못했습니다.'; });
  box.appendChild(hookLine);

  const table = h('table', { class: 'seed-table' },
    h('thead', null, h('tr', null,
      h('th', { text: '구간' }), h('th', { text: '화면' }), h('th', { text: '자막' }), h('th', { text: '소리' }))),
    h('tbody', null, ep.script.map((s) => h('tr', null,
      h('td', { class: 'mono', text: s.t }),
      h('td', { text: s.shot }),
      h('td', { text: s.caption }),
      h('td', { class: 'dim', text: s.sound })))));
  box.appendChild(table);

  const cross = h('div', { class: 'kv-grid' },
    kvRow(h, '블로그', ep.cross.blog),
    kvRow(h, '인스타', ep.cross.instagram),
    kvRow(h, '클립', ep.cross.clip),
    kvRow(h, '촬영 때 채울 칸', ep.fact_slots.join(' · '), true),
    kvRow(h, '다음 할 일', ep.next_action));
  box.appendChild(cross);

  const createBtn = h('button', {
    class: 'btn sm primary', type: 'button', title: '이 편을 현황 보드의 초안 칸에 카드로 만듭니다', text: '＋ 현황 보드에 초안 카드로 넣기',
    onclick: async () => {
      createBtn.disabled = true;
      try {
        await api.createContent({
          brand: series.brand,
          place_name: ep.seo_title,
          cluster_id: series.name,
          category: '쇼츠 시리즈',
          target_keywords: ep.keywords.join(', '),
          allow_partial_shortform: false
        });
        toast('현황 보드의 초안 칸에 넣었어요 — 거기서 이어서 채우세요', 'ok');
      } catch (err) {
        toast(friendlyError(err) || String(err), 'err');
      } finally {
        createBtn.disabled = false;
      }
    }
  });

  box.appendChild(h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', {
      class: 'ghost-btn sm', type: 'button', text: '⧉ 대본 전체 복사',
      onclick: () => copyText(scriptToText(series, ep), toast, '대본 복사')
    }),
    createBtn));

  return box;
}

function connectionPanel(list, h) {
  const panel = h('div', { class: 'panel' }, h('h3', null, '시리즈 연결 장치 (이탈 방지)'));
  list.forEach((s) => {
    const c = s.connection;
    panel.appendChild(h('div', { class: 'seed-block' },
      h('strong', { text: s.name }),
      h('div', { class: 'kv-grid' },
        kvRow(h, '배지', c.name_rule),
        kvRow(h, '다음 편 예고', c.next_tease),
        kvRow(h, '중반 앵커', c.mid_anchor),
        kvRow(h, '숨긴 단서', c.open_loop),
        kvRow(h, '고정댓글', c.pinned_question),
        kvRow(h, '루프', c.loop),
        kvRow(h, '재생목록', c.playlist),
        kvRow(h, '이탈 방지', c.dropout_guard))));
  });
  return panel;
}

/* ────────────────────────── 키워드팩 ────────────────────────── */

function renderKeywords(host, pack, brand, ctx) {
  const { h, toast } = ctx;
  const kp = pack.keyword_pack[brand];
  if (!kp) { host.appendChild(h('div', { class: 'panel' }, h('p', { class: 'hint', text: '검색어 모음이 없습니다.' }))); return; }

  host.appendChild(h('div', { class: 'panel' },
    h('h3', null, '읽는 법'),
    h('p', { class: 'hint', text: '자동완성은 "이 말이 실제로 이어진다"는 증거입니다. 검색량 수치는 아닙니다(데이터랩 인증 필요). 순위·볼륨을 주장하지 않습니다.' }),
    h('p', { class: 'hint', text: `실측 시각: ${pack.meta.captured_at}` }),
    h('p', { class: 'hint', text: '타겟 한 문장: ' + kp.target_sentence })));

  kp.clusters.forEach((c) => {
    const all = c.keywords.map((k) => k.q).join(', ');
    const panel = h('div', { class: 'panel' },
      h('h3', null, c.name, h('span', { class: 'tag', text: c.intent })),
      h('table', { class: 'seed-table' },
        h('thead', null, h('tr', null, h('th', { text: '키워드' }), h('th', { text: '자동완성으로 이어지는 말 (실측)' }))),
        h('tbody', null, c.keywords.map((k) => h('tr', null,
          h('td', { class: 'mono', text: k.q }),
          h('td', { class: 'dim', text: k.autocomplete.length ? k.autocomplete.join(' / ') : '(이어지는 말 없음 — 단독 검색만)' }))))),
      h('div', { class: 'kv-grid', style: 'margin-top:10px' },
        kvRow(h, '제목 공식', c.title_formula, true),
        kvRow(h, '상위 패턴', c.top_pattern),
        kvRow(h, '우리 각도', c.our_angle)),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'ghost-btn sm', type: 'button', text: '⧉ 키워드 복사', onclick: () => copyText(all, toast, '키워드 복사') })));
    host.appendChild(panel);
  });
}

/* ────────────────────────── 훅 A/B ────────────────────────── */

function renderHooks(host, pack, brand, ctx) {
  const { h, toast } = ctx;
  const ab = pack.hook_ab;
  const eps = [];
  pack.series.filter((s) => s.brand === brand).forEach((s) => s.episodes.forEach((e) => eps.push({ s, e })));
  if (!abTarget) abTarget = `${eps[0].s.series_id}:${eps[0].e.ep}`;

  const select = h('select', { 'aria-label': '편 선택', onchange: (ev) => { abTarget = ev.target.value; renderSeriesView(ctx.main, ctx); } });
  eps.forEach(({ s, e }) => {
    const key = `${s.series_id}:${e.ep}`;
    select.appendChild(h('option', { value: key, selected: key === abTarget ? true : null, text: `${s.name} EP${e.ep} — ${e.seo_title}` }));
  });

  const stateAB = readAB();
  const target = eps.filter(({ s, e }) => `${s.series_id}:${e.ep}` === abTarget)[0] || eps[0];
  const key = `${target.s.series_id}:${target.e.ep}`;
  const checks = Array.isArray(stateAB[key]) ? stateAB[key] : [];

  const panel = h('div', { class: 'panel' },
    h('h3', null, '발행 전 체크리스트', h('span', { class: 'tag', text: '10초' })),
    h('label', { class: 'field' }, h('span', { class: 'field-label', text: '편 선택' }), select),
    h('p', { class: 'hint', text: `첫 문장: ${target.e.hook_2s}` }));

  const list = h('div', { class: 'check-list' });
  ab.checklist.forEach((item, i) => {
    const cb = h('input', {
      type: 'checkbox', checked: checks[i] ? true : null,
      onchange: (ev) => {
        const cur = readAB();
        const arr = Array.isArray(cur[key]) ? cur[key] : [];
        arr[i] = ev.target.checked;
        cur[key] = arr;
        writeAB(cur);
        updateScore();
      }
    });
    list.appendChild(h('label', { class: 'check-row' }, cb, h('span', { text: item })));
  });
  panel.appendChild(list);

  const score = h('p', { class: 'hint', style: 'margin-top:10px' });
  function updateScore() {
    const cur = readAB();
    const arr = Array.isArray(cur[key]) ? cur[key] : [];
    const ok = ab.checklist.filter((_, i) => arr[i]).length;
    score.textContent = `${ok} / ${ab.checklist.length} 통과` + (ok === ab.checklist.length ? ' — 발행해도 됩니다' : ' — 미통과 항목은 발행 전에 고칩니다');
  }
  updateScore();
  panel.appendChild(score);
  panel.appendChild(h('div', { class: 'row', style: 'margin-top:8px' },
    h('button', { class: 'ghost-btn sm', type: 'button', text: '전체 초기화', onclick: () => {
      const cur = readAB(); delete cur[key]; writeAB(cur);
      toast('이 편 체크를 초기화했습니다', 'ok');
      renderSeriesView(ctx.main, ctx);
    } })));
  host.appendChild(panel);

  host.appendChild(h('div', { class: 'panel' },
    h('h3', null, 'A/B 설계와 판정'),
    h('div', { class: 'kv-grid' },
      kvRow(h, '문제', ab.ab_design.problem),
      kvRow(h, '방법', ab.ab_design.method),
      kvRow(h, '잠그는 변수', ab.ab_design.locked_variables.join(', ')),
      kvRow(h, '지표', ab.ab_design.metrics.join(' · ')),
      kvRow(h, '기록 방법', ab.ab_design.record_rule),
      kvRow(h, '어느 쪽이 나은지 정하는 법', ab.ab_design.decision_rule)),
    h('p', { class: 'hint', style: 'margin-top:8px', text: '한 영상에 첫 문장 두 개를 걸 수는 없습니다. 같은 포맷·같은 길이의 짝 편에 서로 다른 첫 문장을 놓고, 올린 지 24시간 뒤 3초 잔존율을 비교합니다.' })));
}
