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
    ok('index.html 이 새 app.js 버전을 부른다', /js\/app\.js\?v=20261119y/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
    ok('하단 탭이 늘지 않았다(10개)', (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/class="tab"/g) || []).length === 10);
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
    ok('payload 계약 v1', okP.ok && same(okP.payload, { content_id: 'CH-1', brand: 'ppiyak_kimmary', inputs: ['a.mp4'], profile: 'bgm', crop_x: 0.5 }), okP);
    ok('crop_x 가 비면 키를 만들지 않는다', !('crop_x' in L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], cropX: '' }).payload));
    ok('profile 기본 captions', L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'] }).payload.profile === 'captions');
    ok('잘못된 content_id·brand·crop_x·빈 inputs 거부', ['../x', 'a'.repeat(41)].every((id) => !L.buildRenderPayload({ contentId: id, brand: 'daejeon_youth', inputs: ['a.mp4'] }).ok)
      && !L.buildRenderPayload({ contentId: 'CH-1', brand: 'x', inputs: ['a.mp4'] }).ok
      && !L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], cropX: 2 }).ok
      && !L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: [] }).ok);

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
    ok('SRT 단계는 언제나 미완료(준비 중)', L.STEPS.find((x) => x.key === 'srt').soon === true && L.stepStatus(stDone, 'daejeon_youth').srt === false);
    const allReview = {}; L.reviewSteps('daejeon_youth').forEach((r) => { allReview[r.id] = true; });
    ok('캡컷 7단계 모두 체크하면 마무리 완료', L.stepStatus(L.normalizeState({ review: allReview }), 'daejeon_youth').finish === true);
    ok('손상된 저장값을 믿지 않는다', same(L.normalizeState({ inputs: 'x', profile: 'zz', review: { zz: true }, render: 5 }), L.defaultState()));

    /* 코드 규칙 */
    const pv = fs.readFileSync(path.join(ROOT, 'js', 'produceView.js'), 'utf8');
    const pl = fs.readFileSync(path.join(ROOT, 'js', 'produceLogic.js'), 'utf8');
    ok('innerHTML/outerHTML/insertAdjacentHTML/document.write 0건', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(pv + pl));
    ok('웹앱 주소·토큰·시트 ID 같은 값이 없다', !/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}|\bcq_[A-Za-z0-9]{8,}|xox[bp]-/.test(pv + pl));
    ok('payload studio 키 한 개만 저장(시트 칸을 늘리지 않는다)', /patch: \{ studio: state \}/.test(pv));
    ok('SRT 단계에 누를 수 있는 버튼이 없다', !/h\('button'/.test(pv.split('function bodySrt')[1].split('function bodyFinish')[0]));
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
    ok('완료: 초록 톤 + report 안내', D({ status: 'DONE', result: '렌더 완료 · x_clean.mp4' }).kind === 'ok' && /report/.test(D({ status: 'DONE' }).text) && /렌더 완료/.test(D({ status: 'DONE', result: '렌더 완료 · x_clean.mp4\n둘째 줄' }).text));
    ok('실패: 에러 첫 줄', D({ status: 'FAILED', error: '세로 변환 단계 실패(exit 1)\n자세히' }).kind === 'err' && /세로 변환 단계 실패/.test(D({ status: 'FAILED', error: '세로 변환 단계 실패(exit 1)\n자세히' }).text));
    ok('만료·거절·확인필요는 경고 톤', ['EXPIRED', 'REJECTED', 'REVIEW_NEEDED', 'TIMEOUT_REVIEW'].every((c) => D({ status: c }).kind === 'warn'));
    ok('화면 문구에 큐 코드값이 그대로 나오지 않는다', ['WAITING_APPROVAL', 'PENDING', 'RUNNING', 'DONE', 'FAILED', 'REJECTED', 'EXPIRED', 'REVIEW_NEEDED', 'TIMEOUT_REVIEW'].every((c) => { const d = D({ status: c, approval_expires_at: '2026-11-19T21:15:03+09:00' }); return !/[A-Z]{4,}_?[A-Z]*/.test(d.title + d.text.replace(/report/g, '')); }));
    ok('모르는 상태도 깨지지 않는다', typeof D({ status: 'WHATEVER' }).title === 'string' && typeof D(null).title === 'string');

    ok('api.js 에 hubOrderStatus(읽기)가 있다', /async hubOrderStatus\(orderId\)[\s\S]*?post\('hub_order_status'/.test(fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8')));
    ok('api.js 재시도 규칙은 그대로(429/5xx 3회)', /RETRY_DELAYS/.test(fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8')) && !/hub_order_status[\s\S]{0,200}retry/i.test(fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8')));
    ok('폴링은 숨은 탭에서 쉬고, 화면을 떠나면 멈춘다', /document\.hidden/.test(pv) && /visibilitychange/.test(pv) && /wrap\.isConnected/.test(pv) && /openStep !== 'render'/.test(pv));
    ok('상세 시트를 닫으면(DOM 이 남아도) 폴링이 멈춘다', /wrap\.closest\('dialog'\)/.test(pv) && /!dlg\.open/.test(pv));
    ok('종료 상태가 되면 다음 폴링을 걸지 않는다', /if \(!isTerminalStatus\(d\.status\)\) schedulePoll\(POLL_INTERVAL_MS\)/.test(pv));
    ok('연속 실패 3회 뒤 멈추고 안내', /poll\.fails >= POLL_MAX_FAILS/.test(pv) && /상태를 가져오지 못했습니다/.test(pv));
    ok('GAS 미배포면 중립 안내(재배포 후 켜짐)', /isNotDeployedCode\(code\)/.test(pv) && /재배포하면 이 상태 표시가 켜져요/.test(pv));
    ok('produceLogic import 에 버전 쿼리(캐시 어긋남 방지)', /from '\.\/produceLogic\.js\?v=\d+[a-z]'/.test(pv));
    ok('app.js 의 produceView import 버전이 index 와 같다', (fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').match(/produceView\.js\?v=(\d+[a-z])/) || [])[1] === (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/js\/app\.js\?v=(\d+[a-z])/) || [])[1]);
  } catch (err) {
    ok('제작 스텝퍼 시험', false, (err && err.stack) || err);
  }

  console.log('\n' + (failed ? '❌ 실패 ' + failed + '건' : '✅ content-hub 시험 전부 통과'));
  process.exit(failed ? 1 : 0);
})();
