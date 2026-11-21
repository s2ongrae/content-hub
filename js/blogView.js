/**
 * js/blogView.js — 내 블로그(#/blog)
 *
 * 네이버 '블로그 관리 → 통계'를 따로 열지 않고 여기서 보는 화면.
 * 데이터는 GAS(gas/Blog.gs)가 네이버 공개 데이터(로그인 불필요)를 모아 시트에 쌓은 것이다.
 *
 *  ① 큰 숫자 4개 — 어제 방문자 · 최근 7일 방문자(앞 7일 대비) · 이번 달 발행 · 최근 7일 반응(댓글+공감)
 *  ② 방문자 막대(최근 30일) — 네이버는 최근 5일만 주므로 매일 자동 수집으로 쌓는다
 *  ③ 글 목록 — 댓글·공감과 7일 증가분, [점검]을 누르면 발행된 본문을 린터 8항목으로 채점
 *  ④ 카테고리별 평균 반응
 *  ⑤ 검색 순위 — 네이버 검색 API(블로그) 상위 100위 안 내 글 위치
 *
 * 글별 조회수·유입 검색어는 네이버가 로그인한 본인에게만 보여 주므로 가져오지 않는다(성과 탭 수동 입력).
 * 렌더링은 h()(createElement + textContent)만 쓴다.
 */
import { lintBlog, loadLintRules } from './blogLint.js?v=20261118';
import { normalizeKeywords, trendRows, budgetText, rangeText } from './blogTrend.js?v=20261121h';
import { axisShort, trendChip, trendTone, rankChip, docChip, splitRows, makeSeoSeed, putSeoSeed, titleLen } from './blogSeo.js?v=20261121a';

const STATE_LABEL = { pass: '통과', near: '주의', warn: '고칠 것' };

let loading = false;

/* ───────────── 날짜·숫자 ───────────── */

function kstDay(offsetDays = 0) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
const nf = (n) => Number(n || 0).toLocaleString('ko-KR');
const signed = (n) => (n > 0 ? '+' + nf(n) : n < 0 ? '−' + nf(-n) : '0');

function daysBetween(a, b) {
  const x = Date.parse(String(a).slice(0, 10) + 'T00:00:00+09:00');
  const y = Date.parse(String(b).slice(0, 10) + 'T00:00:00+09:00');
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.round((y - x) / 86400000);
}

/* ───────────── 데이터 ───────────── */

export async function loadBlogStats(state, api) {
  if (!api || !api.configured) { state.blog = null; state.blogError = 'ERR_NO_CONFIG'; return; }
  if (loading) return;
  loading = true;
  try {
    const res = await api.listBlogStats({ brand: state.brand, days: 60 });
    state.blog = res.data || null;
    state.blogError = null;
    state.blogBrand = state.brand;
  } catch (err) {
    state.blog = null;
    state.blogError = (err && err.code) || 'ERR_UNKNOWN';
    state.blogErrorMsg = (err && err.message) || '';
  } finally {
    loading = false;
  }
}

/** 순수 계산 — 화면 위 숫자들 */
export function summarize(blog) {
  const visitors = (blog && blog.visitors) || [];
  const posts = (blog && blog.posts) || [];
  const today = kstDay(0);
  const byDay = new Map(visitors.map((v) => [v.day, v.visitors]));
  const sumRange = (from, to) => {
    let s = 0, n = 0;
    for (let d = from; d <= to; d++) {
      const key = kstDay(d);
      if (byDay.has(key)) { s += byDay.get(key); n++; }
    }
    return { s, n };
  };
  const yesterday = byDay.has(kstDay(-1)) ? byDay.get(kstDay(-1)) : null;
  const last7 = sumRange(-7, -1);
  const prev7 = sumRange(-14, -8);
  const month = today.slice(0, 7);
  const monthPosts = posts.filter((p) => String(p.published_at).slice(0, 7) === month).length;
  const dates = posts.map((p) => String(p.published_at).slice(0, 10)).filter(Boolean).sort();
  const lastPost = dates.length ? dates[dates.length - 1] : '';
  const recent = dates.slice(-6);
  let gap = null;
  if (recent.length >= 2) gap = Math.round(daysBetween(recent[0], recent[recent.length - 1]) / (recent.length - 1));
  const react7 = posts.reduce((s, p) => s + (p.comment_7d || 0) + (p.sympathy_7d || 0), 0);
  const hasDelta = posts.some((p) => p.comment_7d != null);
  return {
    yesterday, todayCount: byDay.has(today) ? byDay.get(today) : null,
    last7: last7.n ? last7.s : null, last7Days: last7.n,
    prev7: prev7.n ? prev7.s : null,
    monthPosts, totalPosts: posts.length,
    lastPost, sinceLast: lastPost ? daysBetween(lastPost, today) : null, gap,
    react7: hasDelta ? react7 : null
  };
}

/** 카테고리별 글 수·평균 댓글·공감 */
export function byCategory(posts) {
  const map = new Map();
  (posts || []).forEach((p) => {
    const k = String(p.category || '(없음)').replace(/\s+/g, ' ').trim();
    const c = map.get(k) || { name: k, n: 0, comment: 0, sympathy: 0 };
    c.n++; c.comment += p.comment_cnt || 0; c.sympathy += p.sympathy_cnt || 0;
    map.set(k, c);
  });
  return Array.from(map.values()).map((c) => ({
    name: c.name, n: c.n,
    avgComment: Math.round((c.comment / c.n) * 10) / 10,
    avgSympathy: Math.round((c.sympathy / c.n) * 10) / 10
  })).sort((a, b) => (b.avgComment + b.avgSympathy) - (a.avgComment + a.avgSympathy));
}

/* ───────────── 화면 ───────────── */

export function renderBlogView(main, ctx) {
  const { h, state, api, pageHead, toast, friendlyError, banner, BRANDS } = ctx;
  const brand = BRANDS[state.brand] || {};

  const syncBtn = h('button', {
    class: 'btn sm primary', type: 'button', text: '↻ 네이버에서 가져오기',
    title: '글 목록·댓글·공감·최근 방문자 수를 지금 다시 모읍니다',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '가져오는 중…';
      try {
        const res = await api.blogSync({ brand: state.brand });
        const d = res.data || {};
        toast('글 ' + d.posts + '개' + (d.new_posts ? ' (새 글 ' + d.new_posts + ')' : '') + ' · 방문자 ' + d.visitor_days + '일치를 가져왔어요', 'ok');
        await loadBlogStats(state, api);
      } catch (err) {
        toast(blogErrorText(err.code, err.message) || friendlyError(err), 'err');
      }
      ctx.renderRoute();
    }
  });

  const blogId = state.blog && state.blog.blog_id;
  main.appendChild(pageHead('📝 내 블로그',
    blogId
      ? blogId + (state.blog.last_synced_at ? ' · ' + relTimeSafe(ctx, state.blog.last_synced_at) + ' 가져옴' : ' · 아직 안 가져옴')
      : '네이버 블로그 통계를 여기서 봅니다',
    state.brand === 'daejeon_youth' && api.mode !== 'unconfigured' ? syncBtn : null));

  if (state.brand !== 'daejeon_youth') {
    main.appendChild(h('div', { class: 'panel' },
      h('h3', null, (brand.emoji || '') + ' ' + (brand.name || '') + ' 트랙은 블로그를 쓰지 않아요'),
      h('p', { class: 'hint', text: '이 트랙은 쇼츠·릴스·클립만 올립니다. 위에서 🍺 대전 청년으로 바꾸면 블로그 통계가 보여요.' })));
    return;
  }

  if (api.mode === 'unconfigured') {
    main.appendChild(h('div', { class: 'panel' },
      h('h3', null, '⚙︎ 연결하면 블로그 숫자가 보입니다'),
      h('p', { class: 'hint', text: 'GAS URL과 API 토큰을 연결하면 네이버 블로그의 글·댓글·공감·방문자 수를 모아 여기 그립니다.' })));
    return;
  }

  if (state.blogBrand !== state.brand || (!state.blog && !state.blogError)) {
    main.appendChild(h('div', { class: 'empty', text: '블로그 숫자를 읽는 중…' }));
    loadBlogStats(state, api).then(() => { if (state.route === 'blog') ctx.renderRoute(); });
    return;
  }

  if (state.blogError) {
    const notDeployed = ['ERR_NOT_IMPLEMENTED', 'ERR_UNKNOWN_ACTION', 'ERR_ACTION_NOT_ALLOWED', 'ERR_NOT_FOUND'].includes(state.blogError);
    main.appendChild(banner('info', 'ⓘ', notDeployed ? '서버 업데이트가 필요해요' : '블로그 숫자를 못 읽었어요',
      notDeployed
        ? 'Apps Script에 gas/Blog.gs를 붙여넣고 새 버전으로 배포하면 이 화면이 켜집니다.'
        : blogErrorText(state.blogError, state.blogErrorMsg)));
    return;
  }

  const blog = state.blog;
  if (!blog.posts.length) {
    main.appendChild(h('div', { class: 'panel' },
      h('h3', null, '처음 한 번 가져오기'),
      h('p', { class: 'hint', text: '오른쪽 위 [↻ 네이버에서 가져오기]를 누르면 글 목록과 최근 5일 방문자 수가 시트에 쌓이기 시작합니다.' })));
    main.appendChild(setupPanel(h, blog));
    return;
  }

  const s = summarize(blog);

  /* ⓪ 오늘의 추천 제목 10 — 아침에 서버가 만든 줄(0토큰). 누르면 초안 스튜디오로 넘긴다. */
  main.appendChild(seoPanel(h, ctx));

  /* ① 큰 숫자 */
  const trend = (s.last7 != null && s.prev7) ? Math.round(((s.last7 - s.prev7) / s.prev7) * 100) : null;
  main.appendChild(h('div', { class: 'kpi-grid blog-kpis' },
    kpi(h, '어제 방문자', s.yesterday == null ? '—' : nf(s.yesterday), s.todayCount != null ? '오늘 지금까지 ' + nf(s.todayCount) : '명'),
    kpi(h, '최근 7일 방문자', s.last7 == null ? '—' : nf(s.last7),
      trend == null ? (s.last7Days < 7 ? s.last7Days + '일치만 있음' : '앞 7일 기록 없음') : '앞 7일보다 ' + (trend >= 0 ? '+' : '') + trend + '%'),
    kpi(h, '이번 달 발행', nf(s.monthPosts) + '편',
      s.sinceLast == null ? '' : '마지막 글 ' + (s.sinceLast === 0 ? '오늘' : s.sinceLast + '일 전') + (s.gap ? ' · 평균 ' + s.gap + '일 간격' : '')),
    kpi(h, '최근 7일 반응', s.react7 == null ? '—' : signed(s.react7), s.react7 == null ? '내일부터 비교돼요' : '댓글 + 공감 늘어난 수')));

  /* ② 방문자 막대 */
  main.appendChild(visitorChart(h, blog.visitors));

  /* ②-2 로그인해야 보이는 통계(피클이 매일 보냄) */
  main.appendChild(ingestStatus(h, blog));
  const insights = insightPanels(h, blog);
  if (insights) main.appendChild(insights);

  /* ③ 글 목록 */
  main.appendChild(postList(h, ctx, blog));

  /* ④ 카테고리 */
  main.appendChild(categoryPanel(h, blog.posts));

  /* ⑤ 검색 순위 */
  main.appendChild(rankPanel(h, ctx, blog));

  /* ⑤-2 키워드 트렌드 — 네이버 데이터랩 검색어 트렌드(서버가 일·월 천장을 지킨다) */
  main.appendChild(trendPanel(h, ctx, blog));

  main.appendChild(setupPanel(h, blog));
}

/* ───────────── 오늘의 추천 제목 10 (gas/BlogSeo.gs) ───────────── */

let seoLoading = false;

/** 오늘 줄을 서버에서 받아 온다. 같은 날 두 번 불러도 서버는 저장된 줄을 돌려준다. */
export async function loadBlogSeo(state, api, opts) {
  if (!api || !api.configured) { state.blogSeo = { error: 'ERR_NO_CONFIG' }; return; }
  if (seoLoading) return;
  seoLoading = true;
  try {
    const res = await api.blogSeoTitles(Object.assign({ brand: state.brand }, opts || {}));
    state.blogSeo = { data: res.data || null, at: Date.now() };
  } catch (err) {
    state.blogSeo = { error: (err && err.code) || 'ERR_UNKNOWN', msg: (err && err.message) || '' };
  } finally {
    seoLoading = false;
  }
}

function seoPanel(h, ctx) {
  const { state, api, toast } = ctx;
  const panel = h('div', { class: 'panel seo-panel' },
    h('h3', null, '오늘의 추천 제목 10', h('span', { class: 'tag', text: '매일 08:30 · 무료 규칙' })));

  const saved = state.blogSeo;
  if (!saved) {
    panel.appendChild(h('p', { class: 'hint', text: '오늘의 제목을 가져오는 중…' }));
    loadBlogSeo(state, api).then(() => { if (state.route === 'blog') ctx.renderRoute(); });
    return panel;
  }

  if (saved.error) {
    const notDeployed = ['ERR_UNKNOWN_ACTION', 'ERR_ACTION_NOT_ALLOWED', 'ERR_NOT_IMPLEMENTED', 'ERR_NOT_FOUND'].includes(saved.error);
    panel.appendChild(h('p', { class: 'hint' + (notDeployed ? '' : ' err'),
      text: notDeployed
        ? '서버에 이 기능(gas/BlogSeo.gs)이 아직 안 올라갔어요. 새 버전으로 배포하면 여기에 매일 아침 제목 10개가 뜹니다.'
        : (saved.msg || blogErrorText(saved.error, saved.msg) || '제목을 가져오지 못했어요.') }));
    panel.appendChild(h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', {
        class: 'btn sm', type: 'button', text: '↻ 다시 시도',
        onclick: () => { state.blogSeo = null; ctx.renderRoute(); }
      })));
    return panel;
  }

  const data = saved.data || {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) {
    panel.appendChild(h('p', { class: 'hint', text: data.fallback || '오늘은 뽑힌 제목이 없어요. [↻ 다시 뽑기]를 눌러 보세요.' }));
  } else {
    const { first, rest } = splitRows(rows);
    panel.appendChild(seoList(h, ctx, first, data));
    if (rest.length) {
      panel.appendChild(h('details', { class: 'seo-more' },
        h('summary', { text: '나머지 ' + rest.length + '개 펼치기' }),
        seoList(h, ctx, rest, data)));
    }
  }

  if (data.pattern && data.pattern.text) {
    panel.appendChild(h('p', { class: 'hint', style: 'margin-top:10px', text: '📐 ' + data.pattern.text }));
  }
  if (data.fallback) {
    panel.appendChild(h('p', { class: 'hint', style: 'color:var(--warn)', text: data.fallback }));
  }

  const refresh = h('button', {
    class: 'btn xs', type: 'button', text: '↻ 다시 뽑기',
    title: '오늘 제목을 새로 만듭니다(데이터랩 4회 · 검색 18회, 무료 한도 안)',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '뽑는 중…';
      await loadBlogSeo(state, api, { refresh: true });
      const after = state.blogSeo || {};
      toast(after.error ? '다시 뽑지 못했어요 — ' + (after.msg || after.error) : '오늘 제목을 다시 뽑았습니다', after.error ? 'err' : 'ok');
      ctx.renderRoute();
    }
  });

  panel.appendChild(h('div', { class: 'row', style: 'margin-top:10px;align-items:center;gap:8px' },
    refresh,
    h('span', { class: 'hint', style: 'margin:0',
      text: (data.day ? data.day.slice(5).replace('-', '/') + ' 기준 · ' : '')
        + (data.cached ? '아침에 만든 그대로' : '지금 만듦') })));
  panel.appendChild(h('p', { class: 'hint',
    text: '제목을 누르면 그 제목·키워드가 초안 스튜디오로 넘어갑니다. 발행은 직접 하시고, 여기서는 임시저장까지 준비합니다.' }));
  if (data.note) panel.appendChild(h('p', { class: 'hint', text: data.note }));
  return panel;
}

function seoList(h, ctx, rows, data) {
  const { toast } = ctx;
  const list = h('div', { class: 'list seo-list' });
  rows.forEach((r) => {
    const len = titleLen(r.title);
    const go = () => {
      const seed = makeSeoSeed(r, data.axes, data.day);
      if (seed) putSeoSeed(seed);
      location.hash = '#/create/blog';
      toast('이 제목으로 초안을 시작합니다 — 사진·메모를 넣으면 2줄 호흡 초안이 나와요', 'ok');
    };
    const titleBtn = h('button', { class: 'seo-title', type: 'button', text: r.title, onclick: go });
    const head = h('div', { class: 'seo-head' },
      h('span', { class: 'seo-axis ' + String(r.axis || ''), text: axisShort(r.axis) }),
      titleBtn,
      len.over ? h('span', { class: 'tag', text: len.len + '자 · 김' }) : null);
    const sub = h('div', { class: 'l-sub', style: 'white-space:normal;overflow:visible;line-height:1.45' },
      h('em', { class: 'delta' + trendTone(r), text: trendChip(r) }),
      h('span', { text: ' · ' + rankChip(r) }),
      docChip(r) ? h('span', { text: ' · ' + docChip(r) }) : null,
      h('span', { text: ' · ' + (r.reason || '') }));
    const side = h('div', { class: 'l-side' },
      h('button', { class: 'btn xs primary', type: 'button', text: '초안', title: '이 제목으로 #/create/blog 시작', onclick: go }));
    list.appendChild(h('div', { class: 'lrow seo-row' },
      h('div', { class: 'l-main', style: 'min-width:0' }, head, sub), side));
  });
  return list;
}

function relTimeSafe(ctx, iso) {
  try { return ctx.relTime ? ctx.relTime(iso) : String(iso).slice(0, 16).replace('T', ' '); }
  catch (e) { return String(iso).slice(0, 16).replace('T', ' '); }
}
function blogErrorText(code, msg) {
  switch (code) {
    case 'ERR_BLOG_UNREACHABLE': return '네이버가 잠깐 응답하지 않았어요. 조금 뒤 다시 눌러 주세요.';
    case 'ERR_BLOG_FORMAT': return msg || '네이버 화면 형식이 바뀐 것 같아요. 개발 쪽 확인이 필요합니다.';
    case 'ERR_BLOG_SKIPPED': return '이 브랜드는 블로그를 쓰지 않아요.';
    case 'ERR_NO_NAVER_KEY': return msg || '네이버 검색 API 키가 필요해요.';
    default: return msg ? (code + ' · ' + msg) : '';
  }
}

function kpi(h, label, value, sub) {
  return h('div', { class: 'kpi' },
    h('div', { class: 'kpi-k', text: label }),
    h('div', { class: 'kpi-v', text: value }),
    sub ? h('div', { class: 'kpi-s', text: sub }) : null);
}

function visitorChart(h, visitors) {
  const days = [];
  const map = new Map((visitors || []).map((v) => [v.day, v.visitors]));
  for (let d = -29; d <= 0; d++) days.push({ day: kstDay(d), v: map.has(kstDay(d)) ? map.get(kstDay(d)) : null });
  const max = Math.max(1, ...days.map((d) => d.v || 0));
  const known = days.filter((d) => d.v != null).length;

  const bars = h('div', { class: 'vbars', role: 'img', 'aria-label': '최근 30일 방문자 수 막대' });
  days.forEach((d) => {
    const pct = d.v == null ? 0 : Math.max(2, Math.round((d.v / max) * 100));
    const isToday = d.day === kstDay(0);
    bars.appendChild(h('div', { class: 'vbar' + (d.v == null ? ' none' : '') + (isToday ? ' today' : ''),
      title: d.day.slice(5).replace('-', '/') + ' · ' + (d.v == null ? '기록 없음' : nf(d.v) + '명') + (isToday ? ' (오늘, 집계 중)' : '') },
      h('i', { style: 'height:' + pct + '%' })));
  });

  return h('div', { class: 'panel' },
    h('h3', null, '방문자 · 최근 30일', h('span', { class: 'tag', text: '최고 ' + nf(max) + '명' })),
    bars,
    h('div', { class: 'vbar-axis' }, h('span', { text: days[0].day.slice(5).replace('-', '/') }), h('span', { text: '오늘' })),
    known < 10 ? h('p', { class: 'hint', style: 'margin-top:8px',
      text: '네이버는 최근 5일 방문자만 알려 줘요. 매일 자동으로 가져오게 켜 두면(아래 설정) 막대가 하루씩 채워집니다.' }) : null);
}

const SORTS = [
  { k: 'new', label: '최신순', fn: (a, b) => String(b.published_at).localeCompare(String(a.published_at)) },
  { k: 'views', label: '조회수 순', fn: (a, b) => (b.views_total || 0) - (a.views_total || 0) },
  { k: 'react', label: '반응 많은 순', fn: (a, b) => (b.comment_cnt + b.sympathy_cnt) - (a.comment_cnt + a.sympathy_cnt) },
  { k: 'week', label: '이번 주 뜨는 글', fn: (a, b) => ((b.comment_7d || 0) + (b.sympathy_7d || 0)) - ((a.comment_7d || 0) + (a.sympathy_7d || 0)) }
];

function postList(h, ctx, blog) {
  const { state } = ctx;
  const sortKey = state.blogSort || 'new';
  const sort = SORTS.find((s) => s.k === sortKey) || SORTS[0];
  const posts = blog.posts.slice().sort(sort.fn);

  const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': '글 정렬' },
    SORTS.map((s) => h('button', {
      type: 'button', class: 'seg-btn', role: 'tab', 'aria-selected': s.k === sortKey ? 'true' : 'false',
      text: s.label, onclick: () => { state.blogSort = s.k; ctx.renderRoute(); }
    })));

  const list = h('div', { class: 'list blog-list' });
  posts.forEach((p) => list.appendChild(postRow(h, ctx, p)));

  return h('div', { class: 'panel' },
    h('h3', null, '글', h('span', { class: 'tag', text: String(posts.length) })),
    seg, list,
    h('p', { class: 'hint', style: 'margin-top:10px',
      text: '[점검]은 발행된 본문을 읽어 상위노출 8항목으로 채점합니다. 글별 조회수는 네이버가 공개하지 않아 성과 탭에서 직접 넣어 주세요.' }));
}

function postRow(h, ctx, p) {
  const { state, api, toast, friendlyError } = ctx;
  const delta = (n) => (n == null || n === 0) ? null : h('em', { class: 'delta' + (n > 0 ? ' up' : ''), text: signed(n) });
  const result = h('div', { class: 'blog-lint' });
  const cached = (state.blogLint || {})[p.log_no];
  if (cached) fillLint(h, result, cached);

  const checkBtn = h('button', {
    class: 'btn xs', type: 'button', text: cached ? '다시 점검' : '점검',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '읽는 중…';
      try {
        const [res, rules] = await Promise.all([api.blogPostBody({ brand: state.brand, log_no: p.log_no }), loadLintRules()]);
        const d = res.data || {};
        const r = lintBlog({ title: d.title || p.title, body: d.body, photoCount: d.photo_count }, rules);
        r.videos = d.video_count;
        state.blogLint = Object.assign({}, state.blogLint, { [p.log_no]: r });
        fillLint(h, result, r);
        btn.textContent = '다시 점검';
      } catch (err) {
        toast(blogErrorText(err.code, err.message) || friendlyError(err), 'err');
        btn.textContent = '점검';
      }
      btn.disabled = false;
    }
  });

  const sub = [String(p.category || '').replace(/\s+/g, ' ').trim(), String(p.published_at).slice(0, 10), p.photo_count ? '사진 ' + p.photo_count : '']
    .filter(Boolean).join(' · ');

  return h('div', { class: 'lrow blog-row' },
    h('div', { class: 'l-main' },
      h('a', { class: 'l-title blog-link', href: p.url, target: '_blank', rel: 'noopener noreferrer', text: p.title || p.log_no }),
      h('div', { class: 'l-sub', text: sub }),
      result),
    h('div', { class: 'l-side blog-side' },
      p.views_total != null ? h('span', { class: 'blog-num', title: '조회수' + (p.views_7d != null ? ' · 최근 7일 ' + nf(p.views_7d) : '') }, '👁 ' + nf(p.views_total), p.views_7d ? h('em', { class: 'delta up', text: '+' + nf(p.views_7d) }) : null) : null,
      h('span', { class: 'blog-num', title: '댓글' + (p.comment_7d != null ? ' · 7일 ' + signed(p.comment_7d) : '') }, '💬 ' + nf(p.comment_cnt), delta(p.comment_7d)),
      h('span', { class: 'blog-num', title: '공감' + (p.sympathy_7d != null ? ' · 7일 ' + signed(p.sympathy_7d) : '') }, '♥ ' + nf(p.sympathy_cnt), delta(p.sympathy_7d)),
      p.content_id ? h('button', { class: 'btn xs ghost', type: 'button', text: '카드', title: p.content_id + ' 카드 열기',
        onclick: () => ctx.openDetail && ctx.openDetail(p.content_id) }) : null,
      checkBtn));
}

function fillLint(h, box, r) {
  while (box.firstChild) box.removeChild(box.firstChild);
  const scored = r.items.filter((it) => it.weight > 0);
  const fixes = scored.filter((it) => it.state !== 'pass');
  box.appendChild(h('div', { class: 'blog-lint-head' },
    h('strong', { class: 'score ' + (r.score >= 80 ? 'good' : r.score >= 60 ? 'mid' : 'low'), text: r.score + '점' }),
    h('span', { text: '본문 ' + nf(r.stats.bodyChars) + '자 · 사진 ' + r.stats.photos + '장' + (r.videos ? ' · 영상 ' + r.videos : '') + ' · 태그 ' + r.stats.hashtags + '개' })));
  if (!fixes.length) {
    box.appendChild(h('div', { class: 'blog-lint-ok', text: '8항목 모두 통과' }));
    return;
  }
  const ul = h('ul', { class: 'blog-lint-list' });
  fixes.forEach((it) => ul.appendChild(h('li', { class: it.state },
    h('b', { text: STATE_LABEL[it.state] || it.state }),
    h('span', { text: it.label + ' — ' + (it.value != null ? it.value + ' · ' : '') + (it.note || it.fix) }))));
  box.appendChild(ul);
}

function categoryPanel(h, posts) {
  const cats = byCategory(posts);
  if (cats.length < 2) return h('span');
  const list = h('div', { class: 'cat-list' });
  const max = Math.max(1, ...cats.map((c) => c.avgComment + c.avgSympathy));
  cats.forEach((c) => {
    const pct = Math.round(((c.avgComment + c.avgSympathy) / max) * 100);
    list.appendChild(h('div', { class: 'cat-row' },
      h('div', { class: 'cat-name', text: c.name }),
      h('div', { class: 'cat-bar' }, h('i', { style: 'width:' + pct + '%' })),
      h('div', { class: 'cat-num', text: c.n + '편 · 💬' + c.avgComment + ' ♥' + c.avgSympathy })));
  });
  return h('div', { class: 'panel' },
    h('h3', null, '카테고리별 평균 반응'),
    list,
    h('p', { class: 'hint', style: 'margin-top:8px', text: '한 편당 평균 댓글·공감. 반응이 큰 카테고리를 더 쓰면 이웃 반응이 따라옵니다.' }));
}

function rankPanel(h, ctx, blog) {
  const { state, api, toast, friendlyError } = ctx;
  const panel = h('div', { class: 'panel' }, h('h3', null, '검색 순위', h('span', { class: 'tag', text: '네이버 블로그 탭 · 상위 100' })));

  if (blog.ranks && blog.ranks.length) {
    const list = h('div', { class: 'list rank-list' });
    blog.ranks.forEach((r) => {
      const post = blog.posts.find((p) => p.log_no === r.log_no);
      let move = null;
      if (r.prev_rank != null && r.rank && r.prev_rank) {
        const diff = r.prev_rank - r.rank;
        if (diff) move = h('em', { class: 'delta' + (diff > 0 ? ' up' : ''), text: (diff > 0 ? '▲' : '▼') + Math.abs(diff) });
      }
      list.appendChild(h('div', { class: 'lrow' },
        h('div', { class: 'l-main' },
          h('div', { class: 'l-title', text: r.keyword }),
          h('div', { class: 'l-sub', text: (post ? post.title : r.rank ? '글 번호 ' + r.log_no : '100위 안에 없음') + ' · ' + String(r.checked_at).slice(5, 16).replace('T', ' ') })),
        h('div', { class: 'l-side' },
          h('strong', { class: 'rank-pos' + (r.rank && r.rank <= 10 ? ' top' : ''), text: r.rank ? r.rank + '위' : '—' }), move)));
    });
    panel.appendChild(list);
  }

  if (!blog.search_api_ready) {
    panel.appendChild(h('p', { class: 'hint', style: 'margin-top:8px',
      text: '순위를 보려면 네이버 검색 API 키가 한 번 필요해요(무료). 아래 [설정]의 순서대로 넣으면 여기서 바로 확인됩니다.' }));
    return panel;
  }

  const input = h('input', { type: 'text', placeholder: '키워드를 쉼표로 (최대 10개) 예: 봉명동 냉삼, 대전 삼겹살',
    value: state.blogKeywords || (blog.ranks || []).map((r) => r.keyword).slice(0, 10).join(', ') });
  input.addEventListener('input', () => { state.blogKeywords = input.value; });

  const hints = (blog.keyword_hints || []).slice(0, 12);
  const chips = hints.length ? h('div', { class: 'kw-chips' }, hints.map((k) => h('button', {
    type: 'button', class: 'kw-chip', text: '+ ' + k,
    onclick: () => {
      const cur = input.value.split(',').map((x) => x.trim()).filter(Boolean);
      if (!cur.includes(k)) cur.push(k);
      input.value = cur.slice(0, 10).join(', ');
      state.blogKeywords = input.value;
    }
  }))) : null;

  const btn = h('button', {
    class: 'btn sm primary', type: 'button', text: '순위 확인',
    onclick: async () => {
      const kws = input.value.split(',').map((x) => x.trim()).filter(Boolean);
      if (!kws.length) { toast('키워드를 하나 이상 적어 주세요', 'err'); return; }
      btn.disabled = true; btn.textContent = '확인 중…';
      try {
        const res = await api.blogRankCheck({ brand: state.brand, keywords: kws.slice(0, 10) });
        const found = (res.data.results || []).filter((r) => r.rank).length;
        toast(kws.length + '개 중 ' + found + '개가 100위 안에 있어요', 'ok');
        await loadBlogStats(state, api);
        ctx.renderRoute();
      } catch (err) {
        toast(blogErrorText(err.code, err.message) || friendlyError(err), 'err');
        btn.disabled = false; btn.textContent = '순위 확인';
      }
    }
  });

  panel.appendChild(h('div', { class: 'rank-form' }, input, btn));
  if (chips) panel.appendChild(chips);
  panel.appendChild(h('p', { class: 'hint', style: 'margin-top:8px',
    text: '네이버 검색 API의 블로그 검색(정확도순) 기준입니다. 통합검색 화면의 스마트블록 위치와는 조금 다를 수 있어요.' }));
  return panel;
}

/* ───────────── 키워드 트렌드 (네이버 데이터랩) ───────────── */

function trendRow(h, r) {
  const badge = r.season ? h('span', { class: 'tag', text: r.season }) : null;
  const deltaClass = r.delta == null ? '' : r.delta > 0 ? ' up' : '';
  const bars = r.bars.map((b) => h('i', {
    style: 'flex:1;height:' + Math.max(6, b.pct) + '%;background:var(--accent);border-radius:2px;opacity:'
      + (0.3 + (b.pct / 100) * 0.7),
    title: b.period + ' · ' + b.value
  }));
  return h('div', { class: 'lrow trend-row', style: 'align-items:flex-start' },
    h('div', { class: 'l-main', style: 'min-width:0' },
      h('div', { class: 'l-title' }, r.title, ' ', badge),
      h('div', { class: 'l-sub', style: 'white-space:normal;overflow:visible;text-overflow:clip;line-height:1.45' },
        h('span', { text: '최근 4주 ' + r.delta_text }),
        h('em', { class: 'delta' + deltaClass, text: r.trend }),
        h('span', { text: ' · 지금 ' + (r.latest == null ? '—' : r.latest) + ' / 기간 최고 ' + (r.peak == null ? '—' : r.peak) }))),
    h('div', { style: 'display:flex;align-items:flex-end;gap:2px;height:26px;width:96px;flex:0 0 96px',
      title: r.keywords.length ? r.keywords.join(', ') : r.title }, bars));
}

function trendPanel(h, ctx, blog) {
  const { state, api, toast, friendlyError } = ctx;
  const panel = h('div', { class: 'panel' },
    h('h3', null, '키워드 트렌드', h('span', { class: 'tag', text: '네이버 데이터랩 · 12개월 주간' })));

  const saved = state.blogTrend;
  if (saved && saved.error) {
    panel.appendChild(h('p', { class: 'hint', style: 'color:var(--warn)', text: saved.error }));
  } else if (saved && saved.data) {
    const rows = trendRows(saved.data);
    const list = h('div', { class: 'list trend-list' });
    rows.forEach((r) => list.appendChild(trendRow(h, r)));
    panel.appendChild(list);
    panel.appendChild(h('p', { class: 'hint', style: 'margin-top:10px',
      text: '주간 상대지수 · ' + rangeText(saved.data)
        + (saved.data.budget ? ' · ' + budgetText(saved.data.budget) : '')
        + (saved.data.cached ? ' · 저장된 값(12시간 안 재사용)' : '') }));
    panel.appendChild(h('p', { class: 'hint',
      text: '숫자는 절대 검색량이 아니라 그 키워드 묶음 안에서 가장 높았던 구간을 100으로 둔 값입니다. 키워드끼리 크기를 비교하지 말고, 오르는지·성수기인지만 보세요.' }));
  } else {
    panel.appendChild(h('p', { class: 'hint',
      text: '발행 전에 지금 오르는 말인지 확인하세요. 키워드 5개까지 한 번에 묶어 비교합니다(따로 부르면 서로 비교할 수 없어요).' }));
  }

  const input = h('input', { type: 'text',
    placeholder: '키워드를 쉼표로 (최대 5개) 예: 봉명동 냉삼, 대전 삼겹살',
    value: state.blogTrendKeywords || (blog.keyword_hints || []).slice(0, 5).join(', ') });
  input.addEventListener('input', () => { state.blogTrendKeywords = input.value; });

  const btn = h('button', {
    class: 'btn sm primary', type: 'button', text: '추이 보기',
    onclick: async () => {
      const kws = normalizeKeywords(input.value, 5);
      if (!kws.length) { toast('키워드를 하나 이상 적어 주세요', 'err'); return; }
      btn.disabled = true; btn.textContent = '보는 중…';
      try {
        const res = await api.insightTrend({
          brand: state.brand, months: 12, unit: 'week',
          groups: kws.map((k) => ({ name: k, keywords: [k] }))
        });
        state.blogTrend = { data: res.data, at: Date.now() };
        state.blogTrendKeywords = input.value;
      } catch (err) {
        const own = (err && (err.code === 'ERR_INSIGHT_BUDGET' || String(err.code || '').indexOf('ERR_NAVER') === 0 || err.code === 'ERR_NO_NAVER_KEY'));
        state.blogTrend = { error: own ? (err.message || friendlyError(err)) : (blogErrorText(err.code, err.message) || friendlyError(err)) };
      }
      ctx.renderRoute();
    }
  });

  panel.appendChild(h('div', { class: 'rank-form' }, input, btn));
  if (!state.blogTrend) {
    panel.appendChild(h('p', { class: 'hint', style: 'margin-top:8px',
      text: '네이버 데이터랩(무료, 월 50,000건)을 씁니다. 이 앱은 그중 하루 200건까지만 쓰도록 서버에 천장을 박아 두었습니다.' }));
  }
  return panel;
}

function setupPanel(h, blog) {
  const steps = [
    '매일 자동 수집: Apps Script 편집기에서 installBlogDailyTrigger 함수를 한 번 실행 → 매일 밤 11시에 글·방문자가 쌓입니다.',
    blog && blog.search_api_ready
      ? '검색 순위: 연결됨 ✓'
      : '검색 순위: developers.naver.com → 애플리케이션 등록(사용 API: 검색) → Client ID·Secret을 Apps Script [프로젝트 설정 → 스크립트 속성]에 NAVER_CLIENT_ID · NAVER_CLIENT_SECRET 으로 저장.',
    '조회수·검색어·독자: 피클이 매일 네이버 블로그 통계를 읽어 서버로 보냅니다 — 지시서는 docs/BLOG_STATS_INGEST.md. 네이버 로그인은 피클 쪽 브라우저에만 남고, 이 앱에는 비밀번호·쿠키가 들어오지 않습니다.',
    '키는 이 화면이나 저장소에 넣지 않습니다. 서버(스크립트 속성)에만 둡니다.'
  ];
  return h('details', { class: 'panel blog-setup' },
    h('summary', { text: '설정 · 자동 수집과 검색 순위 켜기' }),
    h('ol', null, steps.map((t) => h('li', { text: t }))));
}


/* ───────────── 로그인 통계(피클) ───────────── */

function ingestStatus(h, blog) {
  const at = blog.stats_last_ingest_at;
  if (!at) {
    return h('div', { class: 'panel ingest-note' },
      h('h3', null, '조회수·검색어·독자 통계가 아직 안 들어왔어요'),
      h('p', { class: 'hint', text: '이건 네이버에 로그인해야 보이는 숫자라 피클이 하루 한 번 읽어서 보내 줘야 해요. 아래 [설정]의 순서대로 피클에게 루틴을 시키면 이 화면에 조회수·유입 검색어·독자(성별·연령)가 채워집니다.' }));
  }
  const days = daysBetween(String(at).slice(0, 10), kstDay(0));
  if (days != null && days >= 2) {
    return h('div', { class: 'panel ingest-note stale' },
      h('h3', null, '통계가 ' + days + '일째 안 들어왔어요'),
      h('p', { class: 'hint', text: '마지막으로 받은 때: ' + String(at).slice(0, 16).replace('T', ' ') + '. 피클의 네이버 로그인이 풀렸거나 루틴이 멈췄을 수 있어요. 피클에게 확인을 시켜 주세요.' }));
  }
  return h('span');
}

function insightPanels(h, blog) {
  const kws = blog.keywords_7d || [];
  const inflow = blog.inflow_7d || [];
  const aud = blog.audience;
  if (!kws.length && !inflow.length && !aud) return null;

  const bars = (rows, labelKey, unit) => {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return h('div', { class: 'cat-list' }, rows.map((r) => h('div', { class: 'cat-row' },
      h('div', { class: 'cat-name', title: r[labelKey], text: r[labelKey] }),
      h('div', { class: 'cat-bar' }, h('i', { style: 'width:' + Math.round((r.count / max) * 100) + '%' })),
      h('div', { class: 'cat-num', text: nf(r.count) + unit + ' · ' + r.pct + '%' }))));
  };

  const wrap = h('div', { class: 'insight-grid' });
  if (kws.length) {
    wrap.appendChild(h('div', { class: 'panel' },
      h('h3', null, '유입 검색어 · 최근 7일', h('span', { class: 'tag', text: String(kws.length) })),
      bars(kws.slice(0, 10), 'keyword', '회'),
      h('p', { class: 'hint', style: 'margin-top:8px', text: '독자가 어떤 말을 검색해서 들어왔는지예요. 많이 들어오는 말은 제목·태그에 더 넣고, 검색 순위 키워드로도 등록해 보세요.' })));
  }
  if (inflow.length) {
    wrap.appendChild(h('div', { class: 'panel' },
      h('h3', null, '유입 경로 · 최근 7일'),
      bars(inflow, 'channel', '회')));
  }
  if (aud && aud.items && aud.items.length) {
    const g = aud.items.filter((x) => x.kind === 'gender');
    const a = aud.items.filter((x) => x.kind === 'age').sort((x, y) => y.pct - x.pct);
    const row = (x) => h('div', { class: 'cat-row' },
      h('div', { class: 'cat-name', text: x.label }),
      h('div', { class: 'cat-bar' }, h('i', { style: 'width:' + Math.min(100, Math.round(x.pct)) + '%' })),
      h('div', { class: 'cat-num', text: x.pct + '%' }));
    wrap.appendChild(h('div', { class: 'panel' },
      h('h3', null, '독자 · 성별·연령', h('span', { class: 'tag', text: String(aud.day).slice(5).replace('-', '/') + ' 기준' })),
      h('div', { class: 'cat-list' }, g.map(row), a.map(row))));
  }
  return wrap;
}
