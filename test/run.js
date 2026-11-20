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
    ok('index.html 이 새 app.js 버전을 부른다', /js\/app\.js\?v=\d+[a-z]/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
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
    ok('payload 에 cuts 를 싣는다(계약 키 + cuts)', same(L.buildRenderPayload({ contentId: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], cuts: [[1, 2]] }).payload, { content_id: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], profile: 'captions', cuts: [[1, 2]] }));
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
    const shared = [[[Cq(1, 2.5, '가\n나\n다')], 'FAIL:lines'], [[Cq(1, 2.5, '끝났어요.')], 'WARN:period'], [[Cq(1, 1.5, '짧음')], 'WARN:short'], [[Cq(1, 2.5, '{\\an8}위')], 'FAIL:ass_tag']];
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
        append(...kids) { kids.flat(4).forEach((k) => { if (k == null || k === false) return; const n = typeof k === 'object' ? k : { textContent: String(k), tag: '#text', children: [] }; if (n.parent !== undefined) n.parent = this; this.children.push(n); }); }
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
        n.append(...kids); return n;
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
            fin_report: { out: 'a_finish.mp4', width: 1080, height: 1920, fps: 30, duration: 8, lufs: -14, tp: -1.8, checks: [{ id: 'x', status: 'PASS', msg: 'ok' }], burn: { cues: 3, font: 'NanumGothic', font_preferred_missing: true, font_preferred: 'Pretendard', warnings: [] }, bgm: { name: 'b.mp3', volume_db: -24 } } },
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
              if (open.length > 1) failures.push((i + 1) + '단계: 둘 이상 펼쳐짐');   // 이미 펼쳐진 단계를 누르면 접히므로 0개도 정상
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
    ok('payload studio 키 한 개만 저장(시트 칸을 늘리지 않는다)', /patch: \{ studio: state \}/.test(pv));
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

  console.log('\n' + (failed ? '❌ 실패 ' + failed + '건' : '✅ content-hub 시험 전부 통과'));
  process.exit(failed ? 1 : 0);
})();
