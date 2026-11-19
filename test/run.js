// test/run.js — content-hub 시험 입구(사후 게이트가 이 파일을 돌린다).
// 사용: node test/run.js
//
// 하는 일
//   ① gas/test/run.js — GAS(list_drive_media · hub_order)를 가짜 구글 환경에서 실제로 돌린다
//   ② js/*.js 문법 — 브라우저 ES 모듈 그대로 파싱되는지(node --check, js/package.json type=module)
//   ③ 조립기 스모크 — slot-engine·assembler 가 노드에서 그대로 돌아 결과를 내는지(원문 해시 불변)
//
// 외부 패키지·네트워크 없음. 하나라도 실패하면 exit 1.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('  ✓ ' + name);
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + String(extra).slice(0, 300) : '')); }
};

/* ① GAS 시험 */
console.log('[1] GAS 시험 (gas/test/run.js)');
{
  const r = spawnSync(process.execPath, [path.join(ROOT, 'gas', 'test', 'run.js')], { encoding: 'utf8' });
  const tail = String(r.stdout || '').trim().split('\n').slice(-1)[0] || '';
  ok('GAS 시험 통과', r.status === 0, (r.stdout || '') + (r.stderr || ''));
  if (r.status === 0) console.log('    ' + tail);
}

/* ② 브라우저 모듈 문법 */
console.log('[2] js/*.js 문법 (ES 모듈)');
{
  const files = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.js$/.test(f)) files.push(p);
    }
  })(path.join(ROOT, 'js'));
  let bad = 0;
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) { bad++; console.log('    ' + path.relative(ROOT, f) + ' — ' + String(r.stderr || '').split('\n').slice(0, 3).join(' ')); }
  }
  ok('js 파일 ' + files.length + '개 문법', bad === 0, bad + '개 실패');
}

/* ③ 조립기 스모크 (노드에서 그대로) */
console.log('[3] 조립기 스모크');
// 브라우저의 crypto.subtle 를 노드에서도 쓰게 해 준다(Node 18 은 전역 crypto 가 없다) — 조립기가 해시를 쓴다.
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  try { globalThis.crypto = require('crypto').webcrypto; } catch (e) {}
}
(async () => {
  try {
    const slot = await import('file://' + path.join(ROOT, 'js', 'slot-engine.js'));
    const assembler = await import('file://' + path.join(ROOT, 'js', 'assembler.js'));
    const facts = {
      place_name: '테스트가게', category: '고기', address: '대전 유성구', tel: '000-0000-0000',
      price_menu: '삼겹 16,000원'
    };
    const memo = '첫 줄 원문\n둘째 줄 원문\n\n두 번째 덩어리 원문';
    const media = [];
    for (let i = 0; i < 20; i++) media.push({ name: 'p' + i + '.jpg', kind: 'IMAGE' });
    for (let i = 0; i < 5; i++) media.push({ name: 'v' + i + '.mp4', kind: 'VIDEO' });

    const g = await slot.buildSlotGuide({ facts, userMemo: memo, mediaItems: media, brand: 'daejeon_youth' });
    ok('슬롯 6채널', !!g && !!g.channels && Object.keys(g.channels).length === 6, g && Object.keys(g.channels || {}));
    ok('원문 해시가 나온다', !!g && /^[0-9a-f]{64}$/.test(String(g.user_body_sha256 || '')), g && g.user_body_sha256);

    const core = assembler.buildCore ? assembler.buildCore({ facts, blocks: g.blocks }) : null;
    ok('조립 코어가 돈다', !!core && typeof core === 'object');

    if (assembler.composeBlog) {
      const blog = await assembler.composeBlog({ facts, blocks: g.blocks, slots: g.channels.blog, mode: 'preserve' });
      const text = String((blog && (blog.body || blog.text)) || '');
      ok('보존 모드에서 원문 첫 줄이 그대로', text.indexOf('첫 줄 원문') >= 0, text.slice(0, 120));
      ok('조립 뒤 원문 해시가 그대로', assembler.assertBodyUnchanged ? assembler.assertBodyUnchanged(g.user_body_sha256, g.blocks) !== false : true);
    }
  } catch (err) {
    ok('조립기 스모크', false, (err && err.message) || err);
  }

  /* ④ 유튜브·인스타 자동 수집기 (tools/analytics) */
  console.log('[4] 자동 수집 시험 (tools/analytics)');
  {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'analytics', 'test', 'run.js')], { encoding: 'utf8' });
    const tail = String(r.stdout || '').trim().split('\n').slice(-1)[0] || '';
    ok('자동 수집 시험 통과', r.status === 0, (r.stdout || '') + (r.stderr || ''));
    if (r.status === 0) console.log('    ' + tail);
  }

  /* ⑤ 트랙 채널 계약 · 채널 드릴다운 순수 로직 (2026-11-19) */
  console.log('[5] 트랙 채널 계약 · 드릴다운 로직');
  try {
    const assert = require('assert');
    const vm = require('vm');
    const same = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'seeds', 'track_channels.json'), 'utf8'));
    const imp = (f) => import('file://' + path.join(ROOT, 'js', f));

    /* 세 곳 대조: 프론트 · GAS · 수집기 */
    const tc = await imp('trackChannels.js');
    ok('프론트 TRACK_CHANNELS = seeds/track_channels.json', same(tc.TRACK_CHANNELS, seed), tc.TRACK_CHANNELS);
    const gasCtx = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'gas', 'PostDetail.gs'), 'utf8'), gasCtx, { filename: 'PostDetail.gs' });
    ok('GAS TRACK_CHANNELS = seeds/track_channels.json', same(JSON.parse(JSON.stringify(vm.runInContext('TRACK_CHANNELS', gasCtx))), seed));
    ok('수집기 TRACK_CHANNELS = seeds/track_channels.json', same(require(path.join(ROOT, 'tools', 'analytics', 'lib', 'channels.js')).TRACK_CHANNELS, seed));
    ok('트랙 B = 쇼츠·릴스·클립 3개', same(seed.ppiyak_kimmary, ['shorts', 'reels', 'clip']));
    ok('트랙 A = 6개(블로그·쇼츠·릴스·피드·클립·당근)', same(seed.daejeon_youth, ['blog', 'shorts', 'reels', 'feed', 'clip', 'daangn']));

    /* 트랙 분기 */
    ok('트랙 B 에 블로그·피드·당근이 없다', ['blog', 'feed', 'daangn'].every((c) => tc.trackChannelsOf('ppiyak_kimmary').indexOf(c) < 0));
    ok('trackChannelsOf 는 복사본(원본을 못 바꾼다)', (() => { const l = tc.trackChannelsOf('ppiyak_kimmary'); l.push('x'); return tc.trackChannelsOf('ppiyak_kimmary').length === 3; })());

    /* 완료 판정 — 분모: SKIPPED 제외, 분자: 올라간 상태 / Metrics 숫자는 보지 않는다 */
    const cardB = { brand: 'ppiyak_kimmary', shorts_status: 'UPLOADED', reels_status: 'LINKED', clip_status: 'PUBLISHED', blog_status: 'SKIPPED', daangn_status: 'SKIPPED', ig_feed_status: '' };
    ok('트랙 B 3/3 이면 완료', same(tc.completionOf(cardB), { done: 3, total: 3, targets: ['shorts', 'reels', 'clip'], complete: true }), tc.completionOf(cardB));
    ok('클립이 PUBLISHING 이면 2/3(지연이 드러난다)', (() => { const c = tc.completionOf(Object.assign({}, cardB, { clip_status: 'PUBLISHING' })); return c.done === 2 && c.total === 3 && !c.complete; })());
    ok('피드 상태가 있어도 트랙 B 분모에 안 들어간다', tc.completionOf(Object.assign({}, cardB, { ig_feed_status: 'UPLOADED' })).total === 3);
    const cardA = { brand: 'daejeon_youth', blog_status: 'PUBLISHED', shorts_status: 'LINKED', reels_status: 'UPLOADED', ig_feed_status: 'PUBLISHING', clip_status: 'DONE', daangn_status: 'SKIPPED' };
    ok('트랙 A: SKIPPED(당근) 는 분모에서 빠져 4/5', (() => { const c = tc.completionOf(cardA); return c.done === 4 && c.total === 5; })());
    ok('올라간 상태 4종', ['UPLOADED', 'DONE', 'PUBLISHED', 'LINKED'].every((s) => tc.DONE_STATES.indexOf(s) >= 0) && tc.DONE_STATES.length === 4);

    /* 이미 쌓인 트랙 B 피드 행은 걸러진다 */
    ok('트랙 B 피드 행은 제외', tc.isTrackRow({ brand: 'ppiyak_kimmary', channel: 'feed' }) === false);
    ok('트랙 B 릴스 행은 유지', tc.isTrackRow({ brand: 'ppiyak_kimmary', channel: 'reels' }) === true);
    ok('트랙 A 피드 행은 유지', tc.isTrackRow({ brand: 'daejeon_youth', channel: 'feed' }) === true);
    ok('롱폼·채널 요약은 이 필터가 건드리지 않는다', tc.isTrackRow({ brand: 'ppiyak_kimmary', channel: 'longform' }) && tc.isTrackRow({ brand: 'ppiyak_kimmary', channel: 'channel' }));

    /* 채널 목록: LATEST 만, 같은 영상은 최근 한 줄(중복 합산 금지) */
    const cv = await imp('channelView.js');
    const mk = (o) => Object.assign({ brand: 'daejeon_youth', source: 'youtube', channel: 'shorts', checkpoint: 'LATEST', collected_at: '2026-11-18T06:00:00+09:00', views: 0, likes: 0, comments: 0, reach: 0, saves: 0 }, o);
    const rowsA = [
      mk({ external_id: 'v1', views: 30, collected_at: '2026-11-17T06:00:00+09:00' }),
      mk({ external_id: 'v1', views: 80 }),
      mk({ external_id: 'v1', checkpoint: 'D7', views: 90, collected_at: '2026-11-19T06:00:00+09:00' }),
      mk({ external_id: 'v2', views: 5 }),
      mk({ external_id: 'long', channel: 'longform', views: 999 }),
      mk({ external_id: 'UCx', channel: 'channel', views: 999 })
    ];
    const cur = cv.currentRows(rowsA, 'youtube', 'daejeon_youth');
    ok('LATEST 만 · 영상당 1줄(2개)', cur.length === 2, cur.map((r) => r.external_id));
    ok('같은 영상은 가장 최근 값(80)이지 합(110)이 아니다', cur.find((r) => r.external_id === 'v1').views === 80);
    ok('롱폼·채널 요약은 목록에 없다', !cur.some((r) => r.external_id === 'long' || r.external_id === 'UCx'));
    const sums = cv.summarizeBySurface(cur);
    ok('쇼츠 합계 85 · 최고 반응 v1', sums.shorts.views === 85 && sums.shorts.count === 2 && sums.shorts.top.external_id === 'v1', sums.shorts);
    const igRows = [
      mk({ source: 'instagram', brand: 'ppiyak_kimmary', channel: 'reels', external_id: 'm1', views: 70 }),
      mk({ source: 'instagram', brand: 'ppiyak_kimmary', channel: 'feed', external_id: 'm2', reach: 99 }),
      mk({ source: 'instagram', brand: 'daejeon_youth', channel: 'feed', external_id: 'm3', reach: 10 })
    ];
    ok('트랙 B 인스타 목록에는 릴스만(피드 제외)', same(cv.currentRows(igRows, 'instagram', 'ppiyak_kimmary').map((r) => r.external_id), ['m1']));
    ok('트랙 A 인스타 목록에는 릴스·피드', cv.currentRows(igRows, 'instagram', 'daejeon_youth').map((r) => r.external_id).sort().join() === 'm1,m2,m3');
    /* 2026-11-19 결함 수정: D+1·7·14·30일째는 LATEST 대신 D7 행만 쌓인다 → 목록에서 사라지면 안 된다 */
    const d7Rows = [mk({ external_id: 'v9', checkpoint: 'D7', views: 90, collected_at: '2026-11-19T06:00:00+09:00' })];
    const d7Cur = cv.currentRows(d7Rows, 'youtube', 'daejeon_youth');
    ok('LATEST 가 없는 D+7 당일에도 영상이 목록에 남는다', d7Cur.length === 1 && d7Cur[0].external_id === 'v9' && d7Cur[0].views === 90, d7Cur);
    const both = d7Rows.concat([mk({ external_id: 'v9', views: 80, collected_at: '2026-11-18T06:00:00+09:00' })]);
    ok('LATEST 와 체크포인트가 같이 있으면 LATEST 를 쓴다', cv.currentRows(both, 'youtube', 'daejeon_youth')[0].views === 80);
    ok('postHref 형식', cv.postHref('youtube', 'abc', 'DY-1') === '#/post?source=youtube&id=abc&cid=DY-1' && cv.postHref('blog', '224480755004', '') === '#/post?source=blog&id=224480755004');

    /* 카드 1장 통합 성과 — 보드 뱃지·상세 타일이 같이 쓰는 순수 계산 (2026-11-19) */
    const cp = await imp('cardPerf.js');
    const card = { content_id: 'DY-1', brand: 'daejeon_youth', status: 'PUBLISHED',
      blog_status: 'PUBLISHED', blog_url: 'https://blog.naver.com/x/224480755004',
      shorts_status: 'UPLOADED', shorts_url: 'https://youtu.be/Gx9-FiEXIiI',
      reels_status: 'UPLOADED', reels_url: 'https://www.instagram.com/reel/Df0xLg-Jf_j/',
      ig_feed_status: 'PUBLISHING', ig_feed_url: '', clip_status: 'UPLOADED', clip_url: 'https://naver.me/xXnTEdXL',
      daangn_status: 'PENDING', daangn_url: '' };
    const aRows = [
      { content_id: 'DY-1', source: 'youtube', channel: 'shorts', external_id: 'Gx9-FiEXIiI', collected_date: '2026-11-18', collected_at: '2026-11-18T06:10:00+09:00', views: 1000, likes: 50, comments: 5, saves: 0, shares: 0, reach: 0 },
      { content_id: 'DY-1', source: 'youtube', channel: 'shorts', external_id: 'Gx9-FiEXIiI', collected_date: '2026-11-19', collected_at: '2026-11-19T06:10:00+09:00', views: 1400, likes: 70, comments: 6, saves: 0, shares: 0, reach: 0 },
      { content_id: 'DY-1', source: 'instagram', channel: 'reels', external_id: '18075955562488088', collected_date: '2026-11-19', collected_at: '2026-11-19T06:10:00+09:00', views: 300, likes: 20, comments: 2, saves: 4, shares: 3, reach: 260 }
    ];
    const mRows = [
      { content_id: 'DY-1', channel: 'blog', measured_at: '2026-11-18', views: 400, search_inflow_pct: 60 },
      { content_id: 'DY-1', channel: 'blog', measured_at: '2026-11-19', views: 500, search_inflow_pct: 64 },
      { content_id: 'DY-1', channel: 'daangn', measured_at: '2026-11-19', valid_views: 900, likes_comments: 12, reward_krw: 800 }
    ];
    const crow = cp.channelRows(card, mRows, aRows, 'daejeon_youth');
    const byCh = {}; crow.forEach((r) => { byCh[r.channel] = r; });
    ok('타일 6칸(트랙 A)', crow.length === 6 && crow.map((r) => r.channel).join(',') === 'blog,shorts,reels,feed,clip,daangn');
    ok('쇼츠는 자동 수집 최신값 1400 · 증가율 +40%', byCh.shorts.value === 1400 && byCh.shorts.trend === 40 && byCh.shorts.trendKind === 'pct', byCh.shorts);
    ok('릴스는 조회 300 · 저장·공유 보조', byCh.reels.value === 300 && /저장·공유 7/.test(byCh.reels.sub), byCh.reels);
    ok('블로그는 사람 입력 500 · 검색유입 64%', byCh.blog.value === 500 && /검색유입 64%/.test(byCh.blog.sub), byCh.blog);
    ok('수동 채널 추이는 %가 아니라 증감분(+100)', byCh.blog.trend === 100 && byCh.blog.trendKind === 'diff', byCh.blog);
    ok('당근은 유효시청 900 · 좋아요·보상 보조', byCh.daangn.value === 900 && /좋아요 12/.test(byCh.daangn.sub) && /보상 800원/.test(byCh.daangn.sub), byCh.daangn);
    ok('피드는 수집 전이면 null(0으로 속이지 않음)', byCh.feed.value === null && byCh.feed.collected === false);
    const totals = cp.cardTotals(crow, card, 'daejeon_youth', aRows);
    ok('총 조회 = 500+1400+300+900', totals.views === 3100, totals);
    ok('총 반응 = 좋아요·리댓·저장·공유 + 당근 좋아요', totals.reactions === (70 + 6) + (20 + 2 + 4 + 3) + 12, totals);
    ok('댓글 합', totals.comments === 8);
    ok('비중 막대 4칸 · 발행 4/6', totals.share.length === 4 && totals.done === 4 && totals.total === 6, totals.share);
    ok('compact: 1.4만 · 412', cp.compact(14000) === '1.4만' && cp.compact(412) === '412' && cp.compact(0) === '0');

    /* 당근 자동 점검 — 통과하면 빈 배열, 대본 없으면 판정 안 함 */
    ok('대본이 없으면 경고 0(점검 UI 자체를 안 보임)', cp.daangnWarnings({}).length === 0 && cp.daangnWarnings(null).length === 0);
    const badDaangn = { daangn: { description: '짧은 설명', duration_sec: 8 }, facts: { sponsored: true } };
    const wcodes = cp.daangnWarnings(badDaangn).map((w) => w.code).sort().join(',');
    ok('8초·짧은 설명·협찬 미표기 → 세 경고', wcodes === 'AD,DESC,DURATION', wcodes);
    ok('30자 이상·10초 이상·표기 있으면 경고 0', cp.daangnWarnings({ daangn: { description: '#광고 봉명동 삼겹살 다녀왔습니다 진짜 맛있어요 추천합니다', duration_sec: 21 }, facts: { sponsored: true } }).length === 0);
    ok('설명에 외부 링크 → LINK 경고', cp.daangnWarnings({ daangn: { description: '봉명동 삼겹살 다녀왔습니다 진짜 맛있어요 추천합니다 https://blog.naver.com/x', duration_sec: 21 } }).some((w) => w.code === 'LINK'));

    /* 당월 목표 — 같은 카드 여러 날 입력해도 두 번 세지 않는다 */
    const goal = cp.daangnGoal(mRows.concat([{ content_id: 'DY-1', channel: 'daangn', measured_at: '2026-11-20', valid_views: 1200, reward_krw: 900 }]), '2026-11');
    ok('인정 스토리 1편(카드 수) · 유효시청은 최댓값', goal.stories === 1 && goal.valid === 1200 && goal.reward === 900, goal);

    /* 블로그는 사람 입력이 없어도 네이버 통계에서 바로 읽는다(블로그만 올린 카드가 비지 않게) */
    const blogCard = { content_id: 'DY-9', brand: 'daejeon_youth', status: 'LINKED', blog_status: 'PUBLISHED',
      blog_url: 'https://blog.naver.com/youth-daejeon/224480755004', shorts_status: 'SKIPPED', reels_status: 'SKIPPED',
      clip_status: 'SKIPPED', ig_feed_status: 'SKIPPED', daangn_status: 'SKIPPED' };
    const blogPosts = [{ log_no: '224480755004', views_total: 1200, comment_cnt: 4, sympathy_cnt: 9 }];
    const bRows = cp.channelRows(blogCard, [], [], 'daejeon_youth', { blogPosts });
    const bBlog = bRows.filter((r) => r.channel === 'blog')[0];
    ok('blog_url → 글 번호', cp.blogLogNo('https://blog.naver.com/youth-daejeon/224480755004') === '224480755004'
      && cp.blogLogNo('https://m.blog.naver.com/PostView.naver?blogId=x&logNo=224480755004') === '224480755004'
      && cp.blogLogNo('https://blog.naver.com/x') === '');
    ok('블로그 타일이 통계에서 조회·공감·댓글을 집는다', bBlog.collected && bBlog.value === 1200 && /댓글 4/.test(bBlog.sub) && /공감 9/.test(bBlog.sub), bBlog);
    const bTotals = cp.cardTotals(bRows, blogCard, 'daejeon_youth', []);
    ok('블로그만 있는 카드도 총 반응 13(공감 9 + 댓글 4)', bTotals.reactions === 13 && bTotals.comments === 4 && bTotals.views === 1200, bTotals);

    /* 상세: 주소 해석 · 상태 말 */
    const pv = await imp('postView.js');
    ok('주소 해석(딥링크)', same(pv.parsePostHash('#/post?source=youtube&id=dQw4w9WgXcQ&cid=DY-1'), { source: 'youtube', id: 'dQw4w9WgXcQ', cid: 'DY-1' }));
    ok('cid 는 선택', pv.parsePostHash('#/post?source=blog&id=224480755004').cid === '');
    ok('이상한 주소는 null(빈 ID·모르는 소스·수식 ID·긴 ID)', [
      '#/post', '#/post?source=youtube', '#/post?source=tiktok&id=abc', '#/post?source=youtube&id=%3DIMPORTXML', '#/post?source=youtube&id=' + 'a'.repeat(65),
      '#/post?source=youtube&id=abc&cid=%27%3B'
    ].every((h) => pv.parsePostHash(h) === null));
    ok('PUBLISHING 은 \'올리는 중\'', pv.statusText('PUBLISHING') === '올리는 중' && pv.statusText('UPLOADED') === '올림' && pv.statusText('') === '아직' && pv.statusText('FAILED') === '실패');

    /* 추이 차트: 순수 SVG(가짜 document 로 시험 — innerHTML 을 쓰면 여기서 터진다) */
    const mkNode = (name) => { const n = { name, attrs: {}, kids: [], textContent: '' }; n.setAttribute = (k, v) => { n.attrs[k] = v; }; n.appendChild = (c) => { n.kids.push(c); return c; }; return n; };
    const prevDoc = globalThis.document;
    globalThis.document = { createElementNS: (ns, name) => mkNode(name) };
    try {
      const svg = pv.trendChart([{ label: '2026-11-12', value: 10 }, { label: '2026-11-13', value: 30 }, { label: '2026-11-18', value: 80 }], { title: '누적 조회' });
      const count = (n, nm) => n.kids.reduce((s, k) => s + count(k, nm), n.name === nm ? 1 : 0);
      ok('SVG 선 1개 · 점 3개', count(svg, 'polyline') === 1 && count(svg, 'circle') === 3, { line: count(svg, 'polyline'), dots: count(svg, 'circle') });
      ok('접근성: role=img + aria-label', svg.attrs.role === 'img' && /점 3개/.test(svg.attrs['aria-label']));
      ok('점이 하나뿐이면 선을 그리지 않는다', count(pv.trendChart([{ label: '2026-11-12', value: 10 }]), 'polyline') === 0);
      ok('점이 없어도 터지지 않는다', count(pv.trendChart([]), 'circle') === 0);
    } finally { globalThis.document = prevDoc; }

    /* 수동 입력함·입력 칸: 트랙 A 5칸 / 트랙 B 3칸 */
    const pf = await imp('perfView.js');
    ok('입력 채널: 트랙 A 5칸(블로그·쇼츠·릴스·클립·당근)', same(pf.channelsOf({ brand: 'daejeon_youth' }), ['blog', 'shorts', 'reels', 'clip', 'daangn']));
    ok('입력 채널: 트랙 B 3칸(쇼츠·릴스·클립)', same(pf.channelsOf({ brand: 'ppiyak_kimmary' }), ['shorts', 'reels', 'clip']));
    ok('브랜드가 비면 현재 브랜드로', same(pf.channelsOf({}, 'ppiyak_kimmary'), ['shorts', 'reels', 'clip']));

    /* 코드 규칙: innerHTML 금지 · 공개 저장소에 비밀·주소 금지 */
    const newFiles = ['js/trackChannels.js', 'js/channelView.js', 'js/postView.js', 'js/perfView.js', 'js/analyticsView.js', 'gas/PostDetail.gs', 'docs/CHANNEL_DRILLDOWN_v1.md'];
    const src = {};
    newFiles.forEach((f) => { src[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
    ok('innerHTML/outerHTML/insertAdjacentHTML 0건', newFiles.filter((f) => /\.js$/.test(f)).every((f) => !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src[f])));
    ok('웹앱 주소·토큰·시트 ID 같은 값이 없다', newFiles.every((f) => !/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}|docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}|\bcq_[A-Za-z0-9]{8,}|xox[bp]-/.test(src[f])));
    ok('index.html 이 새 app.js 버전을 부른다', /js\/app\.js\?v=20261119p/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
    ok('하단 탭이 늘지 않았다(10개)', (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/class="tab"/g) || []).length === 10);
  } catch (err) {
    ok('트랙 채널 계약 시험', false, (err && err.stack) || err);
  }

  console.log('\n' + (failed ? '❌ 실패 ' + failed + '건' : '✅ content-hub 시험 전부 통과'));
  process.exit(failed ? 1 : 0);
})();
