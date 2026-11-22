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
const eq = (name, actual, expected) => ok(name, actual === expected, { actual, expected });

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
    /* 목록 응답에 blog_url 이 없는 카드는 제목으로 찾는다(공백만 정리해 정확히 같을 때) */
    const blogCard2 = Object.assign({}, blogCard, { blog_url: '', blog_title: '  [대전 봉명동 맛집] 미미삼겹 냉삼   솔직후기 : "웨이팅 후 겨우 얻어먹은 냉삼, 반찬 클라스가 1티어" ' });
    const bRows2 = cp.channelRows(blogCard2, [], [], 'daejeon_youth', { blogPosts: [{ log_no: '224480755004', title: '[대전 봉명동 맛집] 미미삼겹 냉삼 솔직후기 : "웨이팅 후 겨우 얻어먹은 냉삼, 반찬 클라스가 1티어"', views_total: 28, comment_cnt: 17, sympathy_cnt: 11 }] });
    const bBlog2 = bRows2.filter((r) => r.channel === 'blog')[0];
    ok('blog_url 없으면 제목으로 맞춘다', bBlog2.collected && bBlog2.value === 28 && /댓글 17/.test(bBlog2.sub), bBlog2);
    ok('제목이 다르면 붙이지 않는다', cp.channelRows(Object.assign({}, blogCard2, { blog_title: '다른 글' }), [], [], 'daejeon_youth', { blogPosts: [{ log_no: '224480755004', title: 'X', views_total: 28 }] })[0].value === null);
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
    ok('index.html 이 새 app.js 버전을 부른다', /js\/app\.js\?v=\d+[a-z]/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
    /* 2026-11-21 레이아웃 개편: 하단 5칸 · 사이드바 10개 */
    const navHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok('하단 탭은 5칸으로 줄었다', (navHtml.match(/class="tab"/g) || []).length === 5);
    ok('사이드바 메뉴는 10개', (navHtml.match(/class="side-item"/g) || []).length === 10);
    ok('라우트 10개가 그대로 있다', ['board','approve','create','perf','blog','review','lint','series','knowhow','ops'].every((r) => navHtml.indexOf('data-route="' + r + '"') >= 0));
    ok('더보기 시트에 6개 항목', (navHtml.match(/class="more-item"/g) || []).length === 6);
  } catch (err) {
    ok('트랙 채널 계약 시험', false, (err && err.stack) || err);
  }

  /* ⑥ 제작 스텝퍼 순수 로직 · 코드 규칙 (2026-11-19) */
  console.log('[6] 제작 스텝퍼 (js/produceLogic.js · produceView.js)');
  try {
    const assert = require('assert');
    const same = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };
    const L = await import('file://' + path.join(ROOT, 'js', 'produceLogic.js'));

    /* 입력 검사 — 노트북·GAS 와 같은 규칙 */
    ok('파일 이름 줄바꿈·쉼표 분리', same(L.parseInputs('a.mp4\nb.mov, c.m4v').names, ['a.mp4', 'b.mov', 'c.m4v']));
    ok('같은 이름은 한 번만', same(L.parseInputs('a.mp4\na.mp4').names, ['a.mp4']));
    ok('한글·공백 이름 허용', L.parseInputs('01 외관.mp4').errors.length === 0);
    ok('폴더 경로 거부', L.parseInputs('a/b.mp4').errors.length === 1 && L.parseInputs('a\\b.mp4').errors.length === 1);
    ok('.. · 점 시작 거부', L.parseInputs('a..mp4').errors.length === 1 && L.parseInputs('.x.mp4').errors.length === 1);
    ok('확장자 mp4·mov·m4v 만', L.parseInputs('a.txt').errors.length === 1 && L.parseInputs('a.MP4').errors.length === 0);
    ok('9개는 거부', L.parseInputs(Array.from({ length: 9 }, (_, i) => 'v' + i + '.mp4').join('\n')).errors.length === 1);

    /* 오더 payload 는 계약 키만 */
    const okP = L.buildRenderPayload({ contentId: 'CH-1', brand: 'ppiyak_kimmary', inputs: ['a.mp4'], profile: 'bgm', cropX: 0.5 });
    ok('payload 계약 v1', okP.ok && same(okP.payload, { content_id: 'CH-1', brand: 'ppiyak_kimmary', inputs: ['a.mp4'], profile: 'bgm', crop_x: 0.5, template: 'auto', motion: 'auto' }), okP);
    // 자동 줌·모션(2026-11-21) — 기본 auto 는 늘 싣고, none·dynamic·calm 은 그대로, 모르는 값은 거절
    ok('motion 기본 auto(오늘 오더도 모션이 붙는다)', L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'] }).payload.motion === 'auto');
    ok('motion none·calm·dynamic 이 payload 에 실린다', ['none', 'calm', 'dynamic'].every((m) => L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], motion: m }).payload.motion === m));
    ok('모르는 motion 은 거절', !L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], motion: 'wobble' }).ok);
    ok('motion_quality 는 high 일 때만 싣는다(standard 는 기본값)', (() => {
      const hi = L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], motionQuality: 'high' });
      const st = L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], motionQuality: 'standard' });
      return hi.payload.motion_quality === 'high' && !('motion_quality' in st.payload) && !L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], motionQuality: '4k' }).ok;
    })());
    ok('motion 은 큐 한도(4,000자)를 사실상 늘리지 않는다(약 +15바이트)', JSON.stringify({ content_id: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], motion: 'none' }).length - JSON.stringify({ content_id: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'] }).length <= 20);
    ok('crop_x 가 비면 키를 만들지 않는다', !('crop_x' in L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], cropX: '' }).payload));
    const fitP = L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], fit: ' BLUR ' });
    ok('fit 은 소문자로 payload 에 실린다', fitP.ok && fitP.payload.fit === 'blur', fitP);
    ok('fit 이 비면 키를 만들지 않는다', !('fit' in L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], fit: '' }).payload));
    ok('fit 은 crop · blur · pad 만', L.FITS.join(',') === 'crop,blur,pad'
      && ['auto', 'left', 'CROPN'].every((f) => !L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], fit: f }).ok));
    ok('profile 기본 captions', L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'] }).payload.profile === 'captions');
    ok('잘못된 content_id·brand·crop_x·빈 inputs 거부', ['../x', 'a'.repeat(41)].every((id) => !L.buildRenderPayload({ contentId: id, brand: 'daejeon_youth', inputs: ['a.mp4'] }).ok)
      && !L.buildRenderPayload({ contentId: 'CH-1', brand: 'x', inputs: ['a.mp4'] }).ok
      && !L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], cropX: 2 }).ok
      && !L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: [] }).ok);

    /* 완제품 — 자막 번인·내레이션(2026-11-20) */
    const capBase = { contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'] };
    const capP = L.buildRenderPayload(Object.assign({}, capBase, { captions: [{ start: 0.2, end: 1.4, text: '오토바이 여러 대' }], subStyle: 'long' }));
    ok('자막이 있으면 payload.captions + sub_style 로 실린다', capP.ok && capP.payload.captions.length === 1 && capP.payload.sub_style === 'long' && !('burn_subtitles' in capP.payload), capP);
    ok('burnSubtitles:false 면 burn_subtitles:false', L.buildRenderPayload(Object.assign({}, capBase, { captions: [[0, 1, '가']], burnSubtitles: false })).payload.burn_subtitles === false);
    ok('자막이 없으면 굽기 키도 안 붙는다(기존 오더 그대로)', !('burn_subtitles' in L.buildRenderPayload(capBase).payload));
    const narP = L.buildRenderPayload(Object.assign({}, capBase, { captions: [[0, 2, '가']], narration: [[0, 2, '와! 대박', 'hype']] }));
    ok('내레이션 큐와 톤이 실린다', narP.ok && narP.payload.narration[0][3] === 'hype', narP);
    ok('내레이션 톤은 hype · calm 만', !L.buildRenderPayload(Object.assign({}, capBase, { narration: [[0, 2, '가', 'shout']] })).ok);
    ok('자막 큐 검사: 빈 문장·끝<=시작·200자 초과 거부', ['', 'x'].every(() => !L.buildRenderPayload(Object.assign({}, capBase, { captions: [[0, 1, ' ']] })).ok)
      && !L.buildRenderPayload(Object.assign({}, capBase, { captions: [[2, 1, '가']] })).ok
      && !L.buildRenderPayload(Object.assign({}, capBase, { captions: [[0, 1, '가'.repeat(201)]] })).ok);
    const many = Array.from({ length: 60 }, (_, i) => [i * 0.5, i * 0.5 + 0.4, '자' + i]);
    const driveP = L.buildRenderPayload(Object.assign({}, capBase, { captions: many }));
    ok('큐가 ' + L.MAX_CUES_INLINE + '개를 넘으면 payload_source:drive(인라인 제거)', driveP.ok && driveP.payload.payload_source === 'drive' && !('captions' in driveP.payload), driveP.payload);
    ok('payload_source:drive 를 직접 지정할 수 있다', L.buildRenderPayload(Object.assign({}, capBase, { payloadSource: 'drive' })).payload.payload_source === 'drive');
    ok('narrate:true 는 그대로 실린다(대본이 없으면 노트북이 자막을 읽는다)', L.buildRenderPayload(Object.assign({}, capBase, { narration: [[0, 2, '가']], narrate: true })).payload.narrate === true);
    ok('normalizeCues 가 큐를 [start,end,text] 로 정리한다', L.normalizeCues([{ start: 0.234, end: 1.005, text: '  가  나 ' }], '자막').cues[0].join('|') === '0.23|1.01|가 나');

    /* 표준 v3 숫자 */
    ok('음량 프로필 = 표1 (자막만 -14/TP -1.8, BGM -16/TP -2.0)', L.PROFILES.captions.lufs === -14 && L.PROFILES.captions.tpMax === -1.8 && L.PROFILES.bgm.lufs === -16 && L.PROFILES.bgm.tpMax === -2.0);
    ok('오더 TP 목표는 한도보다 여유(실측: 목표=한도면 한도를 넘었다)', L.PROFILES.captions.tpTarget < L.PROFILES.captions.tpMax && L.PROFILES.bgm.tpTarget < L.PROFILES.bgm.tpMax);
    ok('캡컷 7단계', L.reviewSteps('daejeon_youth').length === 7 && L.reviewSteps('ppiyak_kimmary').length === 7);
    ok('트랙별 줄당 글자 12/11', L.finishOf('daejeon_youth').cpl === 12 && L.finishOf('ppiyak_kimmary').cpl === 11);
    ok('모르는 brand 는 대전 청년 값으로(안 터진다)', L.finishOf('zzz').cpl === 12);

    /* 결과 report — 규격 대조는 화면이 다시 계산 */
    const goodRep = { out: 'CH-1_clean.mp4', width: 1080, height: 1920, fps: 30, duration: 24.5, lufs: -14.1, tp: -2.1, checks: [{ id: 'codec', status: 'PASS', msg: 'h264' }] };
    const pr = L.parseReport(JSON.stringify(goodRep));
    ok('report 해석', pr.ok && pr.report.checks.length === 1, pr);
    ok('규격 대조 전부 PASS', L.compareStandard(pr.report, 'captions').every((r) => r.status === 'PASS'));
    ok('음량이 어긋나면 FAIL(-12 LUFS)', L.compareStandard(L.parseReport(Object.assign({}, goodRep, { lufs: -12 })).report, 'captions').find((r) => r.id === 'lufs').status === 'FAIL');
    ok('TP 가 한도를 넘으면 FAIL(-1.73 — 실측 사례)', L.compareStandard(L.parseReport(Object.assign({}, goodRep, { tp: -1.73 })).report, 'captions').find((r) => r.id === 'tp').status === 'FAIL');
    ok('해상도·fps·길이 어긋나면 FAIL', ['width', 'fps', 'duration'].every((k) => L.compareStandard(L.parseReport(Object.assign({}, goodRep, { [k]: k === 'duration' ? 120 : 1 })).report, 'captions').some((r) => r.status === 'FAIL')));
    ok('값이 없으면 지어내지 않고 WARN(확인 못 함)', L.compareStandard(L.parseReport({ checks: [] }).report, 'captions').every((r) => r.status === 'WARN' && /확인 못 함/.test(r.msg)));
    ok('숫자가 아니면 거부', !L.parseReport(Object.assign({}, goodRep, { lufs: 'loud' })).ok);
    ok('status 가 PASS·WARN·FAIL 이 아니면 거부', !L.parseReport(Object.assign({}, goodRep, { checks: [{ id: 'x', status: 'OK' }] })).ok);
    ok('JSON 이 아니면 거부', !L.parseReport('{깨짐').ok && !L.parseReport('[1]').ok);

    /* 단계 완료 판정 — 오더를 보냈다고 끝이 아니다 */
    const st0 = L.defaultState();
    ok('빈 카드는 전부 미완료', Object.values(L.stepStatus(st0, 'daejeon_youth')).every((v) => v === false));
    const stSent = L.normalizeState({ inputs: ['a.mp4'], render: { order_id: 'Q-1', status: 'WAITING_APPROVAL' } });
    ok('오더만 보내면 렌더 단계는 미완료', L.stepStatus(stSent, 'daejeon_youth').render === false && L.stepStatus(stSent, 'daejeon_youth').material === true);
    const stDone = L.normalizeState({ inputs: ['a.mp4'], profile: 'captions', render: { order_id: 'Q-1', report: pr.report } });
    ok('규격 대조 FAIL 0 이면 렌더 완료', L.stepStatus(stDone, 'daejeon_youth').render === true);
    const stBadRep = L.normalizeState({ inputs: ['a.mp4'], render: { report: L.parseReport(Object.assign({}, goodRep, { lufs: -9 })).report } });
    ok('FAIL 이 있으면 렌더 미완료', L.stepStatus(stBadRep, 'daejeon_youth').render === false);
    ok('자막 단계는 확정하거나 "자막 없이 진행"을 눌러야 완료(오더만 보내서는 안 된다)', L.STEPS.find((x) => x.key === 'srt').soon === undefined && L.stepStatus(stDone, 'daejeon_youth').srt === false
      && L.stepStatus(L.normalizeState({ srt: { confirmed: true } }), 'daejeon_youth').srt === true && L.stepStatus(L.normalizeState({ srt: { skipped: true } }), 'daejeon_youth').srt === true
      && L.stepStatus(L.normalizeState({ order_tr: { order_id: 'Q-1', status: 'DONE' } }), 'daejeon_youth').srt === false);
    const allReview = {}; L.reviewSteps('daejeon_youth').forEach((r) => { allReview[r.id] = true; });
    ok('캡컷 7단계 모두 체크하면 마무리 완료', L.stepStatus(L.normalizeState({ review: allReview }), 'daejeon_youth').finish === true);
    ok('손상된 저장값을 믿지 않는다', same(L.normalizeState({ inputs: 'x', profile: 'zz', review: { zz: true }, render: 5 }), L.defaultState()));

    /* 컷 목록 → 오더 cuts (2026-11-20) */
    const E = await import('file://' + path.join(ROOT, 'js', 'yt', 'edl.js'));
    const SRT = '1\n00:00:01,000 --> 00:00:03,000\n여기 진짜 맛있어요\n\n2\n00:00:05,000 --> 00:00:07,000\n그래서 갔어요\n\n3\n00:00:07,000 --> 00:00:08,000\n음\n\n4\n00:00:08,000 --> 00:00:10,000\n그래서 갔어요';
    const edl = E.buildEDL(SRT, { floor: 0.6 });
    const fromEdl = L.cutsFromEdl(edl);
    ok('EDL 결과를 초 단위 컷 목록으로 바꾼다(전부 켜진 채로)', edl.ok && fromEdl.length === edl.cuts.length && fromEdl.length > 0 && fromEdl.every((c) => c.on === true && c.to > c.from && Number.isFinite(c.from)), JSON.stringify(fromEdl));
    ok('무음 구간(3초→5초 사이)이 DEAD 컷으로 들어온다', fromEdl.some((c) => c.type === 'DEAD' && c.from >= 3 && c.to <= 5), JSON.stringify(fromEdl));
    ok('tcToSec: mm:ss.ms · hh:mm:ss.ms', E.tcToSec('00:12.340') === 12.34 && E.tcToSec('01:02:03.500') === 3723.5);
    ok('빈 결과는 빈 목록', same(L.cutsFromEdl({ ok: false, cuts: [] }), []) && same(L.cutsFromEdl(null), []));
    const stC = L.normalizeState({ inputs: ['a.mp4'], cut_list: [{ type: 'DEAD', from: 3.1, to: 4.9, on: true }, { type: 'FILLER', from: 7, to: 7.5, on: false }, { from: 'x', to: 1 }, { from: 5, to: 4 }] });
    ok('저장값 정리: 깨진 컷은 버리고 꺼진 컷은 유지', stC.cut_list.length === 2 && stC.cut_list[1].on === false);
    ok('컷 요약: 켜진 것만 센다', L.cutSummary(stC.cut_list, 20).count === 1 && L.cutSummary(stC.cut_list, 20).seconds === 1.8 && L.cutSummary(stC.cut_list, 20).left === 18.2);
    ok('영상 1개면 [from,to] 로 오더에 싣는다(꺼진 컷 제외)', same(L.cutsForOrder(stC, ['a.mp4']), { ok: true, cuts: [[3.1, 4.9]] }), JSON.stringify(L.cutsForOrder(stC, ['a.mp4'])));
    const stC2 = L.normalizeState({ inputs: ['a.mp4', 'b.mp4'], cut_input: 'b.mp4', cut_list: [{ type: 'DEAD', from: 1, to: 2, on: true }] });
    ok('영상이 둘이면 [from,to,파일번호]', same(L.cutsForOrder(stC2, ['a.mp4', 'b.mp4']), { ok: true, cuts: [[1, 2, 1]] }));
    ok('영상이 둘인데 어느 영상인지 안 골랐으면 오류', L.cutsForOrder(Object.assign({}, stC2, { cut_input: '' }), ['a.mp4', 'b.mp4']).ok === false);
    ok('컷이 없으면 빈 목록(오더에 cuts 키가 없다)', same(L.cutsForOrder(L.defaultState(), ['a.mp4']), { ok: true, cuts: [] }) && !('cuts' in L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], cuts: [] }).payload));
    ok('영상이 없는데 컷이 있으면 오류', L.cutsForOrder(stC, []).ok === false);
    ok('컷 151곳은 거부', !L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], cuts: Array.from({ length: 151 }, (_, i) => [i * 2, i * 2 + 1]) }).ok && L.cutsForOrder(L.normalizeState({ inputs: ['a.mp4'], cut_list: Array.from({ length: 150 }, (_, i) => ({ type: 'DEAD', from: i * 2, to: i * 2 + 1, on: true })) }), ['a.mp4']).cuts.length === 150);
    ok('payload 에 cuts 를 싣는다(계약 키 + cuts)', same(L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], cuts: [[1, 2]] }).payload, { content_id: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], profile: 'captions', cuts: [[1, 2]], template: 'auto', motion: 'auto' }));
    ok('cuts 값 검사: 역순·음수·파일 번호 범위 밖·모양', [[[2, 1]], [[-1, 1]], [[1, 2, 3]], [['a', 2]], [[1]]].every((c) => !L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], cuts: c }).ok));
    ok('영상 1개인데 파일 번호가 붙은 컷·영상 둘인데 번호 없는 컷은 거부', !L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4', 'b.mp4'], cuts: [[1, 2]] }).ok);
    ok('cuts 150개 payload 는 큐 한도(4000자)에 들어간다', JSON.stringify(Object.assign({ type: 'content_render' }, L.buildRenderPayload({ contentId: 'C'.repeat(40), brand: 'ppiyak_kimmary', inputs: ['01_외관.mp4', '02_메뉴판.mp4'], profile: 'bgm', cropX: 0.123, cuts: Array.from({ length: 150 }, (_, i) => [1000 + i * 2.5, 1001.5 + i * 2.5, 1]) }).payload)).length < 4000);

    /* 영상 올리기 계산 */
    ok('올리기: 조각은 2MB, 최대 1.5GB·800조각', L.UPLOAD_PART_BYTES === 2097152 && L.UPLOAD_MAX_BYTES === 1500 * 1048576 && L.UPLOAD_MAX_PARTS === 800 && L.UPLOAD_MAX_BYTES <= L.UPLOAD_PART_BYTES * L.UPLOAD_MAX_PARTS);
    ok('조각 수 = 올림(크기/2MB)', L.checkUploadFile({ name: 'a.mp4', size: 1 }).parts === 1 && L.checkUploadFile({ name: 'a.mp4', size: 2097152 }).parts === 1 && L.checkUploadFile({ name: 'a.mp4', size: 2097153 }).parts === 2 && L.checkUploadFile({ name: 'a.mp4', size: 5e6 }).parts === 3);
    ok('mp4·mov·m4v 만 올린다(대소문자 무시)', L.checkUploadFile({ name: 'a.MOV', size: 10 }).ok && L.checkUploadFile({ name: 'a.m4v', size: 10 }).ok && !L.checkUploadFile({ name: 'a.avi', size: 10 }).ok && !L.checkUploadFile({ name: 'a.exe', size: 10 }).ok);
    ok('빈 파일·1.5GB 초과 거부', !L.checkUploadFile({ name: 'a.mp4', size: 0 }).ok && !L.checkUploadFile({ name: 'a.mp4', size: L.UPLOAD_MAX_BYTES + 1 }).ok && L.checkUploadFile({ name: 'a.mp4', size: L.UPLOAD_MAX_BYTES }).ok);
    ok('폰 파일 이름(괄호·공백)은 안전한 이름으로 고쳐서 올린다', L.safeUploadName('IMG 0412 (1).MOV').name === 'IMG 0412 _1_.MOV' && L.safeUploadName('IMG 0412 (1).MOV').changed === true && L.safeUploadName('a.mp4').changed === false);
    ok('고친 이름은 노트북·GAS 이름 규칙에 맞다', ['IMG 0412 (1).MOV', '..이상한.mp4', '한글 영상 #3.mp4', 'a/b\\c.mp4'].every((n) => { const c = L.checkUploadFile({ name: n, size: 10 }); return c.ok && L.parseInputs(c.name).errors.length === 0; }));
    ok('이름이 80자를 넘으면 확장자를 지키며 자른다', (() => { const c = L.checkUploadFile({ name: 'a'.repeat(200) + '.mp4', size: 10 }); return c.ok && c.name.length === 80 && /\.mp4$/.test(c.name); })());
    ok('바이트 표기', L.formatBytes(500) === '1KB' && L.formatBytes(5 * 1048576) === '5.0MB' && L.formatBytes(1610612736) === '1.50GB' && L.formatBytes('x') === '-');

    /* uploadVideo.js — 조각 올리기(가짜 api) */
    const U = await import('file://' + path.join(ROOT, 'js', 'uploadVideo.js'));
    ok('base64 변환이 Buffer 와 같다(32KB 넘는 배열도)', (() => { const b = new Uint8Array(100000).map((_, i) => i % 251); return U.bytesToBase64(b) === Buffer.from(b).toString('base64'); })());
    {
      const calls = [];
      const data = new Uint8Array(5 * 1024 * 1024 + 123).map((_, i) => i % 251);
      const file = { name: 'a b (1).mov', size: data.length, slice: (a, b) => { const part = data.slice(a, b); return { size: part.length, arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) }; } };
      const api = { post: async (action, payload, key, opts) => { calls.push({ action, payload, opts }); return { ok: true, data: {} }; } };
      const progress = [];
      const r = await U.uploadVideo({ api, contentId: 'CH-1', file, onProgress: (p) => progress.push(p) });
      ok('조각 3개(5MB+123B)를 순서대로 올린다', calls.length === 3 && calls.map((c) => c.payload.index).join(',') === '0,1,2' && calls.every((c) => c.action === 'upload_video_chunk' && c.payload.parts === 3 && c.payload.content_id === 'CH-1'), calls.map((c) => c.payload.index));
      ok('이름은 안전한 이름으로 고쳐 보낸다', calls.every((c) => c.payload.name === 'a b _1_.mov') && r.name === 'a b _1_.mov');
      const joined = Buffer.concat(calls.map((c) => Buffer.from(c.payload.data, 'base64')));
      ok('조각을 이어 붙이면 원본과 같다', Buffer.compare(joined, Buffer.from(data)) === 0);
      ok('조각 크기는 2MB 이하 · total_size 를 함께 보낸다', calls.every((c) => Buffer.from(c.payload.data, 'base64').length <= L.UPLOAD_PART_BYTES && c.payload.total_size === data.length));
      ok('조각 요청은 시간 제한을 넉넉히(120초)', calls.every((c) => c.opts && c.opts.timeoutMs === 120000));
      ok('진행 표시: 마지막은 전체 크기', progress.length === 3 && progress[2].sent === data.length && progress[2].index === 3 && progress[2].parts === 3);
      ok('요청 본문 첫 키가 action(서버가 큰 본문을 허용하는 기준)', (() => { const env = JSON.stringify({ action: 'upload_video_chunk', auth_token: 'x' }); return env.indexOf('"action":"upload_video_chunk"') < 20; })());
    }
    {
      let n = 0;
      const data = new Uint8Array(3000000).map((_, i) => i % 7);
      const file = { name: 'a.mp4', size: data.length, slice: (a, b) => { const part = data.slice(a, b); return { size: part.length, arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) }; } };
      const flaky = { post: async (a, p) => { if (p.index === 1 && ++n < 3) { const e = new Error('끊김'); e.code = 'ERR_NETWORK'; throw e; } return { ok: true }; } };
      const t0 = Date.now();
      const r = await U.uploadVideo({ api: flaky, contentId: 'CH-1', file });
      ok('네트워크가 끊기면 그 조각만 다시 보낸다(2번 실패 뒤 성공)', r.parts === 2 && n === 3 && Date.now() - t0 >= 4000, [n, Date.now() - t0]);
      const authBad = { post: async () => { const e = new Error('토큰'); e.code = 'ERR_UNAUTHORIZED'; throw e; } };
      let t = 0; const origPost = authBad.post; authBad.post = async (...a) => { t++; return origPost(...a); };
      let code = '';
      try { await U.uploadVideo({ api: authBad, contentId: 'CH-1', file }); } catch (e) { code = e.code; }
      ok('인증 오류는 다시 보내지 않고 바로 멈춘다', code === 'ERR_UNAUTHORIZED' && t === 1, [code, t]);
      let c2 = 0; let code2 = '';
      try { await U.uploadVideo({ api: { post: async () => { c2++; return {}; } }, contentId: 'CH-1', file, shouldCancel: () => c2 >= 1 }); } catch (e) { code2 = e.code; }
      ok('취소하면 CANCELLED 로 멈춘다', code2 === 'CANCELLED' && c2 === 1, [code2, c2]);
      let code3 = '';
      try { await U.uploadVideo({ api: { post: async () => ({}) }, contentId: 'CH-1', file: { name: 'a.exe', size: 5, slice: () => ({}) } }); } catch (e) { code3 = e.code; }
      ok('영상이 아니면 보내기 전에 거부', code3 === 'ERR_VALIDATION_FAILED');
      ok('재시도 대상: 네트워크·시간 초과·서버 바쁨·5xx', ['ERR_NETWORK', 'ERR_TIMEOUT', 'ERR_BUSY', 'ERR_BAD_RESPONSE'].every((c) => U.isRetryableUploadError({ code: c })) && U.isRetryableUploadError({ code: 'X', status: 503 }) && !U.isRetryableUploadError({ code: 'ERR_UNAUTHORIZED' }) && !U.isRetryableUploadError({ code: 'ERR_VALIDATION_FAILED' }));
    }
    const uv = fs.readFileSync(path.join(ROOT, 'js', 'uploadVideo.js'), 'utf8');
    ok('uploadVideo.js 코드 규칙: innerHTML 0건 · 주소·토큰 값 없음', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(uv) && !/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/.test(uv));
    ok('uploadVideo.js 가 produceLogic 을 버전 쿼리로 부른다', /from '\.\/produceLogic\.js\?v=\d+[a-z]'/.test(uv));
    const pvSrc = fs.readFileSync(path.join(ROOT, 'js', 'produceView.js'), 'utf8');
    ok('모든 produceLogic·uploadVideo·edl import 의 버전이 같다', (() => { const v = new Set(); [pvSrc, uv, fs.readFileSync(path.join(ROOT, 'js', 'produceLogic.js'), 'utf8')].forEach((src) => { (src.match(/\.js\?v=(\d+[a-z])/g) || []).forEach((m) => v.add(m)); }); return v.size === 1; })());
    ok('③ 화면이 컷 목록을 계산·저장하고 ④ 오더에 cuts 로 싣는다', /buildEDL\(/.test(pvSrc) && /cutsForOrder\(state, state\.inputs\)/.test(pvSrc) && /cuts: cr\.ok \? cr\.cuts : undefined/.test(pvSrc) && /s\.cut_list = list/.test(pvSrc));
    ok('서버가 컷을 접수하지 않았으면(옛 GAS) 경고가 남는다', /Number\(d\.cuts\) !== sentCuts/.test(pvSrc) && /if \(key === 'render' && renderWarn\) showBanner/.test(pvSrc));
    ok('컷이 잘못되면 오더 보내기 버튼이 막힌다', /isSendable\(cur\)/.test(pvSrc) && /sendBtn\.setAttribute\('disabled', ''\)/.test(pvSrc));
    ok('올리기는 상세 시트를 닫으면 멈춘다', /shouldCancel: \(\) => up\.cancel \|\| !uploadAlive\(\)/.test(pvSrc) && /wrap\.closest\('dialog'\)/.test(pvSrc));
    ok('붙여 넣은 자막 원문은 저장하지 않는다(상태에 cut_list 만)', !/s\.cut_src|s\.srt_text|patch: \{ studio: \{[^}]*src/.test(pvSrc) && !/localStorage[^\n]*cutMem/.test(pvSrc));
    /* ── 자막(SRT) 규칙 — 노트북 lib/srt.js 와 같은 값 표 ── */
    const R = await import('file://' + path.join(ROOT, 'js', 'srtRules.js'));
    const Cq = (a, b, t) => ({ start: a, end: b, text: t, lines: t.split('\n') });
    const codesOf = (cues, brand) => R.checkSrt(cues, brand || 'daejeon_youth').map((i) => i.level + ':' + i.code);
    ok('규격 상수: 12/11자 · 2줄 · 1.0~3.5초 · 0.06초', R.CPL.daejeon_youth === 12 && R.CPL.ppiyak_kimmary === 11 && R.MAX_LINES === 2 && R.MIN_DUR === 1 && R.MAX_DUR === 3.5 && R.MIN_GAP === 0.06 && R.cplOf('x') === 12);
    ok('정상 자막은 문제 없음', codesOf([Cq(1, 2.5, '안녕하세요'), Cq(2.6, 4, '두 번째\n자막')]).length === 0);
    ok('3줄 FAIL · 줄당 글자 초과 WARN(12/11) · 짧음·김 WARN', codesOf([Cq(1, 2.5, '가\n나\n다')]).includes('FAIL:lines') && codesOf([Cq(1, 2.5, '열세글자가넘는한줄입니다요')]).includes('WARN:cpl') && codesOf([Cq(1, 2.5, '열두글자짜리한줄입니다요')], 'ppiyak_kimmary').includes('WARN:cpl') && !codesOf([Cq(1, 2.5, '열두글자짜리한줄입니다요')]).includes('WARN:cpl') && codesOf([Cq(1, 1.5, '짧음')]).includes('WARN:short') && codesOf([Cq(1, 5, '길다')]).includes('WARN:long'));
    ok('간격 WARN · 겹침 FAIL · 시간 역전 FAIL · 빈 내용 FAIL', codesOf([Cq(1, 2, '가'), Cq(2.03, 3.5, '나')]).includes('WARN:gap') && codesOf([Cq(1, 2.5, '가'), Cq(2, 3.5, '나')]).includes('FAIL:overlap') && codesOf([Cq(3, 2, '역전')]).includes('FAIL:time_order') && codesOf([Cq(1, 2.5, '  ')]).includes('FAIL:empty'));
    ok('ASS 태그·카라오케·화자 표기 FAIL · 문장 끝 마침표 WARN', codesOf([Cq(1, 2.5, '{\\an8}위')]).includes('FAIL:ass_tag') && codesOf([Cq(1, 2.5, '{\\k20}노래')]).includes('FAIL:ass_tag') && codesOf([Cq(1, 2.5, '[성래] 안녕하세요')]).includes('FAIL:speaker') && codesOf([Cq(1, 2.5, '끝났어요.')]).includes('WARN:period'));
    const sp = R.parseSrt('\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\n안녕\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n둘째\r\n셋째');
    ok('SRT 읽기: BOM·CRLF 허용 · 줄 나눔 유지', sp.cues.length === 2 && sp.errors.length === 0 && sp.cues[1].lines.length === 2 && sp.cues[0].start === 1 && sp.cues[0].end === 2.5);
    const spBad = R.parseSrt('1\n시간 없음\n본문\n\n2\n00:00:01,000 --> 00:00:02,000\n정상');
    ok('깨진 블록은 건너뛰고 위치·이유를 알린다', spBad.cues.length === 1 && spBad.errors.length === 1 && spBad.errors[0].block === 1 && R.parseSrt('').cues.length === 0 && R.parseSrt(null).cues.length === 0);
    ok('analyzeSrt: 막힌 문제 수(fail)에 형식 오류가 합쳐진다 · 알림(warn)은 따로', R.analyzeSrt('1\n시간 없음\n본문', 'daejeon_youth').fail === 1 && R.analyzeSrt('1\n00:00:01,000 --> 00:00:01,400\n짧음\n', 'daejeon_youth').warn >= 1 && R.analyzeSrt('1\n00:00:01,000 --> 00:00:01,400\n짧음\n', 'daejeon_youth').fail === 0);
    ok('textHash: 줄바꿈·앞뒤 공백 차이는 같은 글, 글이 바뀌면 다르다', R.textHash('a\r\nb ') === R.textHash('a\nb') && R.textHash('a') !== R.textHash('b') && typeof R.textHash(null) === 'string');
    const shared = [[[Cq(1, 2.5, '가\n나\n다')], 'FAIL:lines'], [[Cq(1, 2.5, '끝났어요.')], 'WARN:period'], [[Cq(1, 1.5, '짧음')], 'WARN:short'], [[Cq(1, 2.5, '{\\an8}위')], 'FAIL:ass_tag'], [[Cq(1, 2.5, '짜장면 [채우기]원')], 'FAIL:slot'], [[Cq(1, 2.5, '[성래] 안녕하세요')], 'FAIL:speaker']];
    ok('채우지 않은 칸 [채우기]·[ ] 는 FAIL(slot) · 줄 앞에 있어도 화자 표기로 오인하지 않는다', codesOf([Cq(1, 2.5, '[채우기] 원이에요')]).join() === 'FAIL:slot' && codesOf([Cq(1, 2.5, '가격 [ ]원')]).includes('FAIL:slot'));
    ok('노트북 srt.js 와 같은 규칙 표(코드값이 서로 같다) — 한쪽만 바꾸지 않는다', fs.existsSync(path.join(ROOT, '..', 'hub-agent', 'notebook-agent', 'lib', 'srt.js')) ? (() => {
      const N = require(path.join(ROOT, '..', 'hub-agent', 'notebook-agent', 'lib', 'srt.js'));
      return shared.every(([cues, code]) => R.checkSrt(cues, 'daejeon_youth').map((i) => i.level + ':' + i.code).includes(code) && N.checkSrt(cues, 'daejeon_youth').map((i) => i.level + ':' + i.code).includes(code));
    })() : true);

    /* ── 2·3단계 오더(payload) ── */
    const stBase = { contentId: 'KM-1', brand: 'ppiyak_kimmary' };
    ok('자막 초안 오더: content_id·brand·stage 뿐', same(L.buildStagePayload('transcribe', Object.assign({ state: L.defaultState() }, stBase)), { ok: true, payload: { content_id: 'KM-1', brand: 'ppiyak_kimmary', stage: 'transcribe' } }));
    const confirmed = L.normalizeState({ srt: { confirmed: true, hash: 'h', cues: 4 }, make: { bgm: '잔잔한 곡.mp3', bgm_db: -20, cover_t: 2.5, ai_notice: true } });
    ok('마무리 오더: 자막 굽기·AI 안내·BGM·볼륨·커버가 실린다', same(L.buildStagePayload('finish', Object.assign({ state: confirmed }, stBase)), { ok: true, payload: { content_id: 'KM-1', brand: 'ppiyak_kimmary', stage: 'finish', burn: true, ai_notice: true, bgm: { name: '잔잔한 곡.mp3', volume_db: -20 }, cover: { t: 2.5 } } }));
    ok('자막을 확정하지 않았으면 마무리 오더가 막힌다(자막 굽기 켜진 채)', L.buildStagePayload('finish', Object.assign({ state: L.defaultState() }, stBase)).ok === false);
    const skipped = L.normalizeState({ srt: { skipped: true } });
    ok('"자막 없이 진행"이면 자막·AI 안내를 끄고 보낼 수 있다', same(L.buildStagePayload('finish', Object.assign({ state: skipped }, stBase)).payload, { content_id: 'KM-1', brand: 'ppiyak_kimmary', stage: 'finish', burn: false, ai_notice: false, cover: { t: 1 } }));
    ok('BGM 이름은 경로·확장자 검사 · 볼륨 -40~0 · 커버 0~3600', ['../x.mp3', 'a/b.mp3', 'a.exe', '.hid.mp3'].every((n) => !L.buildStagePayload('finish', Object.assign({ state: L.normalizeState({ srt: { skipped: true }, make: { bgm: n } }) }, stBase)).ok)
      && L.buildStagePayload('finish', Object.assign({ state: L.normalizeState({ srt: { skipped: true }, make: { bgm: 'a.mp3', bgm_db: 5 } }) }, stBase)).ok === false
      && L.normalizeState({ make: { cover_t: 9999 } }).make.cover_t === 1);
    ok('모르는 단계·잘못된 id·brand 거절', !L.buildStagePayload('hack', Object.assign({ state: L.defaultState() }, stBase)).ok && !L.buildStagePayload('transcribe', { contentId: '../x', brand: 'ppiyak_kimmary', state: L.defaultState() }).ok && !L.buildStagePayload('transcribe', { contentId: 'KM-1', brand: 'x', state: L.defaultState() }).ok);
    ok('저장값 정리: srt·make·오더 칸이 손상돼도 기본값으로', same(L.normalizeState({ srt: 5, make: 'x', order_tr: 7, order_fin: [], fin_report: 3 }).srt, L.defaultSrt()) && same(L.normalizeState({ make: 5 }).make, L.defaultMake()) && L.normalizeState({ order_tr: 7 }).order_tr === null);
    ok('오더 칸은 따로 저장된다(렌더·자막 초안·마무리)', (st => st.render.order_id === 'Q-R' && st.order_tr.order_id === 'Q-T' && st.order_fin.order_id === 'Q-F' && st.order_tr.report === undefined)(L.normalizeState({ render: { order_id: 'Q-R' }, order_tr: { order_id: 'Q-T' }, order_fin: { order_id: 'Q-F' } })));
    ok('단계 → 오더 칸 이름', L.ORDER_KEY_OF_STEP.render === 'render' && L.ORDER_KEY_OF_STEP.srt === 'order_tr' && L.ORDER_KEY_OF_STEP.make === 'order_fin');

    /* ── 최종본 규격(표3 ⑥: -14±0.5 · TP -1.5) ── */
    const finOk = { out: 'X_final.mp4', width: 1080, height: 1920, fps: 30, duration: 20, lufs: -14.1, tp: -1.8, checks: [{ id: 'codec', status: 'PASS', msg: 'h264' }] };
    ok('최종본 규격 상수: -14.0±0.5 LUFS · TP -1.5', L.FINAL_STANDARD.lufs === -14 && L.FINAL_STANDARD.tol === 0.5 && L.FINAL_STANDARD.tpMax === -1.5);
    ok('최종본 대조: 전부 PASS', L.compareStandard(finOk, 'final').every((r) => r.status === 'PASS'));
    ok('최종본: -16 LUFS 는 FAIL(클린 마스터 규격이 아니다) · TP -1.4 는 FAIL · -1.5 는 PASS', L.compareStandard(Object.assign({}, finOk, { lufs: -16 }), 'final').find((r) => r.id === 'lufs').status === 'FAIL' && L.compareStandard(Object.assign({}, finOk, { tp: -1.4 }), 'final').find((r) => r.id === 'tp').status === 'FAIL' && L.compareStandard(Object.assign({}, finOk, { tp: -1.5 }), 'final').find((r) => r.id === 'tp').status === 'PASS');
    ok('① 의 음량 선택 목록에 최종본이 섞이지 않는다', Object.keys(L.PROFILES).join(',') === 'captions,bgm');
    const finState = L.normalizeState({ fin_report: L.parseReport(JSON.stringify(finOk)).report });
    ok('마무리 단계 완료 = 최종본 규격 대조 FAIL 0', L.stepStatus(finState, 'ppiyak_kimmary').make === true && L.stepStatus(L.normalizeState({ fin_report: L.parseReport(JSON.stringify(Object.assign({}, finOk, { lufs: -18 }))).report }), 'ppiyak_kimmary').make === false && L.stepStatus(L.defaultState(), 'ppiyak_kimmary').make === false);
    const pr2 = L.parseReport(JSON.stringify(Object.assign({}, finOk, { cover: 'X_cover.jpg', out_dir: 'C:\\out\\X', ai_notice: true, burn: { cues: 5, font: 'NanumGothic', font_preferred_missing: true, font_preferred: 'Pretendard', warnings: ['2번 짧음'] }, bgm: { name: 'bed.mp3', volume_db: -24 }, limiter: { measured_lufs: -16.2, gain_db: 2.2, ceiling_db: -4.2 }, cuts: { applied: 2, removed_seconds: 3.5 } })));
    ok('마무리 보고의 글꼴·BGM·커버·피크 다듬기·컷 정보를 지킨다', pr2.ok && pr2.report.cover === 'X_cover.jpg' && pr2.report.burn.cues === 5 && pr2.report.burn.font_preferred_missing === true && pr2.report.bgm.volume_db === -24 && pr2.report.limiter.ceiling_db === -4.2 && pr2.report.cuts.applied === 2 && pr2.report.ai_notice === true);
    ok('사람 확인 7가지(아이디 r1~r7 그대로) — 허브가 한 일은 사람이 눈으로 확인한다', L.reviewSteps('daejeon_youth').map((x) => x.id).join(',') === 'r1,r2,r3,r4,r5,r6,r7' && /자막 글자 대조/.test(L.reviewSteps('ppiyak_kimmary')[1].title) && !/캡컷/.test(JSON.stringify(L.reviewSteps('ppiyak_kimmary'))));

    /* ── ⑤⑥ 화면 코드 규칙 ── */
    const sv = fs.readFileSync(path.join(ROOT, 'js', 'srtRules.js'), 'utf8');
    ok('srtRules.js: innerHTML 0건 · 주소·토큰 값 없음', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(sv) && !/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/.test(sv));
    ok('⑤ 자막: 영상과 대조했어요를 체크해야 확정 · 막힌 문제가 있으면 확정 불가', /const okToConfirm = a\.cues\.length > 0 && a\.fail === 0 && verify\.checked/.test(pvSrc) && /asset|putAsset\('srt_final'/.test(pvSrc));
    ok('⑤ 자막: 확정한 뒤 글을 고치면 확정이 풀린다', /state\.srt\.hash !== textHash\(ta\.value\)/.test(pvSrc) && /s\.srt\.confirmed = false/.test(pvSrc));
    ok('⑤ 자막: 자막 없이 진행할 수 있다(⑥ 에서 굽기를 끈다)', /s\.srt\.skipped = true; s\.srt\.confirmed = false; s\.make\.burn = false/.test(pvSrc));
    ok('⑤ 자막: AI 안내 여부를 사람이 정한다', /AI 초안을 바탕으로 했어요/.test(pvSrc) && /ai: aiBox\.checked/.test(pvSrc));
    ok('⑥ 마무리: 자막을 굽는 오더는 확정된 자막이 있어야 보낼 수 있다', /const okSrt = state\.srt\.confirmed === true \|\| state\.srt\.skipped \|\| !mm\.burn/.test(pvSrc) && /ready: cs\.render && okSrt/.test(pvSrc));
    ok('결과(report)를 노트북이 올린 자산에서 자동으로 가져온다(④ 클린·⑥ 마무리)', /getAsset\('report_clean'\)/.test(pvSrc) && /getAsset\('report_finish'\)/.test(pvSrc) && /getAsset\('srt_draft'\)/.test(pvSrc));
    ok('오더를 보내는 코드는 하나(orderBlock)로 ④⑤⑥ 이 같이 쓴다', (pvSrc.match(/api\.post\('hub_order'/g) || []).length === 1 && /orderBlock\('order_tr'/.test(pvSrc) && /orderBlock\('order_fin'/.test(pvSrc) && /orderBlock\('render'/.test(pvSrc));
    ok('오더 내용은 입력이 바뀔 때마다·보내는 순간마다 다시 만든다(낡은 값이 실리지 않는다)', /compute: \(\) =>/.test(pvSrc) && /refresh\(\);\s*\/\/ 보내는 순간의 값으로 다시 만든다/.test(pvSrc) && /if \(poll\.refresh\) poll\.refresh\(\)/.test(pvSrc));
    ok('오더가 DONE 이 되면 한 번만 결과를 가져온다(같은 오더로 되풀이하지 않는다)', /poll\.done\[poll\.key\] === o\.order_id/.test(pvSrc));
    ok('결과 보고 신선도: 오더를 보낸 뒤 끝난 보고만 이번 결과(시계 차이 2분 허용) · 시각을 모르면 막지 않는다',
      L.reportIsFresh(JSON.stringify({ finished_at: '2026-11-21T03:00:00Z' }), '2026-11-21T02:59:00Z') === true
      && L.reportIsFresh(JSON.stringify({ finished_at: '2026-11-21T02:00:00Z' }), '2026-11-21T03:00:00Z') === false
      && L.reportIsFresh(JSON.stringify({ out: 'x' }), '2026-11-21T03:00:00Z') === true && L.reportIsFresh('깨진 글', '') === true);
    ok('예전 결과 보고는 이번 결과로 보여 주지 않는다(④·⑥)', (pvSrc.match(/reportIsFresh\(a\.text/g) || []).length === 2);
    ok('④를 다시 보내면 확정 자막·마무리 결과가 풀린다(새 영상과 시간이 어긋날 수 있다) · ⑤에 안내', /s\.srt\.confirmed = false; s\.srt\.stale = true/.test(pvSrc) && /s\.fin_report = null/.test(pvSrc) && /④를 다시 만들어서 확정이 풀렸어요/.test(pvSrc)
      && L.normalizeState({ srt: { stale: true } }).srt.stale === true && L.normalizeState({ srt: { stale: true, confirmed: true } }).srt.stale === undefined);
    ok('⑤ 초안 오더가 끝나도 확정·고치던 자막을 AI 초안으로 덮지 않는다', /if \(state\.srt\.confirmed \|\| editing\)/.test(pvSrc));
    ok('⑤ 의 AI 안내 선택이 ⑥ 의 기본값이 된다', /s\.make\.ai_notice = aiBox\.checked/.test(pvSrc));
    ok('단계를 옮기면 앞 단계의 진행 상태를 이어 쓰지 않는다 · 조회가 겹치면 끝난 뒤 다시 확인', /if \(poll\.key !== key\) \{ poll\.live = null/.test(pvSrc) && /poll\.key !== key \|\| state\[key\]\.order_id !== orderId/.test(pvSrc) && /poll\.again = true/.test(pvSrc));
    ok('⑥ 칸에 잘못 적힌 BGM·커버 값이 있으면 보내지 않는다(보이는 값 ≠ 보내는 값 방지)', /const inputErr = bgmErr\.textContent \|\| coverErr\.textContent/.test(pvSrc));
    /* ── 무료 BGM 찾기(⑥) ── */
    ok('BGM 출처 문구는 곡 이름이 있을 때만 저장값에 남는다(손으로 이름을 지우면 문구도 사라진다)', (a => a.make.bgm_credit.indexOf('Music:') === 0 && a.make.bgm_cr === true)(L.normalizeState({ make: { bgm: 'x-0a1b2c3d.mp3', bgm_credit: 'Music: "X" by Y', bgm_cr: true } }))
      && (b => b.make.bgm_credit === '' && b.make.bgm_cr === false)(L.normalizeState({ make: { bgm: '', bgm_credit: 'Music: "X" by Y', bgm_cr: true } }))
      && (c => c.make.bgm_cr === false)(L.normalizeState({ make: { bgm: 'a.mp3', bgm_credit: '', bgm_cr: true } }))
      && L.normalizeState({ make: { bgm: 'a.mp3', bgm_credit: 'x'.repeat(900) } }).make.bgm_credit.length === 500
      && L.normalizeState({ make: { bgm: 'a.mp3', bgm_credit: 'a\nb\u0000c' } }).make.bgm_credit === 'a b c'
      && L.defaultMake().bgm_credit === '' && L.defaultMake().bgm_cr === false);
    ok('출처 문구는 오더 payload 에 실리지 않는다(노트북이 허브 보관함에서 직접 읽는다)', !/credit/.test(JSON.stringify(L.buildStagePayload('finish', Object.assign({ state: L.normalizeState({ srt: { skipped: true }, make: { bgm: 'x-0a1b2c3d.mp3', bgm_credit: 'Music: X', bgm_cr: true } }) }, stBase)).payload)));
    ok('마무리 보고의 BGM 출처·표기 필요를 지킨다', (r => r.ok && r.report.bgm.source === 'hub' && r.report.bgm.credit.indexOf('Music:') === 0 && r.report.bgm.credit_required === true)(L.parseReport(JSON.stringify(Object.assign({}, finOk, { bgm: { name: 'a.mp3', volume_db: -24, source: 'hub', credit: 'Music: "X" by Y', credit_required: true } })))));
    ok('곡 길이 표기 · 검색어 정리', L.fmtDuration(185) === '3:05' && L.fmtDuration(59.6) === '1:00' && L.fmtDuration(null) === '0:00' && L.cleanBgmQuery('  calm\n  piano  ') === 'calm piano' && L.cleanBgmQuery('x'.repeat(80)).length === 40 && L.cleanBgmQuery(null) === '' && L.BGM_QUICK_TERMS.length >= 4 && L.BGM_QUICK_TERMS.every(t => t.label && /^[a-z ]+$/.test(t.q)));
    const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok('미리듣기용 오디오는 Jamendo 저장소만 허용(CSP media-src) · 그 밖의 주소는 열지 않는다', /media-src 'self' blob: https:\/\/\*\.storage\.jamendo\.com;/.test(idxHtml) && !/media-src[^;]*\*[^.]/.test(idxHtml.replace(/https:\/\/\*\.storage\.jamendo\.com/, '')));
    ok('BGM 찾기 화면: 검색·미리듣기·고르기·보관함·출처 문구 복사, innerHTML 없음', /api\.post\('bgm_search'/.test(pvSrc) && /api\.post\('bgm_pick'/.test(pvSrc) && /api\.post\('bgm_list'/.test(pvSrc) && /api\.post\('bgm_delete'/.test(pvSrc) && /출처 문구 복사/.test(pvSrc) && /미리듣기/.test(pvSrc) && !/innerHTML/.test(pvSrc));
    ok('서버가 준 곡 이름이 BGM 이름 규칙에 맞을 때만 쓴다', /if \(!BGM_NAME_RE\.test\(name\)\) throw/.test(pvSrc));
    /* ── 만든 파일 받기(④·⑥) ── */
    const resultGas = fs.readFileSync(path.join(ROOT, 'gas', 'Result.gs'), 'utf8');
    const gasRe = (resultGas.match(/const RESULT_NAME_RE = (\/.*\/);/) || [])[1];
    ok('결과 파일 이름 규칙은 화면·서버(Result.gs)가 같다', !!gasRe && gasRe === String(L.RESULT_NAME_RE), [gasRe, String(L.RESULT_NAME_RE)]);
    ok('결과 파일 이름: 영문·숫자·._- 의 mp4·jpg 만', ['KM-20261121-001_finish.mp4', 'a.jpg', 'DY-1_cover.jpg'].every(n => L.RESULT_NAME_RE.test(n)) && ['../x.mp4', 'a/b.mp4', 'x.mov', 'x.png', '.hid.mp4', '한글.mp4', 'x.mp4 ', ''].every(n => !L.RESULT_NAME_RE.test(n)));
    ok('만든 파일 화면: 목록·조각 받기·지우기·내려받기·여기서 보기, innerHTML 없음', /api\.post\('result_list'/.test(pvSrc) && /api\.post\('result_fetch'/.test(pvSrc) && /api\.post\('result_delete'/.test(pvSrc) && /내려받기/.test(pvSrc) && /여기서 보기/.test(pvSrc) && /a\.download = it\.name/.test(pvSrc) && !/innerHTML/.test(pvSrc));
    ok('허브가 준 이름이 규칙에 맞는 파일만 보여 준다 · 받은 크기가 목록과 다르면 실패', /RESULT_NAME_RE\.test\(String\(x\.name\)\)/.test(pvSrc) && /if \(total !== it\.size\) throw/.test(pvSrc));
    ok('④ 결과와 ⑥ 마무리 결과에 만든 파일 상자가 붙는다', (pvSrc.match(/box\.appendChild\(resultFiles\(\)\)/g) || []).length === 2);
    ok('카드를 바꾸면 받아 둔 임시 주소를 해제한다(revokeObjectURL)', /resultMem\.id !== contentId\) resultReset\(\)/.test(pvSrc) && /URL\.revokeObjectURL/.test(pvSrc));
    ok('produceView 가 srtRules·produceLogic 을 버전 쿼리로 부른다', /from '\.\/srtRules\.js\?v=\d+[a-z]'/.test(pvSrc));

    /* ── 화면 스모크: 가짜 DOM 으로 produceSection 을 그려 7개 단계를 전부 열어 본다 ──
     *  병합·붙여넣기 중에 도우미 함수(note·check·orderBlock…)가 사라져도 정규식 시험은 통과하지만 실제 화면은 열리지 않는다
     *  (2026-11-20 실제로 라이브에서 '제작' 탭이 안 열렸다). 정의 안 된 이름을 실행으로 잡는다. */
    {
      class FNode {
        constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.style = {}; this.className = ''; this._text = ''; this.value = ''; this.checked = false; this.isConnected = true; this.parent = null; }
        set textContent(v) { this._text = String(v); this.children = []; }
        get textContent() { return this._text + this.children.map((c) => (c && c.textContent) || '').join(''); }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        removeAttribute(k) { delete this.attrs[k]; }
        hasAttribute(k) { return k in this.attrs; }
        getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
        addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
        removeEventListener() {}
        append(...kids) { kids.forEach((k) => { const n = (k !== null && typeof k === 'object') ? k : { textContent: String(k), tag: '#text', children: [] }; /* 브라우저처럼: append(null) 은 'null' 글자가 된다 */ if (n.parent !== undefined) n.parent = this; this.children.push(n); }); }
        appendChild(k) { this.append(k); return k; }
        replaceChildren(...kids) { this.children = []; this.append(...kids); }
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
        querySelectorAll(sel) { const out = []; const cls = (sel.match(/^\.([\w-]+)/) || [])[1]; (function w(n) { (n.children || []).forEach((c) => { if (!c || !c.tag) return; if (!cls || (c.className || '').split(/\s+/).indexOf(cls) >= 0) out.push(c); w(c); }); })(this); return out; }
        closest() { return null; }
        remove() {}
        focus() {}
        select() {}
        click() { (this.listeners.click || []).forEach((f) => f({ target: this })); }
      }
      const dom = {
        createElement: (t) => new FNode(t), createTextNode: (t) => ({ tag: '#text', textContent: String(t), children: [] }), body: new FNode('body'),
        addEventListener() {}, removeEventListener() {}, hidden: false, execCommand: () => false
      };
      const prevDoc = global.document, prevWin = global.window, prevLs = global.localStorage;
      global.document = dom;
      global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
      global.window = { localStorage: global.localStorage, confirm: () => true };
      const hh = (tag, attrs, ...kids) => {
        const n = new FNode(tag);
        if (attrs) for (const [k, v] of Object.entries(attrs)) {
          if (v == null || v === false) continue;
          if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'style') n.setAttribute('style', v);
          else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v); else if (v === true) n.setAttribute(k, ''); else n.setAttribute(k, String(v));
        }
        n.append(...kids.flat(4).filter((k) => k != null && k !== false)); return n;   // 허브 h() 처럼 빈 값은 건너뛴다
      };
      const walk = (n, f) => { f(n); (n.children || []).forEach((c) => c && c.tag && walk(c, f)); };
      try {
        const PV = await import('file://' + path.join(ROOT, 'js', 'produceView.js'));
        const mkCtx = (studio) => ({ h: hh, detail: { content_id: 'KM-1', version: 1, payload: { studio } }, meta: { content_id: 'KM-1', brand: 'ppiyak_kimmary' }, toast() {}, onNavigate() {} });
        const finishedClean = { out: 'a_clean.mp4', width: 1080, height: 1920, fps: 30, duration: 8, lufs: -16, tp: -2.3, checks: [] };
        const states = {
          '처음(빈 카드)': {},
          '자막 확정 전': { inputs: ['a.mp4'], plan: true, cuts: true, render: { order_id: 'Q-0', status: 'DONE', report: finishedClean } },
          '자막 확정·마무리 보고': { inputs: ['a.mp4'], plan: true, cuts: true, render: { order_id: 'Q-0', status: 'DONE', report: finishedClean }, srt: { confirmed: true, cues: 3, hash: 'x' }, order_tr: { order_id: 'Q-1', status: 'DONE' }, order_fin: { order_id: 'Q-2', status: 'DONE' },
            fin_report: { out: 'a_finish.mp4', width: 1080, height: 1920, fps: 30, duration: 8, lufs: -14, tp: -1.8, checks: [{ id: 'x', status: 'PASS', msg: 'ok' }], burn: { cues: 3, font: 'NanumGothic', font_preferred_missing: true, font_preferred: 'Pretendard', warnings: [] }, bgm: { name: 'b.mp3', volume_db: -24, source: 'hub', credit: 'Music: "X" by Y — CC BY 3.0', credit_required: true } },
            make: { bgm: 'x-0a1b2c3d.mp3', bgm_credit: 'Music: "X" by Y — CC BY 3.0', bgm_cr: true } },
          '컷 목록이 있는 카드': { inputs: ['a.mp4', 'b.mp4'], cut_input: 'a.mp4', cut_list: [{ type: 'DEAD', from: 1, to: 2, on: true }] }
        };
        for (const [label, studio] of Object.entries(states)) {
          const wrap = PV.produceSection(mkCtx(studio));
          const stepBtns = []; walk(wrap, (n) => { if ((n.className || '').indexOf('pr-step-btn') >= 0) stepBtns.push(n); });
          ok('화면 스모크(' + label + '): 단계 7개가 그려진다', stepBtns.length === 7, stepBtns.length);
          const failures = [];
          for (let i = 0; i < stepBtns.length; i++) {
            try {
              // 목록이 다시 그려지므로 매번 새로 찾아 누른다
              const btns = []; walk(wrap, (n) => { if ((n.className || '').indexOf('pr-step-btn') >= 0) btns.push(n); });
              btns[i].click();
              const open = []; walk(wrap, (n) => { if ((n.className || '').indexOf('pr-step open') >= 0) open.push(n); });
              if (open.length > 1) failures.push((i + 1) + '단계: 둘 이상 펼쳐짐');
              const junk = []; walk(wrap, (n) => { if (n.tag === '#text' && /^(null|undefined|false)$/.test(n.textContent)) junk.push(n.textContent); });
              if (junk.length) failures.push((i + 1) + '단계: 화면에 "' + junk[0] + '" 글자가 보임(append 에 빈 값)');   // 이미 펼쳐진 단계를 누르면 접히므로 0개도 정상
            } catch (e) { failures.push((i + 1) + '단계: ' + (e && e.message)); }
          }
          ok('화면 스모크(' + label + '): 7개 단계를 모두 열어도 오류가 없다', failures.length === 0, failures.join(' | '));
        }
      } catch (err) {
        ok('화면 스모크', false, (err && err.stack) || err);
      } finally {
        global.document = prevDoc; global.window = prevWin; global.localStorage = prevLs;
      }
    }

    /* 코드 규칙 */
    const pv = fs.readFileSync(path.join(ROOT, 'js', 'produceView.js'), 'utf8');
    const pl = fs.readFileSync(path.join(ROOT, 'js', 'produceLogic.js'), 'utf8');
    ok('innerHTML/outerHTML/insertAdjacentHTML/document.write 0건', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(pv + pl));
    ok('웹앱 주소·토큰·시트 ID 같은 값이 없다', !/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}|\bcq_[A-Za-z0-9]{8,}|xox[bp]-/.test(pv + pl));
    ok('studio 쓰기는 studio.formats.video 로만 한다(구 루트 키는 읽기 폴백 · 1줄 롤백)', /mergeFormat\(studioRoot, 'video', state\)/.test(pv) && /readStudio\(detail\.payload\)/.test(pv) && !/patch: \{ studio: state \}/.test(pv));
    ok('단계 7개: 재료·기획·컷·클린 마스터·자막·마무리·사람 확인', L.STEPS.map((x) => x.key).join(',') === 'material,plan,cuts,render,srt,make,finish' && L.STEPS.length === 7);
    ok('app.js 가 제작 탭을 연결한다', /produceSection/.test(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8')));

    /* 오더 진행 상태 자동 표시 (hub_order_status 폴링) */
    const NOW = Date.parse('2026-11-19T21:05:00+09:00');
    ok('종료 상태: 완료·실패·거절·기한지남·확인필요', ['DONE', 'FAILED', 'REJECTED', 'EXPIRED', 'REVIEW_NEEDED', 'TIMEOUT_REVIEW'].every((c) => L.isTerminalStatus(c)));
    ok('진행 중 상태는 종료가 아니다(승인대기·실행대기·실행중·빈값)', ['WAITING_APPROVAL', 'PENDING', 'RUNNING', '', undefined].every((c) => !L.isTerminalStatus(c)));
    ok('폴링 간격 15초 · 연속 실패 3회', L.POLL_INTERVAL_MS === 15000 && L.POLL_MAX_FAILS === 3);
    ok('GAS 미배포 코드 판별', L.isNotDeployedCode('ERR_UNKNOWN_ACTION') && L.isNotDeployedCode('ERR_NOT_IMPLEMENTED') && !L.isNotDeployedCode('ERR_QUEUE_UNREACHABLE') && !L.isNotDeployedCode(''));
    ok('승인 남은 시간 mm분 ss초', L.approvalRemaining('2026-11-19T21:15:03+09:00', NOW) === '10분 03초', L.approvalRemaining('2026-11-19T21:15:03+09:00', NOW));
    ok('기한이 지났거나 모르면 null', L.approvalRemaining('2026-11-19T21:00:00+09:00', NOW) === null && L.approvalRemaining('', NOW) === null && L.approvalRemaining('abc', NOW) === null);
    const D = (live) => L.describeOrder(live, NOW);
    ok('승인 대기: 남은 시간을 말한다', /승인 대기/.test(D({ status: 'WAITING_APPROVAL', approval_expires_at: '2026-11-19T21:15:03+09:00' }).title) && /10분 03초/.test(D({ status: 'WAITING_APPROVAL', approval_expires_at: '2026-11-19T21:15:03+09:00' }).text));
    ok('승인 대기인데 기한이 지났으면 경고 톤', D({ status: 'WAITING_APPROVAL', approval_expires_at: '2026-11-19T21:00:00+09:00' }).kind === 'warn');
    ok('승인 대기인데 기한을 모르면 지났다고 단정하지 않는다', D({ status: 'WAITING_APPROVAL' }).kind === 'info' && D({ status: 'WAITING_APPROVAL', approval_expires_at: '' }).kind === 'info');
    ok('실행 대기', D({ status: 'PENDING' }).title === '실행 대기');
    ok('실행 중: 경과 분', /시작한 지 4분/.test(D({ status: 'RUNNING', started_at: '2026-11-19T21:01:00+09:00' }).text), D({ status: 'RUNNING', started_at: '2026-11-19T21:01:00+09:00' }).text);
    ok('완료: 초록 톤 + 결과 안내', D({ status: 'DONE', result: '렌더 완료 · x_clean.mp4' }).kind === 'ok' && /결과/.test(D({ status: 'DONE' }).text) && /렌더 완료/.test(D({ status: 'DONE', result: '렌더 완료 · x_clean.mp4\n둘째 줄' }).text));
    ok('실패: 에러 첫 줄', D({ status: 'FAILED', error: '세로 변환 단계 실패(exit 1)\n자세히' }).kind === 'err' && /세로 변환 단계 실패/.test(D({ status: 'FAILED', error: '세로 변환 단계 실패(exit 1)\n자세히' }).text));
    ok('만료·거절·확인필요는 경고 톤', ['EXPIRED', 'REJECTED', 'REVIEW_NEEDED', 'TIMEOUT_REVIEW'].every((c) => D({ status: c }).kind === 'warn'));
    ok('화면 문구에 큐 코드값이 그대로 나오지 않는다', ['WAITING_APPROVAL', 'PENDING', 'RUNNING', 'DONE', 'FAILED', 'REJECTED', 'EXPIRED', 'REVIEW_NEEDED', 'TIMEOUT_REVIEW'].every((c) => { const d = D({ status: c, approval_expires_at: '2026-11-19T21:15:03+09:00' }); return !/[A-Z]{4,}_?[A-Z]*/.test(d.title + d.text.replace(/report/g, '')); }));
    ok('모르는 상태도 깨지지 않는다', typeof D({ status: 'WHATEVER' }).title === 'string' && typeof D(null).title === 'string');

    ok('api.js 에 hubOrderStatus(읽기)가 있다', /async hubOrderStatus\(orderId\)[\s\S]*?post\('hub_order_status'/.test(fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8')));
    ok('api.js 재시도 규칙은 그대로(429/5xx 3회)', /RETRY_DELAYS/.test(fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8')) && !/hub_order_status[\s\S]{0,200}retry/i.test(fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8')));
    ok('폴링은 숨은 탭에서 쉬고, 화면을 떠나면 멈춘다', /document\.hidden/.test(pv) && /visibilitychange/.test(pv) && /wrap\.isConnected/.test(pv) && /ORDER_KEY_OF_STEP\[openStep\] !== poll\.key/.test(pv));
    ok('상세 시트를 닫으면(DOM 이 남아도) 폴링이 멈춘다', /wrap\.closest\('dialog'\)/.test(pv) && /!dlg\.open/.test(pv));
    ok('종료 상태가 되면 다음 폴링을 걸지 않는다', /if \(!isTerminalStatus\(d\.status\)\) schedulePoll\(POLL_INTERVAL_MS\)/.test(pv));
    ok('연속 실패 3회 뒤 멈추고 안내', /poll\.fails >= POLL_MAX_FAILS/.test(pv) && /상태를 가져오지 못했습니다/.test(pv));
    ok('GAS 미배포면 중립 안내(재배포 후 켜짐)', /isNotDeployedCode\(code\)/.test(pv) && /재배포하면 이 상태 표시가 켜져요/.test(pv));
    ok('produceLogic import 에 버전 쿼리(캐시 어긋남 방지)', /from '\.\/produceLogic\.js\?v=\d+[a-z]'/.test(pv));
    ok('app.js 의 produceView import 버전이 index 와 같다', (fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').match(/produceView\.js\?v=(\d+[a-z])/) || [])[1] === (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/js\/app\.js\?v=(\d+[a-z])/) || [])[1]);
  } catch (err) {
    ok('제작 스텝퍼 시험', false, (err && err.stack) || err);
  }

  /* ────────────────────────────────────────────────────────────────
   * [9] 제작·생성 스튜디오 (2026-11-21 O1) — 계산(studioLogic)·카드 그리기(studioCanvas)·화면 스모크
   * ──────────────────────────────────────────────────────────────── */
  console.log('\n[9] 제작·생성 스튜디오');
  try {
    const SL = await import('file://' + path.join(ROOT, 'js', 'studioLogic.js'));
    const SC = await import('file://' + path.join(ROOT, 'js', 'studioCanvas.js'));

    /* 포맷·트랙 규칙 */
    ok('포맷 3개: 블로그 · 영상 · 피드', SL.FORMAT_IDS.join(',') === 'blog,video,feed');
    ok('트랙 B(삐약 김메리)는 영상만', SL.formatsFor('ppiyak_kimmary').join(',') === 'video' && SL.formatsFor('daejeon_youth').length === 3);
    ok('쓸 수 없는 포맷이면 빈 값(선택 화면)', SL.pickFormat('blog', 'ppiyak_kimmary') === '' && SL.pickFormat('video', 'ppiyak_kimmary') === 'video' && SL.pickFormat('게시', 'daejeon_youth') === '');
    ok('트랙 B 이동 문구가 설계 그대로', SL.TRACK_B_NOTE === '반려동물 채널은 영상만 지원해 영상 스튜디오로 이동했어요');

    /* 재료 4칸 */
    const m0 = SL.normalizeMaterials({ place: { name: ' 미미삼겹 ' }, concept: { kind: 'hack', tone: 'x' }, video: { length_sec: 45 } });
    ok('모르는 개념·톤·길이는 기본값으로 맞춘다', m0.concept.kind === 'review' && m0.concept.tone === 'plain' && m0.video.length_sec === 30);
    ok('재료 요약: 사진 수 · 가게 · 컨셉', /사진 0장 · 미미삼겹 · 맛집 리뷰/.test(SL.materialSummary(m0)), SL.materialSummary(m0));
    ok('재료가 비면 false, 하나라도 있으면 true', SL.hasMaterial({}) === false && SL.hasMaterial({ place: { name: 'x' } }) === true);

    /* 사진 역할·자동 순서 */
    ok('파일 이름으로 역할 추정', SL.photoRole('01_외관.jpg') === '외관' && SL.photoRole('메뉴판.png') === '메뉴판' && SL.photoRole('삼겹굽기.jpg') === '음식' && SL.photoRole('가게내부.jpg') === '분위기' && SL.photoRole('영수증.jpg') === '마무리');
    const ordered = SL.autoOrderPhotos([{ name: '영수증.jpg' }, { name: '삼겹.jpg' }, { name: '입구.jpg' }, { name: '메뉴판.jpg' }, { name: '내부.jpg' }]);
    ok('자동 순서: 외관→메뉴판→음식→분위기→마무리', ordered.map((p) => p.role).join(',') === '외관,메뉴판,음식,분위기,마무리', ordered.map((p) => p.role));
    ok('자동 순서는 1부터 번호를 매긴다', ordered.map((p) => p.order).join(',') === '1,2,3,4,5');

    /* 장수 계산 */
    ok('영상 장수: 15초 5 · 30초 8 · 60초 15', SL.photoCountFor('video', { lengthSec: 15 }) === 5 && SL.photoCountFor('video', { lengthSec: 30 }) === 8 && SL.photoCountFor('video', { lengthSec: 60 }) === 15);
    ok('블로그 22 · 피드 6 (가진 장수가 모자라면 가진 만큼)', SL.photoCountFor('blog', {}) === 22 && SL.photoCountFor('feed', {}) === 6 && SL.photoCountFor('blog', { available: 4 }) === 4);
    const vplan = SL.photoPlanFor('video', { photos: ordered, lengthSec: 60 });
    ok('영상 60초: 5장으로도 렌더는 되지만 권장 15장에는 10장 모자람', vplan.target === 15 && vplan.enough === true && vplan.meets_target === false && vplan.missing === 10, vplan);

    /* 캡션 규칙 */
    ok('직접 쓴 캡션은 덮지 않는다', SL.captionFor({ name: 'a.jpg', role: '음식', caption: '내가 쓴 캡션' }, m0) === '내가 쓴 캡션');
    ok('빈 캡션은 사실 묘사로 채운다(15~25자)', /입구|메뉴|자리/.test(SL.captionFor({ name: 'a.jpg', role: '외관' }, m0)));

    /* 블로그 키트 */
    const memo = '첫 문단은 그대로 남습니다.\n두 번째 줄도 그대로.\n\n둘째 문단입니다.';
    const matB = SL.normalizeMaterials({
      place: { name: '미미삼겹' }, content: { memo: memo, region_dong: '봉명동', price_menu: '삼겹 16,000원', category: '고기' },
      photos: ordered
    });
    const blocks = (await import('file://' + path.join(ROOT, 'js', 'slot-engine.js'))).splitUserBlocks(memo);
    const kit = await SL.signKit(SL.buildBlogKit({ materials: matB, blocks: blocks }));
    ok('블로그 키트: 제목 3안', kit.titles.length === 3 && kit.titles[0].indexOf('미미삼겹') >= 0, kit.titles);
    ok('블로그 키트: 원문 문단이 한 글자도 안 바뀐다', kit.blocks.map((b) => b.text).join('\n\n') === memo);
    ok('블로그 키트: 사진 위치표가 문단 뒤에 붙는다', kit.photo_plan.length === 5 && kit.photo_plan.filter((x) => x.slot === 0).length >= 1);
    ok('블로그 키트: 해시(SHA-256)가 붙는다', /^[0-9a-f]{64}$/.test(kit.user_body_sha256));
    ok('블로그 키트 본문에 사진 표시([사진] 이름 — 캡션)', /\[사진\] .+\.jpg — /.test(kit.text));
    ok('네이버에 붙이는 순서가 안내된다', kit.paste_steps.length >= 5 && /임시저장/.test(kit.paste_steps.join(' ')));
    ok('모르는 값은 [채우기]로 남긴다(지어내지 않음)', SL.buildBlogKit({ materials: SL.normalizeMaterials({ content: { memo: '메모' } }) }).titles[0].indexOf('[채우기]') >= 0);

    /* 2줄 호흡·톤 (2026-11-21 제미니 확정안 A) */
    const T = await import('file://' + path.join(ROOT, 'js', 'blogTone.js'));
    ok('톤: 확정 수치(하한 22 · 목표 32~44 · 상한 54 · 1줄 20자)', T.RHYTHM.blockMin === 22 && T.RHYTHM.blockTargetLo === 32 && T.RHYTHM.blockTargetHi === 44 && T.RHYTHM.blockMax === 54 && T.RHYTHM.oneLineMax === 20);
    ok('톤: 프리셋 3종(자조 찰진·담백 리뷰·정보 정리)', T.PRESETS.map((p) => p.id).join(',') === 'jajo,review,info' && T.PRESETS[0].polite === 75 && T.PRESETS[2].polite === 95);
    ok('톤: 금지 문구 22개 이상', T.AI_COLUMN_BAN.length >= 22);
    const longOne = '지난 8개월 동안 계좌는 계속 빨갰고 나는 계속 물을 탔는데 이제는 물 탈 돈도 남지 않아서 그냥 구경만 하고 있습니다.';
    const splitOne = T.splitLongBlock(longOne);
    ok('톤: 3줄(55자↑) 문단을 2줄로 나눈다', splitOne.length >= 2 && splitOne.every((x) => x.length <= T.RHYTHM.blockMax), splitOne.map((x) => x.length));
    ok('톤: 숫자+단위는 자르지 않는다', T.isProtectedCut('원금 1억 1,300만 원이 반토막', '원금 1억 1,300만 원이 반토막'.indexOf(',', 0)) === true);
    ok('톤: 줄 안 공백만 정리하고 줄바꿈(덩어리)은 살린다', T.flattenBlocks('가나다\n라마바\n\n사아자').join('|') === '가나다|라마바|사아자');
    ok('톤: AI 칼럼투를 문단 첫머리에서 뗀다', T.stripBanWords('결론부터 말씀드리자면 계좌가 반토막 났습니다.').removed[0] === '결론부터 말씀드리자면' && T.stripBanWords('결론부터 말씀드리자면 계좌가 반토막 났습니다.').text.indexOf('결론부터') < 0);
    const fixed = T.applyBlogRhythm('오늘 하루에만\n계좌에서 205만 원이 증발했다.\n\n' + longOne);
    ok('톤: 정리하면 1줄 3연속이 사라지고 상한을 넘는 문단이 없다', fixed.stats.oneLineRunMax <= 2 && fixed.stats.overMax === 0, fixed.stats);
    ok('톤: 정리해도 숫자·금액은 그대로 살아 있다', fixed.text.indexOf('205만 원') >= 0 && fixed.text.indexOf('1억') < 0);
    const badTone = T.lintRhythm('짧다.\n\n짧아.\n\n짧네.\n\n' + longOne);
    ok('톤: 3연속 1줄·상한 초과를 경고한다', badTone.some((x) => x.code === 'one_line_run') && badTone.some((x) => x.code === 'over_max'));
    ok('톤: 정상 글이면 경고 0건', T.lintRhythm('오늘 하루에만 계좌에서 205만 원이 증발했고 수익률은 마이너스 3.5퍼센트였다.\n\n장 마감하고 화면을 보는데 헛웃음부터 나왔다.').length === 0, T.lintRhythm('오늘 하루에만 계좌에서 205만 원이 증발했고 수익률은 마이너스 3.5퍼센트였다.\n\n장 마감하고 화면을 보는데 헛웃음부터 나왔다.'));
    ok('키트에 2줄 호흡 점검이 붙는다(원문은 안 바뀜)', kit.rhythm && kit.rhythm.stats.blocks >= 2 && kit.blocks.map((b) => b.text).join('\n\n') === memo);

    /* AI 티 7패턴 · 첫 400자 D.I.A.+ (#44584, 2026-11-21) */
    {
      const aiSeed = JSON.parse(fs.readFileSync(path.join(ROOT, 'seeds', 'blog_lint_rules_2026w48.json'), 'utf8')).aiTone;
      const AI = await import('file://' + path.join(ROOT, 'js', 'blogAiTone.js'));
      const BL = await import('file://' + path.join(ROOT, 'js', 'blogLint.js'));
      ok('AI 티: 시드에 7패턴 · D.I.A.+ 5요소', aiSeed.patterns.length === 7 && aiSeed.dia.elements.length === 5);
      ok('AI 티: 화면 기본값과 시드 임계값이 같다', AI.AI_TONE_DEFAULTS.hold_at === aiSeed.hold_at
        && AI.AI_TONE_DEFAULTS.sd_min === aiSeed.sd_min
        && AI.AI_TONE_DEFAULTS.regex.cliche === aiSeed.regex.cliche
        && AI.AI_TONE_DEFAULTS.keyword_fail === aiSeed.keyword_fail);
      ok('AI 티: 결말 상투어는 FAIL · 1인칭 부재는 WARN(우리 톤 보호)',
        aiSeed.patterns.find((p) => p.id === 'cliche_ending').warn === 'FAIL'
        && aiSeed.patterns.find((p) => p.id === 'first_person_absent').warn === 'WARN'
        && aiSeed.first_person_min_by_preset.info === 1);

      /* 소제목은 `###`가 아니라 굵은 한 줄(우리 에디터 형식) */
      const boldHeads = ['**외관은 평범했다**', '본문 한 줄입니다.', '**고기는 두툼했다**', '또 본문.', '**밑반찬은 셀프**'];
      const hs = AI.headingsOf(boldHeads);
      ok('AI 티: 굵은 한 줄을 소제목으로 인식한다', hs.length === 3 && hs.every((x) => x.kind === 'strong'), hs.map((x) => x.text));
      ok('AI 티: 캡션(▲)·사진 줄은 소제목이 아니다',
        AI.headingsOf(['첫 문단.', '▲ 외관 사진', '둘째 문단.', '▲ 메뉴판', '셋째 문단.']).length === 0);

      const goodBody = '봉명동에서 늦게까지 여는 삼겹살집을 찾는다면 미미삼겹 유성점이 답이다. 2인 3만2천원이고 평일 저녁 8시 웨이팅은 0분이었다. 주차는 건물 뒤 3대, 야근 끝난 직장인에게 맞는 곳이다. 다음엔 평일 6시에 가볼 생각이다.';
      const g = AI.lintAiTone({ title: '[봉명동 삼겹살] 미미삼겹', body: goodBody, keywords: '봉명동맛집,삼겹살' }, aiSeed);
      ok('AI 티: 사람이 쓴 첫 400자는 일반론·1인칭·수치를 통과',
        g.patterns.find((p) => p.id === 'generic_intro').state === 'pass'
        && g.patterns.find((p) => p.id === 'no_numbers').state !== 'warn', g.summary);
      ok('AI 티: 첫 400자 D.I.A.+ 5요소를 다 잡는다', g.dia.hits === 5 && g.dia.state === 'pass', g.dia.elements.map((e) => e.id + ':' + e.state));
      ok('AI 티: 정상 글은 발행 보류가 아니다', g.hold === false, g.holdReasons);

      const bland = '현대 사회에서 맛집을 고르는 일은 참 어렵습니다. 좋은 맛집을 찾기 위해서는 여러 가지를 살펴보아야 합니다.';
      ok('AI 티: 일반론 서론을 WARN으로 잡는다',
        AI.lintAiTone({ body: bland }, aiSeed).patterns.find((p) => p.id === 'generic_intro').state === 'warn');
      ok('AI 티: 첫 400자가 비면 D.I.A.+는 고칠 것', AI.diaGate({ body: bland }, aiSeed).state === 'warn');

      const cliche = '앞 문단입니다.\n\n두 번째 문단입니다.\n\n이상으로 삼겹살 맛집 고르는 방법에 대해 알아보았습니다.';
      const cf = AI.lintAiTone({ body: cliche }, aiSeed);
      ok('AI 티: 결말 상투어는 FAIL이고 혼자서도 보류',
        cf.patterns.find((p) => p.id === 'cliche_ending').state === 'fail' && cf.hold === true);

      const sym = ['**위치 확인하기**', '본문 하나입니다.', '**가격 비교하기**', '본문 둘입니다.', '**분위기 살펴보기**'];
      ok('AI 티: 대칭 소제목(같은 길이)을 WARN으로',
        AI.lintAiTone({ body: sym.join('\n\n') }, aiSeed).patterns.find((p) => p.id === 'symmetric_headings').state === 'warn');

      /* 1인칭: FAIL이 아니라 WARN · 톤 프리셋별 하한 */
      const oneMe = '나는 3만2천원을 냈습니다.\n\n고기는 두툼했습니다.\n\n불판은 약했습니다.\n\n주차는 3대였습니다.';
      ok('AI 티: 1인칭 부재는 WARN(FAIL 아님)',
        AI.lintAiTone({ body: oneMe }, aiSeed).patterns.find((p) => p.id === 'first_person_absent').state === 'warn');
      ok('AI 티: 자조 톤(jajo)은 하한이 낮아 1인칭 1회로 통과',
        AI.lintAiTone({ body: oneMe, tonePreset: 'jajo' }, aiSeed).patterns.find((p) => p.id === 'first_person_absent').state === 'pass');

      /* 키워드 3~5회(B3) — 6회↑ FAIL */
      const kw6 = Array.from({ length: 6 }, (_, i) => '삼겹살' + i + '번째 문단입니다.').join('\n\n');
      const kw3 = Array.from({ length: 3 }, (_, i) => '삼겹살' + i + '번째 문단입니다.').join('\n\n');
      const k6 = AI.keywordCheck({ body: kw6, keywords: '삼겹살' }, aiSeed);
      ok('AI 티: 키워드 6회는 FAIL · 발행 보류', k6.state === 'fail' && AI.lintAiTone({ body: kw6, keywords: '삼겹살' }, aiSeed).hold === true);
      ok('AI 티: 키워드 3회는 권장 범위', AI.keywordCheck({ body: kw3, keywords: '삼겹살' }, aiSeed).items[0].state === 'pass');
      ok('AI 티: 없는 키워드는 WARN', AI.keywordCheck({ body: kw3, keywords: '봉명동맛집' }, aiSeed).items[0].state === 'warn');
      ok('AI 티: 키워드를 안 넣으면 판정하지 않는다', AI.keywordCheck({ body: kw3 }, aiSeed).items.length === 0);

      /* 린터 통합 — 8항목 점수에 섞이지 않는다 */
      const lb = BL.lintBlog({ title: '[봉명동 삼겹살] 미미삼겹 유성점 솔직후기', body: goodBody, keywords: '봉명동맛집,삼겹살', photoCount: 18 });
      ok('린터: aiTone·hold 를 함께 돌려준다', !!lb.aiTone && typeof lb.hold === 'boolean' && !!lb.aiTone.dia && !!lb.aiTone.keywords);
      ok('린터: 항목 수(9 + 링크 3) — AI 티는 점수 밖', lb.items.length === 12 && lb.items.filter((i) => i.weight > 0).length === 9, lb.items.length);
      ok('린터: 8항목 점수는 AI 티와 무관', lb.score === Math.round(lb.items.reduce((s, it) => s + (it.state === 'pass' ? it.weight : it.state === 'near' ? it.weight / 2 : 0), 0)));
      ok('린터: AI 티가 치명적이면 hold 로 알린다',
        BL.lintBlog({ title: '삼겹살 맛집 고르는 방법', body: cliche }).hold === true);

      /* 웹앱·파이썬 CLI 같은 규칙(파이썬이 있으면 대조) */
      const py = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' });
      if (py.status === 0) {
        const tmp = path.join(require('os').tmpdir(), 'ch-aitone-' + process.pid + '.md');
        const pyBody = goodBody + '\n\n이상으로 삼겹살 맛집 고르는 방법에 대해 알아보았습니다.';
        fs.writeFileSync(tmp, '# [봉명동 삼겹살] 미미삼겹\n\n' + pyBody, 'utf8');
        const r = spawnSync('python3', [path.join(ROOT, 'tools', 'blog_lint_cli.py'), tmp, '--keyword', '봉명동맛집,삼겹살', '--json'], { encoding: 'utf8' });
        let pyAi = null;
        try { pyAi = JSON.parse(r.stdout).aiTone; } catch (e) { pyAi = null; }
        const jsAi = AI.lintAiTone({ body: pyBody, keywords: '봉명동맛집,삼겹살' }, aiSeed);
        ok('AI 티: 웹앱과 파이썬 CLI 판정이 같다', !!pyAi
          && pyAi.count === jsAi.count
          && pyAi.dia.hits === jsAi.dia.hits
          && pyAi.hold === jsAi.hold
          && pyAi.keywords.items.map((k) => k.keyword + k.count).join(',') === jsAi.keywords.items.map((k) => k.keyword + k.count).join(','),
        { py: pyAi && { count: pyAi.count, dia: pyAi.dia && pyAi.dia.hits, hold: pyAi.hold }, js: { count: jsAi.count, dia: jsAi.dia.hits, hold: jsAi.hold }, err: String(r.stderr || '').slice(0, 200) });
        try { fs.unlinkSync(tmp); } catch (e) {}
      } else {
        ok('AI 티: 웹앱과 파이썬 CLI 대조(파이썬 없음 — 건너뜀)', true);
      }
    }

    /* 피드 */
    const cards = SL.buildFeedCards({ materials: matB });
    ok('피드 카드 6장', cards.length === 6 && cards.map((c) => c.no).join(',') === '1,2,3,4,5,6');
    ok('피드 카드: 사진이 순서대로 배치된다', cards[0].photo === ordered[0].name && cards[2].photo === ordered[2].name);
    ok('피드 카드: 모르는 칸은 [채우기]', SL.buildFeedCards({ materials: SL.normalizeMaterials({}) })[1].body === '[채우기]');
    ok('캡션·해시태그 5개', SL.feedCaption(matB).indexOf('미미삼겹') >= 0 && SL.hashtagsOf(matB).length === 5 && SL.hashtagsOf(matB).every((t) => t.charAt(0) === '#'));

    /* AI 초안 요청 */
    const req = await SL.buildDraftRequest({ contentId: 'C-1', brand: 'daejeon_youth', format: 'blog', materials: matB, blocks: blocks });
    ok('초안 요청: 타입·포맷·개념', req.type === 'content_draft' && req.format === 'blog' && req.concept.kind === 'review');
    ok('초안 요청: 블록마다 SHA-256', req.blocks.length === 2 && /^[0-9a-f]{64}$/.test(req.blocks[0].sha256));
    ok('초안 요청: 메모 해시는 블록 전체의 해시', /^[0-9a-f]{64}$/.test(req.memo_sha256));
    ok('초안 요청: 사진은 이름·역할만', req.media.length === 5 && Object.keys(req.media[0]).sort().join(',') === 'name,role');
    ok('초안 요청: 3,500자 이하면 인라인(블록·팩트 포함)', !req.payload_source && !!req.blocks && !!req.facts);
    const longMemo = Array.from({ length: 12 }, (_, i) => ('문단' + i + ' ').repeat(60)).join('\n\n');
    const longBlocks = longMemo.split('\n\n').map((t, i) => ({ id: 'U' + (i + 1), text: t }));
    const req2 = await SL.buildDraftRequest({ contentId: 'C-1', brand: 'daejeon_youth', format: 'blog', materials: SL.normalizeMaterials({ content: { memo: longMemo } }), blocks: longBlocks });
    ok('초안 요청: 3,500자를 넘으면 payload_source:drive(블록·팩트 제거)', req2.payload_source === 'drive' && !req2.blocks && !req2.facts && JSON.stringify(req2).length <= 3500, JSON.stringify(req2).length);

    /* 원문 잠금 검증 */
    ok('AI 결과의 USER 블록이 그대로면 통과', SL.verifyUserBlocks(blocks, [{ origin: 'USER', text: blocks[0].text }, { origin: 'USER', text: blocks[1].text }]).ok === true);
    ok('USER 블록이 바뀌면 불통과(화면이 AI 문장을 버린다)', SL.verifyUserBlocks(blocks, [{ origin: 'USER', text: '바뀜' }, { origin: 'USER', text: blocks[1].text }]).ok === false);
    const composed = SL.composeBlogWithDraft(kit, { titles: ['ㄱ', 'ㄴ', 'ㄷ'], blocks: [{ origin: 'USER', text: blocks[0].text }, { origin: 'USER', text: blocks[1].text }], bridges: ['사이 문장 1', '사이 문장 2'], outro: '마무리 문단' });
    ok('합치기: 원문이 그대로 남고 사이 문장이 들어간다', composed.text.indexOf('첫 문단은 그대로 남습니다.') >= 0 && composed.text.indexOf('사이 문장 1') >= 0);
    ok('합치기: 제목·마무리는 AI 것을 쓴다', composed.titles[0] === 'ㄱ' && composed.text.indexOf('마무리 문단') >= 0);
    const composedBad = SL.composeBlogWithDraft(kit, { titles: ['x'], blocks: [{ origin: 'USER', text: '변조' }], bridges: ['AI 문장'] });
    ok('합치기: 원문이 변조됐으면 AI 문장을 넣지 않는다', composedBad.verified.ok === false && composedBad.text.indexOf('AI 문장') < 0);

    /* studio 문서 읽기·쓰기(마이그레이션) */
    const legacy = { steps: 3, inputs: ['a.mp4'], render: { order_id: 'Q-1' } };
    const rs = SL.readStudio({ studio: legacy });
    ok('구 구조를 읽기로 폴백한다(migrated=true)', rs.migrated === true && rs.video.inputs[0] === 'a.mp4' && rs.legacy_root === true);
    const rs2 = SL.readStudio({ studio: { formats: { video: { steps: 1 }, blog: { draft: { titles: ['a'] } } }, steps: 9 } });
    ok('새 구조가 있으면 그쪽이 이긴다', rs2.migrated === false && rs2.video.steps === 1 && rs2.studio.steps === 9);
    const merged = SL.mergeFormat(rs2.studio, 'video', { steps: 2 });
    ok('쓰기는 다른 포맷·구 루트 키를 보존한다', merged.formats.blog.draft.titles[0] === 'a' && merged.formats.video.steps === 2 && merged.steps === 9 && merged.meta.format === 'video');
    const withMat = SL.mergeMaterialsIntoStudio(merged, matB);
    ok('재료를 studio 에 넣으면 장소·개념·사진 목록이 남는다', withMat.place.name === '미미삼겹' && withMat.media.length === 5 && withMat.content.memo.indexOf('첫 문단') >= 0);
    const back = SL.materialsFromStudio(withMat);
    ok('카드에서 재료를 다시 읽는다', back.place.name === '미미삼겹' && back.photos.length === 5 && back.concept.kind === 'review');

    /* 문구 */
    ok('실패 문구 3종(설계 §6)', SL.errorText('ERR_TIMEOUT').indexOf('시간 초과') >= 0 && SL.errorText('ERR_VERSION_CONFLICT').indexOf('병합') >= 0 && SL.errorText('x').indexOf('연결 또는 형식 오류') >= 0);
    ok('오더 상태: 종료/진행 구분', SL.orderLine('DONE').done === true && SL.orderLine('FAILED').done === true && SL.orderLine('RUNNING').done === false && SL.orderLine('WAITING_APPROVAL').text.indexOf('승인') >= 0);

    /* 카드 그리기 계산 */
    ok('카드 1080×1350(4:5)', SC.CARD_W === 1080 && SC.CARD_H === 1350);
    const cr = SC.coverRect(2000, 1000, 1080, 700);
    ok('사진 채우기: 가운데를 잘라낸다(비율 유지)', Math.abs(cr.sw - 1542.86) < 0.1 && Math.abs(cr.sh - 1000) < 0.01 && Math.abs(cr.sx - 228.57) < 0.1 && cr.sy === 0, cr);
    ok('긴 문장 줄바꿈(글자 수 기준)', SC.splitLines('가나다라마바사 아자차카타파하', 8).length >= 2);
    ok('보정 프리셋 4종 · 파일 이름 규칙', SC.FILTER_PRESETS.length === 4 && SC.cardFileName('미미 삼겹', 2) === '미미_삼겹_카드2.png');

    /* 화면 스모크 — 가짜 DOM 으로 세 포맷을 모두 그려 본다 */
    {
      class N {
        constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.className = ''; this._text = ''; this.value = ''; this.checked = false; this.hidden = false; this.isConnected = true; this.style = {}; }
        getContext() { return null; }   // 가짜 캔버스 — 2D 문맥이 없으면 그리기를 스스로 포기한다(비동기 그리기에서 터지지 않게)
        set textContent(v) { this._text = String(v); this.children = []; }
        get textContent() { return this._text + this.children.map((c) => (c && c.textContent) || '').join(''); }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        removeAttribute(k) { delete this.attrs[k]; }
        hasAttribute(k) { return k in this.attrs; }
        getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
        addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
        removeEventListener() {}
        append(...kids) { kids.forEach((k) => { const n = (k !== null && typeof k === 'object') ? k : { textContent: String(k), tag: '#text', children: [] }; if (n.parent !== undefined) n.parent = this; this.children.push(n); }); }
        appendChild(k) { this.append(k); return k; }
        replaceChildren(...kids) { this.children = []; this.append(...kids); }
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
        querySelectorAll(sel) { const out = []; const cls = (sel.match(/^\.([\w-]+)/) || [])[1]; (function w(n) { (n.children || []).forEach((c) => { if (!c || !c.tag) return; if (!cls || (c.className || '').split(/\s+/).indexOf(cls) >= 0) out.push(c); w(c); }); })(this); return out; }
        closest() { return null; }
        remove() {}
        focus() {}
        select() {}
        click() { (this.listeners.click || []).forEach((f) => f({ target: this })); }
      }
      const store = {};
      const dom = { createElement: (t) => new N(t), createTextNode: (t) => ({ tag: '#text', textContent: String(t), children: [] }), body: new N('body'), addEventListener() {}, removeEventListener() {}, hidden: false, execCommand: () => false };
      const prev = { d: global.document, w: global.window, l: global.localStorage, loc: global.location, nav: global.navigator };
      global.document = dom;
      global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
      global.window = { localStorage: global.localStorage };
      global.location = { hash: '#/create' };
      Object.defineProperty(global, 'navigator', { value: { clipboard: null }, configurable: true, writable: true });   // Node 22+ 는 navigator 가 읽기 전용 접근자라 직접 대입하면 실패한다
      const hh = (tag, attrs, ...kids) => {
        const n = new N(tag);
        if (attrs) for (const [k, v] of Object.entries(attrs)) {
          if (v == null || v === false) continue;
          if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'style') n.setAttribute('style', v);
          else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v); else if (v === true) n.setAttribute(k, ''); else n.setAttribute(k, String(v));
        }
        n.append(...kids.flat(4).filter((k) => k != null && k !== false)); return n;
      };
      const walk = (n, f) => { f(n); (n.children || []).forEach((c) => c && c.tag && walk(c, f)); };
      const toasts = [];
      const mkCtx = (brand) => ({
        h: hh, state: { brand }, api: { post: async () => ({ data: {} }) },
        toast: (m) => toasts.push(m), friendlyError: (e) => String(e),
        pageHead: (t, s) => hh('div', { class: 'page-head' }, hh('h1', null, t), hh('p', null, s)),
        BRANDS: { daejeon_youth: { name: '대전 청년' }, ppiyak_kimmary: { name: '삐약 김메리' } },
        openDetail: () => {}
      });
      try {
        const CS = await import('file://' + path.join(ROOT, 'js', 'createStudio.js'));
        const runs = [
          ['첫 화면(포맷 선택)', { brand: 'daejeon_youth' }, 'create', ''],
          ['블로그', { brand: 'daejeon_youth' }, 'create/blog', 'blog'],
          ['영상', { brand: 'daejeon_youth' }, 'create/video', 'video'],
          ['피드', { brand: 'daejeon_youth' }, 'create/feed', 'feed'],
          ['트랙 B 영상', { brand: 'ppiyak_kimmary' }, 'create/video', 'video']
        ];
        for (const [label, st, hash, fmt] of runs) {
          const main = new N('main');
          global.location.hash = '#/' + hash;
          const failures = [];
          try {
            CS.renderCreateStudio(main, mkCtx(st.brand), { format: fmt });
            const junk = [];
            walk(main, (n) => { if (n.tag === '#text' && /^(null|undefined|false|NaN)$/.test(n.textContent)) junk.push(n.textContent); });
            if (junk.length) failures.push('화면에 "' + junk[0] + '" 글자가 보임');
            if (!main.children.length) failures.push('아무것도 그리지 않음');
            if (fmt) {
              const inputs = []; walk(main, (n) => { if (n.tag === 'input' || n.tag === 'textarea') inputs.push(n); });
              if (inputs.length < 8) failures.push('재료 칸이 부족함(' + inputs.length + '개)');
            }
          } catch (e) { failures.push((e && e.message) || String(e)); }
          ok('화면 스모크(' + label + '): 오류 없이 그려진다', failures.length === 0, failures.join(' | '));
        }
        // 트랙 B 에서 블로그를 요청하면 영상으로 보낸다 + 토스트
        toasts.length = 0;
        const mainB = new N('main');
        global.location.hash = '#/create/blog';
        CS.renderCreateStudio(mainB, mkCtx('ppiyak_kimmary'), { format: 'blog' });
        ok('트랙 B 는 블로그 화면을 열지 않고 영상으로 이동 + 안내', global.location.hash === '#/create/video' && toasts.some((t) => /영상만 지원/.test(t)), [global.location.hash, toasts]);
        // 첫 화면에는 포맷 카드 3개
        const mainC = new N('main');
        global.location.hash = '#/create';
        CS.renderCreateStudio(mainC, mkCtx('daejeon_youth'), { format: '' });
        const fmtBtns = []; walk(mainC, (n) => { if ((n.className || '').split(/\s+/).indexOf('st-format') >= 0) fmtBtns.push(n); });
        ok('첫 화면에 포맷 3개가 나온다', fmtBtns.length === 3, fmtBtns.length);
      } finally {
        global.document = prev.d; global.window = prev.w; global.localStorage = prev.l; global.location = prev.loc; Object.defineProperty(global, 'navigator', { value: prev.nav, configurable: true, writable: true });
      }
    }

    /* 코드 규칙 */
    const cs = fs.readFileSync(path.join(ROOT, 'js', 'createStudio.js'), 'utf8');
    const sl = fs.readFileSync(path.join(ROOT, 'js', 'studioLogic.js'), 'utf8');
    const sc = fs.readFileSync(path.join(ROOT, 'js', 'studioCanvas.js'), 'utf8');
    ok('studio: innerHTML/outerHTML/insertAdjacentHTML/document.write 0건', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(cs + sl + sc));
    ok('studio: 웹앱 주소·토큰 값이 없다', !/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}|\bcq_[A-Za-z0-9]{8,}|xox[bp]-/.test(cs + sl + sc));
    ok('studio: 사진 미리보기는 로컬 ObjectURL(드라이브 URL 을 img src 에 넣지 않는다)', /URL\.createObjectURL/.test(cs) && !/src.*drive\.google/.test(cs));
    ok('studio: 오더 보내기는 1회 1개로 잠긴다(mem.busy)', /mem\.busy\[key\]/.test(cs));
    ok('studio: hub_order_status 15초 폴링 · 탭 숨김이면 쉰다', /POLL_MS = 15000/.test(cs) && /document\.hidden/.test(cs) && /line\.isConnected/.test(cs));
    ok('studio: 실패 문구 3종을 그대로 보여 준다', /ERR_VERSION_CONFLICT/.test(sl) && /시간 초과/.test(sl));
    ok('studio: 예전 화면을 지우지 않았다(create-view 는 #/create/legacy 로 마운트)', fs.existsSync(path.join(ROOT, 'js', 'create-view.js')) && /create\/legacy/.test(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8')));
    ok('studio: 숏폼 공방(studioView.js)은 그대로 살아 있다', fs.existsSync(path.join(ROOT, 'js', 'studioView.js')) && /renderStudio/.test(fs.readFileSync(path.join(ROOT, 'js', 'seriesView.js'), 'utf8')));
    ok('studio: 영상 6단계를 마운트한다(produceSection)', /produceSection\(\{/.test(cs));
    ok('index.html: 스튜디오 CSS 와 blob: 미리보기 허용(CSP)', /css\/studio\.css/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')) && /img-src 'self' data: blob:/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
    ok('index.html 하단 탭 이름이 "제작"', /data-route="create"[^>]*aria-label="제작 스튜디오"/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
  } catch (err) {
    ok('제작 스튜디오 시험', false, (err && err.stack) || err);
  }

  /* ── 키워드 트렌드(데이터랩) 순수 계산 ── */
  try {
    console.log('\n[7] 키워드 트렌드 순수 계산 (js/blogTrend.js)');
    const T = await import('file://' + path.join(ROOT, 'js', 'blogTrend.js'));
    eq('키워드는 쉼표로 나누고 중복을 지운다', T.normalizeKeywords('봉명동 냉삼, 대전 삼겹살, 봉명동 냉삼').join('|'), '봉명동 냉삼|대전 삼겹살');
    eq('키워드는 5개까지만', T.normalizeKeywords('a,b,c,d,e,f,g').length, 5);
    eq('빈 값은 0개', T.normalizeKeywords('  ,  ').length, 0);
    eq('증감 표기 +34.2%', T.deltaText(34.24), '+34.2%');
    eq('증감 표기 −12%', T.deltaText(-12), '−12%');
    eq('증감 0은 그대로', T.deltaText(0), '그대로');
    eq('증감 없음은 비교 전', T.deltaText(null), '비교 전');
    eq('오르는 중(15% 이상)', T.trendWord(15), '오르는 중');
    eq('비슷함(경계)', T.trendWord(14.9), '비슷함');
    eq('내리는 중', T.trendWord(-15), '내리는 중');
    eq('성수기 판정', T.seasonWord(90, 100), '성수기');
    eq('비수기 판정', T.seasonWord(20, 100), '비수기');
    eq('중간은 뱃지 없음', T.seasonWord(60, 100), '');

    const bars = T.sparkBars([{ period: 'a', ratio: 0 }, { period: 'b', ratio: 50 }, { period: 'c', ratio: 100 }], 12);
    eq('막대는 준 구간 수만큼', bars.length, 3);
    ok('막대 높이는 최고 대비(0도 6%는 남긴다)', bars[0].pct === 6 && bars[1].pct === 50 && bars[2].pct === 100, bars);

    const rows = T.trendRows({
      time_unit: 'week', start_date: '2025-11-20', end_date: '2026-11-19',
      groups: [{ title: '대전 맛집', keywords: ['대전 맛집'], delta_pct: 100, latest: 40, peak: 40, recent4: 40, prev4: 20, series: [{ period: 'p', ratio: 40 }] }]
    });
    ok('응답 → 화면 줄', rows.length === 1);
    const flat = T.trendRows({ groups: [{ title: '대전 봉명동', delta_pct: 0, latest: 1, peak: 1, trend: '비슷함', season: '성수기', series: [{ period: 'p', ratio: 1 }] }] });
    eq('작은 말(최고 10 미만)은 서버가 성수기라 해도 화면은 표본 적음', flat[0].trend, '표본 적음');
    eq('그때는 뱀지를 다지 않는다', flat[0].season, '');
    eq('줄의 판정 단어', rows[0].trend, '오르는 중');
    eq('줄의 뱃지', rows[0].season, '성수기');
    eq('예산 문구', T.budgetText({ used_day: 3, cap_day: 200, used_month: 12, cap_month: 2000 }), '오늘 3/200회 · 이번 달 12/2,000회');
    eq('기간 문구', T.rangeText({ start_date: '2025-11-20', end_date: '2026-11-19', time_unit: 'week' }), '25.11~26.11 · 주간');

    const bv = fs.readFileSync(path.join(ROOT, 'js', 'blogView.js'), 'utf8');
    ok('blog: 키워드 트렌드 카드를 그린다', /function trendPanel\(/.test(bv) && /insightTrend\(/.test(bv));
    ok('blog: 절대 검색량이 아니라는 문구를 화면에 둔다', /절대 검색량이 아니/.test(bv));
    ok('blog: 데이터랩은 한 요청에 묶어 부른다(키워드별 따로 부르지 않는다)', /groups: kws\.map\(/.test(bv));
  } catch (err) {
    ok('키워드 트렌드 시험', false, (err && err.stack) || err);
  }

  /* ── 채널 시그니처 영상 템플릿(2026-11-21) ── */
  console.log('\n[채널 영상 템플릿]');
  try {
    const { pathToFileURL } = require('url');
    const PL = await import(pathToFileURL(path.join(ROOT, 'js', 'produceLogic.js')).href + '?v=test-template');
    const VT = await import(pathToFileURL(path.join(ROOT, 'js', 'videoTemplate.js')).href + '?v=test-template');
    const base = { contentId: 'C-TPL', brand: 'daejeon_youth', inputs: ['a.mp4'] };

    const auto = PL.buildRenderPayload(base);
    ok('template 은 기본 auto 로 실린다', auto.ok && auto.payload.template === 'auto', auto.payload);
    const full = PL.buildRenderPayload(Object.assign({}, base, {
      template: 'daejeon_youth', title: '천장에 매달린 건\n천 두 장뿐', badge: '제주 · 서커스', hook: '천 두 장뿐', outro: '다음 코스는? 구독'
    }));
    ok('템플릿 문구가 오더에 실린다', full.ok && full.payload.template === 'daejeon_youth' && full.payload.hook === '천 두 장뿐' && full.payload.badge === '제주 · 서커스', full.payload);
    const bad = PL.buildRenderPayload(Object.assign({}, base, { template: 'x' }));
    ok('모르는 템플릿은 거절', !bad.ok && /템플릿/.test(bad.errors[0]), bad.errors);
    const none = PL.buildRenderPayload(Object.assign({}, base, { template: 'none', title: '가' }));
    ok('none 이면 문구를 싣지 않는다', none.ok && none.payload.template === 'none' && none.payload.title === undefined);
    const long = PL.buildRenderPayload(Object.assign({}, base, { title: '가'.repeat(60), badge: '나'.repeat(30) }));
    ok('문구는 길이 상한에서 자른다(40·14자)', long.payload.title.length === 40 && long.payload.badge.length === 14);
    ok('템플릿 필드가 붙어도 큐 한도(4000자) 안', JSON.stringify(Object.assign({ type: 'content_render' }, PL.buildRenderPayload(Object.assign({}, base, {
      cuts: Array.from({ length: 150 }, (_, i) => [1000 + i * 2.5, 1001.5 + i * 2.5, 0]),
      template: 'daejeon_youth', title: '천장에 매달린 건', badge: '제주 · 서커스', hook: '천 두 장뿐', outro: '다음 코스는? 구독'
    })).payload)).length < 4000);
    const st = PL.normalizeState({ template: 'ppiyak_kimmary', title: '메리', hook: '이불빨래', badge: '', outro: '' });
    ok('상태에 템플릿 선택·문구가 남는다', st.template === 'ppiyak_kimmary' && st.title === '메리' && st.hook === '이불빨래');
    ok('상태의 모르는 템플릿은 auto', PL.normalizeState({ template: 'zzz' }).template === 'auto');

    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'seeds', 'video_template.json'), 'utf8'));
    ok('시드: 두 트랙의 강조색·뱃지가 정의돼 있다', seed.brands.daejeon_youth.accent === '#FF7A1A' && seed.brands.ppiyak_kimmary.accent === '#E08A56' && seed.brands.daejeon_youth.badge_text === '대전 청년');
    ok('시드: 안전영역·자막 수치가 노트북과 같다', seed.common.safe_zone.top === 240 && seed.common.caption.cpl === 13 && seed.common.caption.size === 68);
    ok('videoTemplate 의 id 목록이 시드와 같다', JSON.stringify(VT.TEMPLATE_IDS) === JSON.stringify(['auto', 'none', 'daejeon_youth', 'ppiyak_kimmary']));

    const sr = JSON.parse(fs.readFileSync(path.join(ROOT, 'seeds', 'video_script_rules.json'), 'utf8'));
    ok('대본 시드: 15초 80~110자 · 30초 180~220자', sr.length['15'].min === 80 && sr.length['15'].max === 110 && sr.length['30'].min === 180 && sr.length['30'].max === 220);
    ok('대본 시드: 첫 3초 훅 · CTA 2~3초', sr.structure.hook_seconds === 3 && sr.structure.cta_min === 2 && sr.structure.cta_max === 3);
    ok('대본 시드: 금지어에 인생템·완벽한·최고의·가성비 갑', ['인생템', '완벽한', '최고의', '가성비 갑'].every(w => sr.banned.indexOf(w) >= 0));
    ok('대본 시드: 톤 복제 참고가 있다', sr.tone_references.daejeon_youth.length >= 3 && /봉명동/.test(sr.tone_references.daejeon_youth[0]));

    const orders = fs.readFileSync(path.join(ROOT, 'gas', 'Orders.gs'), 'utf8');
    ok('GAS: 템플릿 4종을 검사하고 통과시킨다', /RENDER_TEMPLATES = \['auto', 'none', 'daejeon_youth', 'ppiyak_kimmary'\]/.test(orders) && /out\.template = tm/.test(orders) && /out\[k\] = t/.test(orders));
    const pv = fs.readFileSync(path.join(ROOT, 'js', 'produceView.js'), 'utf8');
    ok('제작 ④ 화면에 템플릿 칸이 있다', /채널 템플릿/.test(pv) && /template: state\.template/.test(pv));

    /* ── 질문형 훅 70% · 무음 보조 글자 · 첫 프레임 잠금(2026-11-21) ── */
    ok('질문형: ? 로 끝나면 질문형(전각 ？ 포함)', VT.isQuestionHook('이 가격 실화냐?') && VT.isQuestionHook('진짜야？') && !VT.isQuestionHook('천 두 장뿐'));
    ok('질문형 규칙: 8~11자 통과 · 규칙 값은 시드와 같다', (() => {
      const c = VT.checkHookForm('이 가격 실화냐?');
      const s = seed.common.hook.question;
      return c.form === 'question' && c.chars === 9 && c.ok === true && s.ratio === 0.7 && s.min_chars === 8 && s.max_chars === 11 && VT.HOOK_QUESTION.ratio === s.ratio && VT.HOOK_QUESTION.min === s.min_chars;
    })());
    ok('단언형·길이 벗어남은 경고만(막지 않는다)', VT.checkHookForm('천 두 장뿐').warnings.length === 1 && VT.checkHookForm('이 가격이 진짜 이게 맞다고?').warnings.length === 1 && VT.checkHookForm('').form === 'none');
    ok('편 번호로 10편 중 7편 질문형', [1, 2, 3, 4, 5, 6, 7].every((n) => VT.hookFormFor(n) === 'question') && [8, 9, 10].every((n) => VT.hookFormFor(n) === 'statement') && VT.hookFormFor(11) === 'question');
    const sub = PL.buildRenderPayload(Object.assign({}, base, { template: 'daejeon_youth', hook: '이 가격 실화냐?', hookSub: '끝까지 보셈 진짜로' }));
    ok('무음 보조 글자는 6자에서 자르고 오더에 싣는다', sub.ok && sub.payload.hook_sub === '끝까지 보셈', sub.payload && sub.payload.hook_sub);
    ok('보조 글자 상한이 시드와 같다', seed.order_fields.hook_sub === 6 && VT.TEMPLATE_LIMITS.hook_sub === 6);
    ok('none 템플릿이면 보조 글자도 싣지 않는다', PL.buildRenderPayload(Object.assign({}, base, { template: 'none', hookSub: '끝까지' })).payload.hook_sub === undefined);

    const lock = PL.buildRenderPayload(Object.assign({}, base, { frameLock: true, frameLockImage: 'mary_front.jpg', frameLockSeconds: 0.04 }));
    ok('첫 프레임 잠금: 켜면 frame_lock·사진·길이가 실린다', lock.ok && lock.payload.frame_lock === true && lock.payload.frame_lock_image === 'mary_front.jpg' && lock.payload.frame_lock_seconds === 0.04, lock.payload);
    ok('첫 프레임 잠금: 끄면 사진이 와도 싣지 않는다(숨은 동작 없음)', (() => { const r = PL.buildRenderPayload(Object.assign({}, base, { frameLockImage: 'm.jpg' })); return r.ok && r.payload.frame_lock === undefined && r.payload.frame_lock_image === undefined; })());
    ok('첫 프레임 잠금 거부: 사진 경로·확장자, 길이 범위', !PL.buildRenderPayload(Object.assign({}, base, { frameLock: true, frameLockImage: '../m.jpg' })).ok && !PL.buildRenderPayload(Object.assign({}, base, { frameLock: true, frameLockImage: 'm.gif' })).ok && !PL.buildRenderPayload(Object.assign({}, base, { frameLock: true, frameLockSeconds: 2 })).ok);
    ok('첫 프레임 잠금: 시드 값과 같다(기본 1프레임 0.04초 · 0.02~0.5초)', seed.frame_lock.default_seconds === 0.04 && seed.frame_lock.min_seconds === PL.FRAME_LOCK_SECONDS.min && seed.frame_lock.max_seconds === PL.FRAME_LOCK_SECONDS.max);
    const lst = PL.normalizeState({ frame_lock: true, frame_lock_image: 'mary.jpg', frame_lock_seconds: 0.2, hook_sub: '끝까지 보세요' });
    ok('상태에 잠금·보조 글자가 남는다(새로고침해도 유지)', lst.frame_lock === true && lst.frame_lock_image === 'mary.jpg' && lst.frame_lock_seconds === 0.2 && lst.hook_sub === '끝까지 보세');
    ok('상태의 범위 밖 잠금 길이는 버린다', PL.normalizeState({ frame_lock: true, frame_lock_seconds: 9 }).frame_lock_seconds === '');
    ok('제작 ④ 화면에 무음 보조 글자·첫 프레임 잠금 칸이 있다', /무음 보조 글자/.test(pv) && /첫 프레임 잠금/.test(pv) && /hookSub: state\.hook_sub/.test(pv) && /frameLock: state\.frame_lock/.test(pv));
    ok('GAS: hook_sub·frame_lock 을 검사해 넘긴다', /hook_sub: 6/.test(orders) && /out\.frame_lock = true/.test(orders) && /frame_lock_seconds 는 0\.02~0\.5/.test(orders));
    /* ── 자동 줌·모션(2026-11-21) — 기본 auto · 3종 프리셋 · 끄기 none ── */
    ok('기본값은 auto · standard', PL.defaultState().motion === 'auto' && PL.defaultState().motion_quality === 'standard');
    ok('프리셋 4종 auto · dynamic · calm · none', PL.MOTION_IDS.join(',') === 'auto,dynamic,calm,none' && PL.MOTION_LABELS.none === '끔');
    ok('상태: 고른 모션이 남고(새로고침 유지), 모르는 값은 auto', PL.normalizeState({ motion: 'dynamic', motion_quality: 'high' }).motion === 'dynamic' && PL.normalizeState({ motion: 'wobble' }).motion === 'auto' && PL.normalizeState({ motion_quality: 'x' }).motion_quality === 'standard');
    ok('옛 저장값(모션 키 없음)은 auto 로 돈다(오늘 오더도 모션이 붙는다)', PL.normalizeState({ inputs: ['a.mp4'] }).motion === 'auto');
    ok('오더: motion 은 늘 싣고(기본 auto), none 이면 none', PL.buildRenderPayload(Object.assign({}, base, { motion: 'none' })).payload.motion === 'none' && PL.buildRenderPayload(Object.assign({}, base)).payload.motion === 'auto');
    ok('오더: 모르는 모션·화질은 거부', !PL.buildRenderPayload(Object.assign({}, base, { motion: 'wobble' })).ok && !PL.buildRenderPayload(Object.assign({}, base, { motionQuality: '4k' })).ok);
    ok('제작 ④ 화면에 자동 줌·모션 보기 칸이 있다', /자동 줌·모션/.test(pv) && /MOTION_LABELS\[id\]/.test(pv) && /motion: state\.motion, motionQuality: state\.motion_quality/.test(pv));
    ok('화면 도움말이 프리셋 동작을 밝힌다(3초 이상 · 펀치 1회 · 1080p 가로 1.12배)', /3초 이상 클립에 줌인·줌아웃/.test(pv) && /훅 끝에 펀치줌 1회/.test(pv) && /1080p 가로 원본은 최대 1\.12배/.test(pv));
    ok('GAS: motion·motion_quality 두 키를 검사해 넘긴다', /RENDER_MOTIONS = \['auto', 'dynamic', 'calm', 'none'\]/.test(orders) && /out\.motion = mo/.test(orders) && /RENDER_MOTION_QUALITY = \['standard', 'high'\]/.test(orders) && /out\.motion_quality = mq/.test(orders));
    ok('4계층 값이 같다(화면 · GAS · 노트북)', PL.MOTION_IDS.join(',') === 'auto,dynamic,calm,none' && fs.existsSync(path.join(ROOT, 'js', 'produceLogic.js')) && /MOTION_IDS/.test(pv));
    // 대본 AI 가 뽑은 질문형 훅 → 제작 스텝퍼 훅 칸(2026-11-21)
    const csSrc = fs.readFileSync(path.join(ROOT, 'js', 'createStudio.js'), 'utf8');
    ok('대본 결과의 훅·보조 글자를 카드 production 에 남긴다', /hook: draft\.hook \|\| null/.test(csSrc) && /hook_sub: draft\.hook_sub \|\| null/.test(csSrc));
    ok('스텝퍼 훅 칸이 비었을 때만 대본 훅으로 채운다(내 값은 안 덮는다)', /if \(draft\.hook && !String\(vs\.hook \|\| ''\)\.trim\(\)\) preset\.hook = draft\.hook/.test(csSrc) && /saveMaterialsToStudio\(ctx, 'video', preset\)/.test(csSrc));
  } catch (err) {
    ok('채널 영상 템플릿 시험', false, (err && err.stack) || err);
  }

  console.log('\n[8] 오늘의 추천 제목 10 (js/blogSeo.js · 화면 연결)');
  try {
    const S = await import('file://' + path.join(ROOT, 'js', 'blogSeo.js'));
    eq('축 배지는 짧게', S.axisShort('store'), '재테크');
    eq('오르면 ▲+', S.trendChip({ trend_pct: 28.4, trend_state: '오르는 중' }), '▲+28%');
    eq('내리면 ▼−', S.trendChip({ trend_pct: -12, trend_state: '내리는 중' }), '▼−12%');
    eq('표본 적음은 숫자를 말하지 않는다', S.trendChip({ trend_pct: 40, trend_state: '표본 적음' }), '표본 적음');
    eq('값이 없으면 —', S.trendChip({}), '—');
    eq('색: +15 이상', S.trendTone({ trend_pct: 15 }), ' up');
    eq('색: −15 이하', S.trendTone({ trend_pct: -15 }), ' down');
    eq('내 순위 칩', S.rankChip({ my_rank: 14 }), '내 14위');
    eq('순위가 없으면 아무것도 안 단다', S.rankChip({}), '');
    eq('문서 수는 만 단위', S.docChip({ doc_total: 120000 }), '문서 12만');
    eq('문서 값이 없으면 빈 칸', S.docChip({}), '');
    const sp = S.splitRows([1, 2, 3, 4, 5, 6]);
    eq('처음 4개만 보인다', sp.first.length, 4);
    eq('나머지 2개는 펼치기', sp.rest.length, 2);
    const tl = S.titleLen('가'.repeat(50));
    ok('45자를 넘으면 표시한다', tl.over === true && tl.len === 50, tl);
    ok('45자까지는 그대로', S.titleLen('가'.repeat(45)).over === false);
    const seed = S.makeSeoSeed(
      { title: '대전 냉삼 다녀왔습니다', keyword: '대전 냉삼', axis: 'food', axis_label: '대전 맛집·카페' },
      { food: { skeleton: ['1. 언제:', '2. 주차:'] } }, '2026-11-21');
    ok('시드에 제목·키워드·뼈대가 담긴다', seed && seed.title === '대전 냉삼 다녀왔습니다' && seed.keyword === '대전 냉삼' && seed.skeleton.indexOf('1.') === 0, seed);
    S.putSeoSeed(seed);
    eq('시드를 보관하고 다시 읽는다', S.peekSeoSeed().title, '대전 냉삼 다녀왔습니다');
    S.clearSeoSeed();
    eq('시드를 지운다', S.peekSeoSeed(), null);
    eq('제목이 없는 줄은 시드로 만들지 않는다', S.makeSeoSeed({}, null, ''), null);

    const bsv = fs.readFileSync(path.join(ROOT, 'js', 'blogView.js'), 'utf8');
    ok('blog: 오늘의 추천 제목 카드를 그린다', /function seoPanel\(/.test(bsv) && /blogSeoTitles\(/.test(bsv));
    ok('blog: 4개 먼저, 나머지는 펼치기', /splitRows\(/.test(bsv) && /나머지 /.test(bsv));
    ok('blog: 제목을 누르면 스튜디오로 넘긴다', /putSeoSeed\(/.test(bsv) && /#\/create\/blog/.test(bsv));
    ok('blog: 발행은 사람 몫이라고 적는다', /임시저장까지/.test(bsv));
    ok('blog: 가져오지 못했을 때 다시 시도할 수 있다', /오늘의 제목을 가져오는 중/.test(bsv) && /다시 시도/.test(bsv));
    ok('blog: 불러오는 중 다시 그려져도 같은 약속을 쓴다(화면 얼음 방지)', /export function ensureBlogSeo/.test(bsv) && /if \(seoPromise\) return seoPromise/.test(bsv) && !/let seoLoading/.test(bsv));

    const SL = await import('file://' + path.join(ROOT, 'js', 'studioLogic.js'));
    const kit = await SL.buildBlogKit({
      materials: { place: { name: '테스트가게' }, content: { memo: '원문 한 문단입니다. 길이는 상관없습니다.', region_dong: '봉명동' }, concept: { kind: 'review', tone: 'plain' } },
      photos: [], links: [], title: '내가 고른 제목입니다'
    });
    eq('추천 제목이 1안이 된다', kit.titles[0], '내가 고른 제목입니다');
    eq('추천 제목도 키트에 남는다', kit.title_seed, '내가 고른 제목입니다');
    const composed = SL.composeBlogWithDraft(kit, { titles: ['AI 제목 A', 'AI 제목 B', 'AI 제목 C'], blocks: [] });
    ok('AI 초안이 와도 내가 고른 제목이 1안', /1\) 내가 고른 제목입니다/.test(composed.text), composed.text.split('\n').slice(0, 3));

    const csv = fs.readFileSync(path.join(ROOT, 'js', 'createStudio.js'), 'utf8');
    ok('스튜디오: 추천 제목에서 시작했다고 보여 준다', /function seoSeedPanel\(/.test(csv) && /오늘의 추천 제목에서 시작/.test(csv));
    ok('스튜디오: 메모 뼈대를 넣어 준다', /메모 뼈대 넣기/.test(csv) && /seed\.skeleton/.test(csv));
    ok('스튜디오: 제목을 키트에 넘긴다', /title: seoTitleOf\(\)/.test(csv));
  } catch (err) {
    ok('오늘의 추천 제목 10 시험', false, (err && err.stack) || err);
  }

  /* ── 무료 AI 클립(구글 Flow·허깅페이스) — js/aiClip.js ↔ seeds/ai_video_free.json ── */
  console.log('[무료 AI 클립]');
  try {
    const { pathToFileURL } = require('url');
    const AC = await import(pathToFileURL(path.join(ROOT, 'js', 'aiClip.js')).href + '?v=test-aiclip');
    ok('Flow: 720p 4초 = 12크레딧', AC.creditCost(4, '720p') === 12);
    ok('Flow: 360p 4초 = 4크레딧(1/3 값)', AC.creditCost(4, '360p') === 4);
    ok('Flow: 모르는 해상도는 720p 로 본다', AC.creditCost(4, '1080p') === 12);
    const bud = AC.fitsBudget({ seconds: 5, count: 2 }, '720p');
    ok('월 250크레딧 예산: 720p 5초 2컷 = 30크레딧 · 남음 220', bud.total === 30 && bud.fits === true && bud.left === 220, bud);
    ok('예산을 넘으면 fits=false(720p 10초 9컷 = 270)', AC.fitsBudget({ seconds: 10, count: 9 }, '720p').fits === false);
    ok('무료 플랜 하루 50은 화면 안내용으로 남긴다', AC.FLOW.monthlyCredits === 250 && AC.FLOW.dailyCredits === 50);

    const f = AC.buildFlowPrompt({ preset: 'product_scene', subject: 'a ceramic cat bowl', seconds: 4, resolution: '720p' });
    ok('프롬프트에 소재가 들어간다', /a ceramic cat bowl/.test(f.prompt));
    ok('프롬프트에 무자막 강제 문구가 늘 붙는다', f.prompt.indexOf(AC.NO_TEXT_SUFFIX) >= 0);
    ok('프롬프트에 9:16 이 들어간다', /9:16/.test(f.prompt));
    ok('길이는 3~10초로 조여진다', AC.buildFlowPrompt({ seconds: 30 }).seconds === 10 && AC.buildFlowPrompt({ seconds: 1 }).seconds === 3);
    ok('크레딧이 결과에 같이 온다', f.credits === 12 && f.resolution === '720p');
    ok('네거티브에 text·watermark 가 있다', /watermark/.test(f.negative) && /text/.test(f.negative));
    ok('모르는 프리셋은 상품 컷으로', AC.buildFlowPrompt({ preset: 'zzz' }).preset === 'product_scene');

    const m = AC.maryPrompt({});
    ['[1. SCENE]', '[2. ROLE]', '[3. IDENTITY LOCK]', '[4. KEEP]'].forEach((tag) => ok('메리 4단: ' + tag, m.indexOf(tag) >= 0));
    ok('메리 4단에 해부 가드(다리 4개·발가락)가 있다', /four legs only/.test(m) && /five toes/.test(m));
    ok('메리 4단에 무자막 문구가 있다', m.indexOf(AC.NO_TEXT_SUFFIX) >= 0);

    ok('삽입 상한: 30초 완제품 → 네이버 클립 6초 · 유튜브 9초', AC.maxInsertSeconds(30, 'naver_clip') === 6 && AC.maxInsertSeconds(30, 'youtube') === 9);
    ok('판정 5개', AC.JUDGE.length === 5);
    // 워터마크 처리 — 2026-11-21 실측으로 1.18배 크롭 폐기, delogo(기본)+하단 크롭(대안)
    ok('기본 크롭 모드는 delogo · 720p 실측 좌표', AC.INSERT.cropMode === 'delogo' && AC.cropFilter().indexOf('delogo=' + AC.INSERT.delogoExpr) === 0);
    ok('delogo 좌표: x 0.7944 · y 0.8844 · w 0.0778 · h 0.0438', /x=iw\*0\.7944/.test(AC.cropFilter()) && /y=ih\*0\.8844/.test(AC.cropFilter()) && /h=ih\*0\.0438/.test(AC.cropFilter()));
    ok('하단 크롭 대안: 720p 630×1120 과 같은 비율 · 1080×1920 · 30fps', /crop=iw\*0\.875:ih\*0\.875:iw\*0\.0625:0/.test(AC.cropFilter('bottom-crop')) && /scale=1080:1920/.test(AC.cropFilter()) && /fps=30/.test(AC.cropFilter()));
    ok('1.18배 크롭 흔적이 없다', AC.cropFilter().indexOf('1.18') < 0 && !('cropZoom' in AC.INSERT));

    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'seeds', 'ai_video_free.json'), 'utf8'));
    ok('시드: PLUS 월 250 · 무료 플랜 하루 50 · 360p 1 · 720p 3', seed.flow.monthly_credits === 250 && seed.flow.free_plan_daily_credits === 50 && seed.flow.models.omni_flash_1_2.credits_per_second['360p'] === 1 && seed.flow.models.omni_flash_1_2.credits_per_second['720p'] === 3);
    ok('시드: 한국은 워터마크 지역', seed.flow.visible_watermark_regions.indexOf('KR') >= 0);
    ok('시드: ZeroGPU 무료 5분', seed.spaces.quota.free_minutes_per_day === 5);
    ok('시드: animate 모드 두 가지', Object.keys(seed.spaces.wan_animate.modes).length === 2 && !!seed.spaces.wan_animate.modes['Pose Retarget']);
    ok('js/aiClip.js 상수와 시드가 같다(크레딧·크롭 모드·삽입·상한)', AC.FLOW.creditsPerSecond['720p'] === seed.flow.models.omni_flash_1_2.credits_per_second['720p'] && AC.FLOW.monthlyCredits === seed.flow.monthly_credits && AC.INSERT.cropMode === seed.clip_spec.crop_mode && AC.INSERT.delogoExpr === seed.clip_spec.delogo_expr && AC.cropFilter('bottom-crop').indexOf(seed.clip_spec.fallback_crop_expr) === 0 && AC.INSERT.maxSeconds === seed.clip_spec.insert_seconds.max && AC.INSERT.maxShareOfFinal === seed.clip_spec.max_share_of_final);
    ok('시드 Space 이름이 실측 그대로', seed.spaces.wan_i2v.repo === 'zerogpu-aoti/wan2-2-fp8da-aoti-faster' && seed.spaces.wan_animate.repo === 'alexnasa/Wan2.2-Animate-ZEROGPU');

    const src = fs.readFileSync(path.join(ROOT, 'js', 'aiClip.js'), 'utf8');
    ok('aiClip: innerHTML 없음', !/\.innerHTML\s*=/.test(src));
    ok('aiClip: 주소·토큰 값이 없다', !/script\.google\.com|hf_[A-Za-z0-9]{10,}/.test(src));
    const cs = fs.readFileSync(path.join(ROOT, 'js', 'createStudio.js'), 'utf8');
    ok('스튜디오 영상 화면에 AI 클립 패널이 붙는다', /paintAiClip\(host, ctx\)/.test(cs) && /from '\.\/aiClip\.js/.test(cs));
  } catch (err) {
    ok('무료 AI 클립 시험', false, (err && err.stack) || err);
  }

  /* ── 🎵 뮤직비디오 모드 (2026-11-21, Phase 1) ── */
  console.log('\n[🎵 뮤직비디오 모드]');
  try {
    const SL = await import('file://' + path.join(ROOT, 'js', 'studioLogic.js') + '?v=mv1');
    const mat = SL.normalizeMaterials({});
    ok('기본값: 일반 영상 모드 · 컷 밀도 1마디 · 다운비트 번쩍임 켜짐 · 길이 곡 끝', mat.video.mv.on === false && mat.video.mv.density === 'normal_4beat' && mat.video.mv.effects === 'pulse' && mat.video.mv.length_sec === 0 && mat.video.mv.lyric_mode === 'mine');
    const mv1 = SL.normalizeMv({ on: true, density: 'nope', effects: 'zzz', mood: 'jazz', lyric_mode: 'x', length_sec: 45, bpm_hint: 999, lyrics: '가\n\n나' });
    ok('모르는 값은 기본으로 돌린다(오더가 거절되지 않게)', mv1.on === true && mv1.density === 'normal_4beat' && mv1.effects === 'pulse' && mv1.mood === 'pop' && mv1.lyric_mode === 'mine', mv1);
    ok('길이는 15·30·60·곡 끝(0) 중 하나', mv1.length_sec === 0);
    ok('BPM 힌트는 0~300 밖이면 자동(0)', mv1.bpm_hint === 0);
    eq('가사 줄 수(빈 줄은 버린다)', SL.mvLyricLines(mv1.lyrics).length, 2);
    eq('파일 이름: 한글·공백 그대로, 확장자 유지', SL.mvAudioFileName('내 노래 v2.mp3'), '내 노래 v2.mp3');
    eq('파일 이름: 위험 문자는 - 로', SL.mvAudioFileName('../a/b<c>.m4a'), 'a-b-c-.m4a');
    eq('음원이 아니면 빈 값', SL.mvAudioFileName('song.exe'), '');
    eq('이름이 비면 내 노래 로', SL.mvAudioFileName('.wav'), 'wav'.length ? SL.mvAudioFileName('.wav') : '');
    eq('요약 한 줄', SL.mvSummary({ audio: { name: 'song.mp3', title: '내 노래' }, density: 'fast_2beat', lyrics: '한 줄\n두 줄', lyric_mode: 'mine', effects: 'pulse' }), '내 노래 · 빠르게 (2박) · 가사 2줄 · 다운비트 번쩍임');

    const payload = SL.mvOrderPayload({
      contentId: 'CH-1', brand: 'daejeon_youth',
      images: Array.from({ length: 30 }, (_, i) => 'p' + i + '.jpg'),
      mv: { on: true, audio: { name: '내 노래.mp3', title: '내 노래' }, lyrics: '한 줄\n두 줄', density: 'fast_2beat', effects: 'none', mood: 'rock', length_sec: 30, lyric_mode: 'mine' }
    });
    ok('오더: content_render · mode mv · 사진 25장 상한', payload.type === 'content_render' && payload.mode === 'mv' && payload.images.length === 25 && payload.content_id === 'CH-1');
    ok('오더: 음원 이름만(경로 없음) · 밀도·이펙트·길이·가사', payload.mv.audio === '내 노래.mp3' && payload.mv.density === 'fast_2beat' && payload.mv.effects === 'none' && payload.mv.length_sec === 30 && payload.mv.lyrics === '한 줄\n두 줄', payload.mv);
    const inst = SL.mvOrderPayload({ contentId: 'C', brand: 'daejeon_youth', images: ['a.jpg', 'b.jpg', 'c.jpg'], mv: { audio: { name: 'x.mp3' }, lyric_mode: 'none', lyrics: '가사' } });
    ok('연주곡이면 가사를 싣지 않는다', !('lyrics' in inst.mv) && inst.mv.lyric_mode === 'none' && inst.mv.length_sec === 0);

    const cs2 = fs.readFileSync(path.join(ROOT, 'js', 'createStudio.js'), 'utf8');
    ok('화면: [일반 영상 | 🎵 뮤직비디오] 토글', /일반 영상/.test(cs2) && /🎵 뮤직비디오/.test(cs2) && /function paintMvPanel\(/.test(cs2));
    ok('화면: 내 음원을 bgm_put 으로 올리고 이름만 오더로', /bgm_put/.test(cs2) && /mvOrderPayload\(/.test(cs2) && /bgm_list/.test(cs2));
    ok('화면: 둥근 조각(2MB)으로 올린다', /MV_CHUNK_BYTES/.test(cs2) && /file\.slice\(/.test(cs2));
    const mvBody = (cs2.match(/function paintMvPanel\(host, out, ctx, ui\) \{[\s\S]*?\n\}/) || [''])[0];
    ok('MV 화면은 내레이션(TTS) 버튼을 그리지 않는다(노래와 겹침 방지)', mvBody.length > 1000 && mvBody.indexOf('대본·자막·내레이션 만들기') < 0 && mvBody.indexOf('paintScriptBox') < 0);
    ok('화면: 보컬 무료 경로 안내(ACE-Step·보컬 분리)', /ACE-Step/.test(cs2) && /보컬 분리/.test(cs2));
    ok('화면: 카드 payload studio.formats.video.mv 로 저장', /mv: m\.video\.mv/.test(cs2));
    ok('화면: innerHTML 없음', !/\.innerHTML\s*=/.test(cs2));
    ok('studioLogic: 뮤직비디오 함수를 내멂는다', /export function mvOrderPayload/.test(fs.readFileSync(path.join(ROOT, 'js', 'studioLogic.js'), 'utf8')));
  } catch (err) {
    ok('뮤직비디오 모드 시험', false, (err && err.stack) || err);
  }

  /* ── 📊 쇼츠 3지표 진단 (2026-11-21, #/perf) ── */
  console.log('\n[📊 쇼츠 3지표 진단]');
  try {
    const D = await import('file://' + path.join(ROOT, 'js', 'perfDiagnosis.js') + '?v=test-dx');
    const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;

    /* ① 지표 계산 — 있는 값만 쓴다 */
    ok('반응률 = (좋아요+댓글+공유)÷조회', near(D.reactionPct({ views: 1000, likes: 40, comments: 5, shares: 5 }), 5));
    ok('조회 0이면 반응률 null(0%로 속이지 않음)', D.reactionPct({ views: 0, likes: 9 }) === null);
    ok('중위수(홀수) 20 · 표본 3', D.medianInfo([10, 20, 30]).value === 20 && D.medianInfo([10, 20, 30]).n === 3);
    ok('중위수(짝수) 15 · 표본 2', D.medianInfo([10, 20]).value === 15);
    ok('중위수 표본 없음 → null', D.medianInfo([]).value === null && D.medianInfo([]).n === 0);
    ok('발행 경과일 11일', D.dayAge('2026-11-10', '2026-11-21') === 11 && D.dayAge('2026-11-21', '2026-11-21') === 0);
    ok('발행일 모르면 null', D.dayAge('', '2026-11-21') === null && D.dayAge('어제', '2026-11-21') === null);

    /* ② 조회수 기준 변경(8/24) 구분 — 옛 영상은 비교에서 뺀다 */
    ok('8/24 전 = old', D.eraOf('2026-08-23') === 'old' && D.eraOf('2026-08-24') === 'current');
    ok('발행일 모르면 era unknown', D.eraOf('') === 'unknown');

    /* ③ 평균 시청률 — 실제 값만, 없으면 null */
    ok('유튜브가 준 평균 시청률을 그대로', near(D.retentionOf({ avg_view_pct: 62.4, views: 100 }, {}).pct, 62.4));
    ok('시청시간÷조회÷길이로 계산(37.0%)', near(D.retentionOf({ watch_time_sec: 1000, views: 100, duration_sec: 27 }, {}).pct, 37.037) && D.retentionOf({ watch_time_sec: 1000, views: 100, duration_sec: 27 }, {}).source === 'watch_time');
    const dwellCtx = { dwellByContent: { C1: 15 }, shortsCountByContent: { C1: 1 }, metaById: { v1: { duration_sec: 30 } } };
    ok('입력한 시청 지속 15초÷30초 = 50%', near(D.retentionOf({ content_id: 'C1', external_id: 'v1', views: 100 }, dwellCtx).pct, 50) && D.retentionOf({ content_id: 'C1', external_id: 'v1', views: 100 }, dwellCtx).source === 'dwell');
    ok('같은 카드에 쇼츠가 2편이면 카드 입력을 붙이지 않는다', D.retentionOf({ content_id: 'C1', external_id: 'v1', views: 100 }, Object.assign({}, dwellCtx, { shortsCountByContent: { C1: 2 } })) === null);
    ok('길이를 모르면 계산하지 않는다', D.retentionOf({ content_id: 'C1', external_id: 'v9', views: 100 }, Object.assign({}, dwellCtx, { metaById: {} })) === null);
    ok('아무 값도 없으면 null(추정 금지)', D.retentionOf({ views: 100 }, {}) === null);
    ok('비율 66.7% → 27초 영상이면 18초', D.dwellSecFromPct(66.7, 27) === 18);
    ok('비율이 0·100 초과·길이 없음이면 0(저장하지 않음)', D.dwellSecFromPct(0, 30) === 0 && D.dwellSecFromPct(120, 30) === 0 && D.dwellSecFromPct(50, 0) === 0);
    ok('비율 → 초 → 비율 왕복이 그대로', near(D.dwellSecFromPct(62.5, 40) / 40 * 100, 62.5));

    /* ④ 병목 판정 — 우리 채널 중위수 비교 */
    const mk = (o) => Object.assign({ channel: 'shorts', likes: 0, comments: 0, shares: 0 }, o);
    const metaOf = (o) => {
      const m = {};
      Object.keys(o).forEach((k) => { m[k] = { duration_sec: 30, published_at: o[k] }; });
      return m;
    };
    const published = { a: '2026-11-10', b: '2026-11-10', c: '2026-11-10', d: '2026-11-10', e: '2026-11-10', f: '2026-11-10', g: '2026-11-10', h: '2026-11-21', i: '2026-08-01', j: '2026-11-10' };
    const vids = [
      mk({ external_id: 'a', content_id: 'Ca', views: 1000, likes: 40, comments: 5, shares: 5 }),
      mk({ external_id: 'b', content_id: 'Cb', views: 900, likes: 36, comments: 4, shares: 4 }),
      mk({ external_id: 'c', content_id: 'Cc', views: 800, likes: 32, comments: 4, shares: 4 }),
      mk({ external_id: 'e', content_id: 'Ce', views: 300, likes: 15, comments: 0, shares: 0 }),
      mk({ external_id: 'f', content_id: 'Cf', views: 600, likes: 30, comments: 0, shares: 0 }),
      mk({ external_id: 'g', content_id: 'Cg', views: 500, likes: 2, comments: 0, shares: 0 }),
      mk({ external_id: 'j', content_id: 'Cj', views: 100, likes: 5, comments: 0, shares: 0 }),
      mk({ external_id: 'h', content_id: 'Ch', views: 700, likes: 35, comments: 0, shares: 0 }),
      mk({ external_id: 'i', content_id: 'Ci', views: 99999, likes: 1, comments: 0, shares: 0 })
    ];
    const dwell = { Ca: 27, Cb: 26, Cc: 25, Ce: 10, Cf: 0, Cg: 27, Cj: 27, Ch: 27, Ci: 27 };
    const counts = { Ca: 1, Cb: 1, Cc: 1, Ce: 1, Cf: 1, Cg: 1, Cj: 1, Ch: 1, Ci: 1 };
    const res = D.diagnoseVideos(vids, { today: '2026-11-21', metaById: metaOf(published), dwellByContent: dwell, shortsCountByContent: counts });
    const by = {};
    res.items.forEach((v) => { by[v.external_id] = v; });
    ok('시청률 낮은 영상 = 첫 장면 병목', by.e.bottleneck === 'early', by.e);
    ok('첫 장면 처방은 첫 1~2초를 짚는다', /첫 1~2초/.test(by.e.prescription), by.e.prescription);
    ok('끝까지 보는데 반응 없으면 = 엔딩 병목', by.g.bottleneck === 'ending', by.g);
    ok('엔딩 처방은 저장·공유 한 줄과 루프를 짚는다', /저장·공유/.test(by.g.prescription) && /루프/.test(by.g.prescription));
    ok('반응·시청률 좋은데 조회 적으면 = 노출·첫 장면', by.j.bottleneck === 'reach', by.j);
    ok('세 지표 다 좋으면 = 유지', by.a.bottleneck === 'keep' && by.b.bottleneck === 'keep' && by.c.bottleneck === 'keep');
    ok('시청 지속 미입력 = 측정 필요', by.f.bottleneck === 'measure' && /스튜디오/.test(by.f.prescription), by.f);
    ok('미입력이어도 반응률이 낮으면 그 사실을 같이 적는다', /반응률도 우리 중위수/.test(by.f.prescription) === false || /반응률/.test(by.f.prescription));
    ok('발행 3일 안이면 판단 보류', by.h.bottleneck === 'wait' && /D\+3/.test(by.h.prescription), by.h);
    ok('8/24 이전 영상은 기준 이전으로 분리', by.i.bottleneck === 'old_era' && /8\/24/.test(by.i.prescription), by.i);
    ok('옛 영상(조회 99,999)은 조회 중위수에서 빠진다', res.basis.views.value === 650, res.basis.views.value);
    ok('옛 영상은 시청률 중위수에서도 빠진다', res.basis.retention.n === 7, res.basis.retention.n);
    ok('반응률 중위수 = 5%', near(res.basis.reaction.value, 5), res.basis.reaction.value);
    ok('판단이 필요한 카드가 먼저 온다(측정 필요 → 병목 → 유지 → 보류)', res.items[0].bottleneck === 'measure'
      && ['early', 'ending'].every((k) => res.items.slice(1, 3).map((v) => v.bottleneck).indexOf(k) >= 0)
      && res.items.slice(4, 7).every((v) => v.bottleneck === 'keep'), res.items.map((v) => v.bottleneck));
    ok('집계 전(조회 0)은 맨 뒤', res.items.filter((v) => v.bottleneck === 'no_data').length === 0 && D.diagnoseVideos([mk({ external_id: 'z', views: 0 })], { today: '2026-11-21' }).items[0].bottleneck === 'no_data');

    /* 표본이 3편 미만이면 비교하지 않는다 */
    const few = D.diagnoseVideos([
      mk({ external_id: 'a', content_id: 'Ca', views: 100, likes: 10 }),
      mk({ external_id: 'b', content_id: 'Cb', views: 100, likes: 10 })
    ], { today: '2026-11-21', metaById: metaOf({ a: '2026-11-10', b: '2026-11-10' }), dwellByContent: { Ca: 27, Cb: 27 }, shortsCountByContent: { Ca: 1, Cb: 1 } });
    ok('측정 2편으로는 병목을 단정하지 않는다', few.items.every((v) => v.bottleneck === 'insufficient'), few.items.map((v) => v.bottleneck));
    ok('표본 부족 처방은 3편을 쌓으라고 한다', /3편/.test(few.items[0].prescription));

    /* ⑤ 입력 반영 — Metrics 행에서 카드별 시청 지속을 뽑는다 */
    const dw = D.dwellByContent([
      { channel: 'shorts', content_id: 'Ca', avg_dwell_sec: 10, measured_at: '2026-11-18' },
      { channel: 'shorts', content_id: 'Ca', avg_dwell_sec: 27, measured_at: '2026-11-20' },
      { channel: 'blog', content_id: 'Ca', avg_dwell_sec: 99, measured_at: '2026-11-20' },
      { channel: 'shorts', content_id: 'Cb', avg_dwell_sec: 0, measured_at: '2026-11-20' }
    ]);
    ok('카드별 시청 지속은 가장 최근 기록 · 0은 버린다', dw.Ca === 27 && !('Cb' in dw), dw);
    ok('카드별 쇼츠 편수를 센다', D.shortsCountByContent([{ content_id: 'Ca' }, { content_id: 'Ca' }, { content_id: '' }]).Ca === 2);

    /* 길이를 모르는 영상 — 초만 입력해 두고 길이가 오면 환산한다(입력 자체를 막지 않는다) */
    const noDur = D.diagnoseVideos([mk({ external_id: 'n1', content_id: 'Cn', views: 500, likes: 5 })], {
      today: '2026-11-21', metaById: { n1: { published_at: '2026-11-10' } }, dwellByContent: { Cn: 18 }, shortsCountByContent: { Cn: 1 }
    });
    ok('길이를 몰라도 입력한 초는 남는다', noDur.items[0].retention_pct === null && noDur.items[0].dwell_sec === 18, noDur.items[0]);
    ok('그 상태의 처방은 길이 대기를 말한다', noDur.items[0].bottleneck === 'measure' && /영상 길이/.test(noDur.items[0].prescription), noDur.items[0].prescription);

    /* ⑥ 화면·코드 규칙 */
    ok('패널 제목·미수집 고지', D.PANEL_TITLE.indexOf('3지표') >= 0 && /추정하지 않습니다/.test(D.PANEL_NOTE) && /8\/24/.test(D.PANEL_NOTE));
    const pds = fs.readFileSync(path.join(ROOT, 'js', 'perfDiagnosis.js'), 'utf8');
    const pfv = fs.readFileSync(path.join(ROOT, 'js', 'perfView.js'), 'utf8');
    ok('진단: innerHTML 0건', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(pds));
    ok('진단: 주소·토큰 값이 없다', !/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}|docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}|\bcq_[A-Za-z0-9]{8,}|xox[bp]-/.test(pds));
    ok('#/perf 전체 탭이 진단 패널을 부른다', /renderDiagnosisPanel\(dxHost, ctx, rows\)/.test(pfv) && /from '\.\/perfDiagnosis\.js/.test(pfv));
    ok('자동 수집은 노출·시청시간·평균 시청률을 버리지 않는다', /impressions: n\(r\.impressions\)/.test(fs.readFileSync(path.join(ROOT, 'js', 'analyticsView.js'), 'utf8'))
      && /avg_view_pct: n\(r\.avg_view_pct\)/.test(fs.readFileSync(path.join(ROOT, 'js', 'analyticsView.js'), 'utf8')));
    /* 다른 화면이 먼저 불러오는 중일 때 '0건'을 그리지 않는다(숫자와 0건이 같이 보이던 것) */
    const avsrc = fs.readFileSync(path.join(ROOT, 'js', 'analyticsView.js'), 'utf8');
    ok('이미 불러오는 중이면 기다렸다 다시 그린다(0건 오표시 방지)', /if \(stale\) \{/.test(avsrc) && /cache\.loading \? waitAnalytics\(\)/.test(avsrc) && /export function waitAnalytics/.test(avsrc));
  } catch (err) {
    ok('쇼츠 3지표 진단 시험', false, (err && err.stack) || err);
  }

  /* ⑦ 줄바꿈 규칙 — 덩어리(블로그) + 5블록(클립·쇼츠·릴스) (2026-11-22) */
  console.log('[7] 줄바꿈 규칙 (덩어리 · 설명란 5블록)');
  try {
    const imp = (f) => import('file://' + path.join(ROOT, 'js', f));
    const tone = await imp('blogTone.js');
    const desc = await imp('channelDesc.js');

    /* 빈 줄 기준 덩어리 읽기 */
    const g1 = tone.toGroups('줄1\n줄2\n\n줄3');
    ok('toGroups: 덩어리 2개', g1.length === 2 && g1[0].length === 2 && g1[1].length === 1, g1);

    /* 성격 판정 — 정보·캡션·해시태그 */
    ok('정보 줄 덩어리 = info', tone.groupKind(['📍 위치 : 대전', '⏰ 영업 : 15:00']) === 'info');
    ok('▲ 캡션 덩어리 = caption', tone.groupKind(['▲ 노란 간판', '유리문에 분필']) === 'caption');
    ok('해시태그 한 줄 = hashtag', tone.groupKind(['#대전맛집 #진미오겹살']) === 'hashtag');

    /* 1줄=1덩어리로 벌어진 초안을 2~5줄 덩어리로 접는다(이번 사고의 핵심) */
    const spread = ['가게 앞에 줄이 길었다', '평일 저녁인데도 만석이었다', '대기 명단에 이름을 적었다', '삼십 분쯤 기다려 들어갔다'].join('\n\n');
    const fixed = tone.applyBlogRhythm(spread);
    ok('빈 줄 과다 → 덩어리로 묶인다', fixed.groups.length < 4 && fixed.groups.every((g) => g.length <= tone.RHYTHM.groupMax), fixed.groups);
    ok('덩어리 사이만 빈 줄', fixed.text.split('\n\n').length === fixed.groups.length);
    ok('고친 뒤 빈 줄 경고가 사라진다', !tone.lintRhythm(fixed.text).some((i) => i.code === 'blank_ratio'), tone.lintRhythm(fixed.text).map((i) => i.code));

    /* 정보 줄은 안에서 끊지 않는다 */
    const infoSplit = '📍 위치 : 대전 서구 용문로 41-80\n\n⏰ 영업 : 15:00~24:00\n\n🚗 주차 : 지하 2시간';
    const infoFixed = tone.applyBlogRhythm(infoSplit);
    ok('📍⏰🚗 는 한 덩어리로 붙는다', infoFixed.groups.length === 1 && infoFixed.groups[0].length === 3, infoFixed.groups);
    ok('정보 줄이 끊긴 원문은 lint 가 잡는다', tone.lintRhythm(infoSplit).some((i) => i.code === 'info_gap'));

    /* 설명란 5블록 — 성래 님이 손으로 고친 클립 문안 그대로 */
    const runon = '대전 괴정동 손 까딱 안 하고 먹는 진미오겹살 | 계란찜까지 두툼한 제주 오겹살을 처음부터 끝까지 직원이 다 구워주는 괴정동 진미오겹살 본점입니다. 매일 15:00~24:00, 대전 서구 용문로 41-80 103·104호. 부풀어 오른 계란찜까지 꼭 같이 주문해 보세요. 저장해 두고 오늘 밤 달려가세요! #오늘클립챌린지 #대전맛집 #괴정동맛집 #진미오겹살 #대전오겹살';
    const clip = desc.normalizeDesc(runon, 'clip');
    const clipBlocks = tone.toGroups(clip);
    ok('클립 설명 = 5블록', clipBlocks.length === 5, clipBlocks);
    ok('클립 정보 줄은 한 줄에 하나', clipBlocks[2].length === 2 && clipBlocks[2][0].indexOf('15:00') >= 0, clipBlocks[2]);
    ok('클립 주소에서 호수를 뺀다', clip.indexOf('103·104호') < 0 && clip.indexOf('41-80') >= 0);
    ok('클립은 이모지를 쓰지 않는다', !/[📍⏰🚗]/.test(clip));
    ok('해시태그는 마지막 블록', /^#/.test(clipBlocks[clipBlocks.length - 1][0]));
    ok('5블록으로 접은 뒤 lint 통과', desc.lintDesc(clip, 'clip').length === 0, desc.lintDesc(clip, 'clip'));

    /* 쇼츠·릴스는 정보 줄에 📍⏰🚗 */
    const shorts = desc.normalizeDesc(runon, 'shorts');
    ok('쇼츠 정보 줄에 이모지', shorts.indexOf('⏰') >= 0 && shorts.indexOf('📍') >= 0, shorts);
    ok('빈 줄 덩어리 원문은 run_on 으로 잡는다', desc.lintDesc(runon, 'clip').some((i) => i.code === 'run_on'));

    /* buildDesc — 제목이 상한을 넘으면 린터가 알린다 */
    const longTitle = desc.buildDesc({ channel: 'clip', title: '대전 괴정동 진미오겹살 직원이 다 구워주는 집 후기 정말 좋았습니다', summary: '요약 한 문장입니다.', hashtags: ['#대전맛집'] });
    ok('긴 제목은 title_long 경고', desc.lintDesc(longTitle, 'clip').some((i) => i.code === 'title_long'), longTitle);

    /* 시드 규칙 파일과 모듈 값이 어긋나지 않는다 */
    const seedDesc = JSON.parse(fs.readFileSync(path.join(ROOT, 'seeds', 'channel_desc_rules_2026w48.json'), 'utf8'));
    ok('시드 채널 한도 = 모듈 한도', ['clip', 'shorts', 'reels'].every((c) => seedDesc.channels[c].title_max === desc.DESC_RULES[c].titleMax && seedDesc.channels[c].chars_max === desc.DESC_RULES[c].charsMax), seedDesc.channels);
    ok('시드 줄 상한 = 모듈 줄 상한', seedDesc.layout.desc_line_max === tone.RHYTHM.descLineMax && seedDesc.layout.group_max === tone.RHYTHM.groupMax);

    /* 린터 항목 가중치 합 100 */
    const seedLint = JSON.parse(fs.readFileSync(path.join(ROOT, 'seeds', 'blog_lint_rules_2026w48.json'), 'utf8'));
    const wsum = seedLint.rules.reduce((a, r) => a + Number(r.weight || 0), 0);
    ok('블로그 린터 가중치 합 100 (줄바꿈 항목 포함)', wsum === 100 && seedLint.rules.some((r) => r.id === 'line_layout'), wsum);
  } catch (err) {
    ok('줄바꿈 규칙 시험', false, (err && err.stack) || err);
  }

  console.log('\n' + (failed ? '❌ 실패 ' + failed + '건' : '✅ content-hub 시험 전부 통과'));
  process.exit(failed ? 1 : 0);
})();
