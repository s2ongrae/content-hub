'use strict';
/**
 * tools/analytics/test/run.js — 수집기 단위 시험 (외부 패키지·네트워크 없음)
 * 사용: node tools/analytics/test/run.js
 */

const { fetchJson, AnalyticsError } = require('../lib/http');
const yt = require('../lib/youtube');
const ig = require('../lib/instagram');
const nz = require('../lib/normalize');
const sc = require('../lib/score');
const sync = require('../lib/sync');

let passed = 0;
let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra).slice(0, 300))); }
};
const eq = (name, actual, expected) => ok(name + ' (' + JSON.stringify(actual) + ')', actual === expected, { actual, expected });

/** 가짜 fetch — urls 에 매칭되는 응답을 준다. calls 로 호출 수를 센다. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    const hit = routes.find((r) => (r.test instanceof RegExp ? r.test.test(url) : String(url).indexOf(r.test) >= 0));
    if (!hit) return { status: 404, body: { error: { message: 'no route: ' + url } } };
    const reply = typeof hit.reply === 'function' ? hit.reply(url, calls.length) : hit.reply;
    return { status: reply.status || 200, body: reply.body };
  };
  fn.calls = calls;
  return fn;
}

(async () => {
  /* ───────── 1. http ───────── */
  console.log('[1] http — 재시도 · 재시도 금지 · 비밀값 가리기');
  {
    const f = fakeFetch([{ test: /boom/, reply: (u, n) => (n < 3 ? { status: 503, body: { error: { message: 'busy' } } } : { status: 200, body: { ok: true } }) }]);
    const res = await fetchJson('https://x.test/boom', { fetchImpl: f, retries: 3 });
    eq('5xx 두 번 뒤 성공', res.ok, true);
    eq('호출 3회', f.calls.length, 3);

    const g = fakeFetch([{ test: /denied/, reply: { status: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'no', errors: [{ reason: 'forbidden' }] } } } }]);
    let err = null;
    try { await fetchJson('https://x.test/denied', { fetchImpl: g, retries: 3 }); } catch (e) { err = e; }
    ok('4xx 는 재시도하지 않는다', !!err && g.calls.length === 1, g.calls.length);
    eq('4xx 코드·사유 보존', err && err.details.reason, 'forbidden');

    const h = fakeFetch([{ test: /secret/, reply: { status: 500, body: { error: { message: 'key=SUPERSECRET123 실패' } } } }]);
    let err2 = null;
    try { await fetchJson('https://x.test/secret?key=SUPERSECRET123', { fetchImpl: h, retries: 0, secrets: ['SUPERSECRET123'] }); } catch (e) { err2 = e; }
    ok('오류 메시지·URL 에서 키를 지운다', !!err2 && !/SUPERSECRET123/.test(err2.message + JSON.stringify(err2.details)), err2 && err2.message);

    /* 실제 fetch 의 Response 처럼 .json() 이 비동기인 응답 — 본문이 Promise 로 새지 않아야 한다 */
    const real = async () => ({ status: 200, json: async () => ({ items: [{ id: 'UC_A' }] }) });
    const res2 = await fetchJson('https://x.test/real', { fetchImpl: real });
    ok('실제 Response 본문도 객체로 온다', !!(res2.body && res2.body.items && res2.body.items[0].id === 'UC_A'), res2.body);
  }

  /* ───────── 2. 유튜브 파싱 ───────── */
  console.log('[2] 유튜브 — 기간·표면·응답 파싱');
  eq('PT1M3S = 63초', yt.parseDurationSec('PT1M3S'), 63);
  eq('PT45S = 45초', yt.parseDurationSec('PT45S'), 45);
  eq('PT1H2M3S = 3723초', yt.parseDurationSec('PT1H2M3S'), 3723);
  eq('빈 값 0초', yt.parseDurationSec(''), 0);
  eq('60초는 쇼츠', yt.classifySurface(60), 'shorts');
  eq('180초도 쇼츠(2024 이후 상한)', yt.classifySurface(180), 'shorts');
  eq('181초는 롱폼', yt.classifySurface(181), 'longform');
  eq('길이 0은 롱폼 처리', yt.classifySurface(0), 'longform');

  const chJson = { items: [{ id: 'UC_A', statistics: { subscriberCount: '1234', viewCount: '56789', videoCount: '12' }, contentDetails: { relatedPlaylists: { uploads: 'UU_A' } } }] };
  const ch = yt.parseChannels(chJson)[0];
  eq('구독자 숫자 변환', ch.subscribers, 1234);
  eq('업로드 재생목록', ch.uploads_playlist, 'UU_A');
  const pl = yt.parsePlaylistItems({ items: [{ contentDetails: { videoId: 'V1', videoPublishedAt: '2026-11-10T03:00:00Z' } }, { contentDetails: {} }] });
  eq('재생목록에서 영상 ID 만', pl.length, 1);
  const vids = yt.parseVideos({ items: [{ id: 'V1', snippet: { title: 't', publishedAt: '2026-11-10T03:00:00Z' }, statistics: { viewCount: '100', likeCount: '7', commentCount: '2' }, contentDetails: { duration: 'PT30S' } }] });
  eq('영상 지표', vids[0].views + '/' + vids[0].likes + '/' + vids[0].comments + '/' + vids[0].duration_sec, '100/7/2/30');

  /* ───────── 3. 유튜브 수집 ───────── */
  console.log('[3] 유튜브 — 쿼터 설계 · 기간 필터');
  {
    const now = new Date('2026-11-19T00:00:00Z');
    const f = fakeFetch([
      { test: '/channels', reply: { body: { items: [{ id: 'UC_A', statistics: { subscriberCount: '10', viewCount: '1000' }, contentDetails: { relatedPlaylists: { uploads: 'UU_A' } } }] } } },
      { test: '/playlistItems', reply: { body: { items: [
        { contentDetails: { videoId: 'V1', videoPublishedAt: '2026-11-12T00:00:00Z' } },
        { contentDetails: { videoId: 'V2', videoPublishedAt: '2026-10-01T00:00:00Z' } }
      ] } } },
      { test: '/videos', reply: { body: { items: [{ id: 'V1', snippet: { title: 'a', publishedAt: '2026-11-12T00:00:00Z' }, statistics: { viewCount: '500', likeCount: '5', commentCount: '1' }, contentDetails: { duration: 'PT20S' } }] } } }
    ]);
    const out = await yt.collectYoutube({ apiKey: 'KEY', channels: [{ brand: 'b1', channel_id: 'UC_A' }], fetchImpl: f, now, windowDays: 45 });
    eq('채널 1 + 재생목록 1 + 영상 1 = 3회', f.calls.length, 3);
    eq('기간 밖 영상은 요청하지 않는다', out.videos.length, 1);
    eq('20초 영상은 쇼츠', out.videos[0].surface, 'shorts');
    eq('브랜드가 따라온다', out.videos[0].brand, 'b1');
    ok('키는 URL 에만 들어가고 결과에는 남지 않는다', !JSON.stringify(out).includes('KEY='), out.videos[0]);
    let noKey = null;
    try { await yt.collectYoutube({ channels: [{ channel_id: 'UC_A' }] }); } catch (e) { noKey = e; }
    eq('키 없으면 ERR_NO_API_KEY', noKey && noKey.code, 'ERR_NO_API_KEY');
  }

  /* ───────── 4. 인스타 ───────── */
  console.log('[4] 인스타 — 표면 분기 · 인사이트 · 토큰');
  eq('REELS → reels', ig.surfaceOf({ media_product_type: 'REELS' }), 'reels');
  eq('CAROUSEL_ALBUM → feed', ig.surfaceOf({ media_product_type: 'CAROUSEL_ALBUM' }), 'feed');
  eq('값 없음도 feed', ig.surfaceOf({}), 'feed');
  const parsed = ig.parseMedia({ data: [
    { id: 'M1', media_product_type: 'REELS', timestamp: '2026-11-15T02:00:00Z', like_count: 12, comments_count: 3 },
    { id: 'M2', media_product_type: 'IMAGE', timestamp: '2026-11-16T02:00:00Z', like_count: 4 }
  ] });
  eq('미디어 2건', parsed.length, 2);
  eq('릴스/피드 표면', parsed[0].surface + '/' + parsed[1].surface, 'reels/feed');
  const ins = ig.parseInsights({ data: [{ name: 'reach', values: [{ value: 900 }] }, { name: 'saved', values: [{ value: 30 }] }] });
  eq('인사이트 파싱', ins.reach + '/' + ins.saved, '900/30');
  ok('릴스는 views 지표를 요청한다', /views/.test(ig.insightsUrl('M1', 'reels', 'T')), ig.insightsUrl('M1', 'reels', 'T'));
  ok('피드는 views 를 요청하지 않는다', !/views/.test(ig.insightsUrl('M2', 'feed', 'T')));

  {
    const now = new Date('2026-11-19T00:00:00Z');
    const f = fakeFetch([
      { test: /\/media\?/, reply: { body: { data: [{ id: 'M1', media_product_type: 'REELS', timestamp: '2026-11-17T00:00:00Z', like_count: 10, comments_count: 2 }] } } },
      { test: /M1\/insights/, reply: { body: { data: [{ name: 'views', values: [{ value: 1500 }] }, { name: 'reach', values: [{ value: 1200 }] }, { name: 'saved', values: [{ value: 40 }] }, { name: 'shares', values: [{ value: 9 }] }] } } }
    ]);
    const out = await ig.collectInstagram({ igUserId: 'IGU', token: 'TOK', fetchImpl: f, now });
    eq('미디어 1 + 인사이트 1', f.calls.length, 2);
    eq('조회 1500 · 저장 40', out.media[0].insight.views + '/' + out.media[0].insight.saved, '1500/40');

    const f2 = fakeFetch([
      { test: /\/media\?/, reply: { body: { data: [{ id: 'M9', media_product_type: 'IMAGE', timestamp: '2026-11-17T00:00:00Z' }] } } },
      { test: /M9\/insights/, reply: { status: 400, body: { error: { message: 'unsupported metric', status: 'BAD_REQUEST' } } } }
    ]);
    const out2 = await ig.collectInstagram({ igUserId: 'IGU', token: 'TOK', fetchImpl: f2, now });
    ok('인사이트 실패해도 미디어 행은 남는다', out2.media.length === 1 && out2.media[0].insight_error, out2.media[0]);
    eq('실패 목록에 남긴다', out2.insightsErrors.length, 1);
  }
  const n1 = ig.tokenNotice('2026-11-22T00:00:00Z', new Date('2026-11-19T00:00:00Z'));
  eq('만료 3일 전 경고', n1.level, 'soon');
  const n2 = ig.tokenNotice('2026-11-01T00:00:00Z', new Date('2026-11-19T00:00:00Z'));
  eq('만료 지남', n2.level, 'expired');

  /* ───────── 5. 정규화 ───────── */
  console.log('[5] 정규화 — 시점·KST·중복키');
  const now = new Date('2026-11-19T03:00:00Z'); // KST 11-19 12:00
  eq('KST 날짜', nz.kstDate(now), '2026-11-19');
  eq('KST ISO', nz.kstIso(now), '2026-11-19T12:00:00+09:00');
  eq('7일 전 = D7', nz.checkpointFor('2026-11-12T00:00:00Z', now), 'D7');
  eq('1일 전 = D1', nz.checkpointFor('2026-11-18T00:00:00Z', now), 'D1');
  eq('3일 전 = LATEST', nz.checkpointFor('2026-11-16T00:00:00Z', now), 'LATEST');
  eq('발행일 없음 = LATEST', nz.checkpointFor('', now), 'LATEST');

  const row = nz.normalizeYoutubeVideo({ video_id: 'V1', published_at: '2026-11-12T00:00:00Z', surface: 'shorts', views: 1200, likes: 30, comments: 4 }, { link: { brand: 'b', content_id: 'C1' }, now });
  eq('행 표면·시점·수집일', row.channel + '/' + row.checkpoint + '/' + row.collected_date, 'shorts/D7/2026-11-19');
  eq('행 출처·연결', row.source + '/' + row.content_id, 'youtube/C1');
  ok('미연결이면 UNMAPPED 표시', /UNMAPPED/.test(nz.normalizeYoutubeVideo({ video_id: 'V2', surface: 'longform' }, { now }).note));
  eq('Metrics 채널 매핑(shorts)', nz.metricChannelOf('shorts'), 'shorts');
  eq('Metrics 채널 매핑(롱폼 없음)', nz.metricChannelOf('longform'), '');
  eq('중복키', nz.dedupeKey(row), 'youtube|V1|shorts|D7|2026-11-19');

  /* ───────── 6. 수익·점수 — 추정 없음 ───────── */
  console.log('[6] 수익 — 실제 값만 · 추정 모듈 제거 · 점수');
  {
    let gone = null;
    try { require('../lib/estimate'); } catch (e) { gone = e; }
    eq('추정 수익 모듈(estimate.js)은 없다', gone && gone.code, 'MODULE_NOT_FOUND');
  }
  eq('가정 단가 표도 없다', sc.DEFAULT_RPM_KRW, undefined);
  eq('추정 함수도 없다', sc.estimateRevenue, undefined);

  const noRev = sync.applyRevenueAndScore([{ source: 'youtube', channel: 'shorts', external_id: 'V1', views: 10000, likes: 10, comments: 1, saves: 2 }], {}, {});
  eq('자료 없으면 0원', noRev[0].revenue_krw, 0);
  eq('출처도 비운다', noRev[0].revenue_source, '');
  ok('조회수로 수익을 만들지 않는다', noRev[0].revenue_krw === 0, noRev[0]);

  const confRows = sync.applyRevenueAndScore(
    [{ source: 'instagram', channel: 'feed', external_id: 'M1', views: 0, reach: 900, likes: 40, comments: 4 }],
    { revenue: { confirmed: { M1: { krw: 150000, label: '브랜드 협찬' } } } }, {}
  );
  eq('확정 협찬액은 싣는다', confRows[0].revenue_krw, 150000);
  eq('출처 confirmed', confRows[0].revenue_source, 'confirmed');
  eq('숫자만 적어도 된다', sync.applyRevenueAndScore([{ source: 'youtube', channel: 'shorts', external_id: 'V7', views: 1 }], { revenue: { confirmed: { V7: 50000 } } }, {})[0].revenue_krw, 50000);
  eq('확정 금액 비교', sync.confirmedRevenueOf({ revenue: { confirmed: { V7: 50000 } } }, 'V7').krw, 50000);
  eq('확정 없으면 null', sync.confirmedRevenueOf({}, 'V7'), null);

  const yppRows = sync.applyRevenueAndScore([{ source: 'youtube', channel: 'longform', external_id: 'V2', views: 100, likes: 1 }], {}, { V2: 1200 });
  eq('YouTube 보고 수익', yppRows[0].revenue_krw, 1200);
  eq('출처 ypp', yppRows[0].revenue_source, 'ypp');
  eq('확정이 있으면 확정 우선', sync.applyRevenueAndScore([{ source: 'youtube', channel: 'longform', external_id: 'V2', views: 100 }], { revenue: { confirmed: { V2: 7 } } }, { V2: 1200 })[0].revenue_source, 'confirmed');

  const med = sc.mediansByChannel([{ channel: 'shorts', views: 100 }, { channel: 'shorts', views: 300 }, { channel: 'shorts', views: 200 }]);
  eq('표면 중위수', med.shorts, 200);
  const s1 = sc.performanceScore({ views: 200, likes: 10, comments: 2, saves: 3 }, { medianViews: 200 });
  const s2 = sc.performanceScore({ views: 40, likes: 0, comments: 0 }, { medianViews: 200 });
  ok('중위수 이상이 더 높은 점수', s1 > s2, { s1, s2 });
  ok('점수는 0~100', s1 <= 100 && s2 >= 0, { s1, s2 });

  /* ───────── 7. 동기화 ───────── */
  console.log('[7] 동기화 — dry-run 은 네트워크 0 · 부분 설정');
  const config = {
    tracks: {
      track_a: { brand: 'daejeon_youth', youtube: { channel_id: 'UC_A' }, instagram: { ig_user_id: 'IG_A' } },
      track_b: { brand: 'ppiyak_kimmary', youtube: { channel_id: 'UC_B' } }
    },
    collect: { window_days: 45 },
    revenue: { confirmed: { V1: { krw: 300000, label: '협찬' } } },
    links: { V1: { brand: 'daejeon_youth', content_id: 'C1' } }
  };
  {
    const f = fakeFetch([]);
    const dry = await sync.runSync({ config, env: {}, fetchImpl: f, now: new Date('2026-11-19T03:00:00Z') });
    eq('키 없으면 dry-run', dry.mode, 'dry-run');
    eq('네트워크 호출 0', f.calls.length, 0);
    eq('행도 0', dry.rows.length, 0);
    ok('빠진 키를 알려 준다', dry.plan.youtube.missing.indexOf('YOUTUBE_API_KEY') >= 0 && dry.plan.instagram.missing.indexOf('IG_ACCESS_TOKEN') >= 0, dry.plan);
  }
  {
    const f = fakeFetch([
      { test: '/channels', reply: { body: { items: [{ id: 'UC_A', statistics: { subscriberCount: '5', viewCount: '50' }, contentDetails: { relatedPlaylists: { uploads: 'UU_A' } } }] } } },
      { test: '/playlistItems', reply: { body: { items: [{ contentDetails: { videoId: 'V1', videoPublishedAt: '2026-11-12T00:00:00Z' } }] } } },
      { test: '/videos', reply: { body: { items: [{ id: 'V1', snippet: { title: 'a', publishedAt: '2026-11-12T00:00:00Z' }, statistics: { viewCount: '1000', likeCount: '5', commentCount: '1' }, contentDetails: { duration: 'PT30S' } }] } } }
    ]);
    const live = await sync.runSync({ config, env: { youtubeApiKey: 'KEY' }, fetchImpl: f, now: new Date('2026-11-19T03:00:00Z') });
    eq('유튜브만 있어도 live', live.mode, 'live');
    ok('인스타는 건너뛴다고 알린다', live.notices.some((n) => n.code === 'IG_SKIPPED'), live.notices);
    ok('채널 요약 + 영상 행', live.rows.length === 2, live.rows.map((r) => r.channel));
    const v = live.rows.find((r) => r.channel === 'shorts');
    eq('연결된 카드', v.content_id, 'C1');
    eq('D7 스냅샷', v.checkpoint, 'D7');
    eq('확정 협찬액만 싣는다(조회수 계산 없음)', v.revenue_krw, 300000);
    eq('수익 출처 confirmed', v.revenue_source, 'confirmed');
    ok('추정 표시 필드는 더 이상 없다', v.revenue_estimated === undefined && v.rpm_assumed === undefined, v);
    ok('점수 계산됨', v.score > 0, v.score);
  }
  {
    /* 수익창출 채널 + OAuth 토큰 — YouTube 가 보고한 수익만 싣는다 */
    const cfgY = { tracks: { track_a: { brand: 'daejeon_youth', youtube: { channel_id: 'UC_A', monetized: true } } }, collect: { window_days: 45 } };
    const f = fakeFetch([
      { test: '/channels', reply: { body: { items: [{ id: 'UC_A', statistics: { subscriberCount: '5' }, contentDetails: { relatedPlaylists: { uploads: 'UU_A' } } }] } } },
      { test: '/playlistItems', reply: { body: { items: [{ contentDetails: { videoId: 'V1', videoPublishedAt: '2026-11-18T00:00:00Z' } }] } } },
      { test: '/videos', reply: { body: { items: [{ id: 'V1', snippet: { title: 'a', publishedAt: '2026-11-18T00:00:00Z' }, statistics: { viewCount: '100' }, contentDetails: { duration: 'PT20S' } }] } } },
      { test: 'youtubeanalytics.googleapis.com', reply: { body: { columnHeaders: [{ name: 'video' }, { name: 'estimatedRevenue' }], rows: [['V1', 1234.6], ['V9', 500]] } } }
    ]);
    const live = await sync.runSync({ config: cfgY, env: { youtubeApiKey: 'KEY', youtubeOAuthToken: 'OAUTH' }, fetchImpl: f, now: new Date('2026-11-19T03:00:00Z') });
    const v = live.rows.find((r) => r.external_id === 'V1');
    eq('YouTube 보고 수익을 싣는다', v.revenue_krw, 1235);
    eq('수익 출처 ypp', v.revenue_source, 'ypp');
    const call = f.calls.find((u) => /youtubeanalytics/.test(u)) || '';
    ok('보고 수익 지표를 요청한다', /estimatedRevenue/.test(call), call);
    ok('통화는 KRW 로 고정해 받는다(환산 없음)', /currency=KRW/.test(call), call);
    ok('수익이 붙었다고 공지한다', live.notices.some((n) => n.code === 'YT_REVENUE'), live.notices);
  }

  /* ───────── 8. 적재 페이로드 ───────── */
  console.log('[8] GAS 페이로드 — 200건 묶음 · 고정 멱등키');
  const rows = [];
  for (let i = 0; i < 450; i++) rows.push({ source: 'youtube', external_id: 'V' + i, channel: 'shorts', checkpoint: 'LATEST', collected_date: '2026-11-19', views: i });
  const chunks = sync.toGasPayload(rows, { date: '2026-11-19' });
  eq('450건 → 9묶음(50건씩)', chunks.length, 9);
  eq('첫 묶음 50', chunks[0].items.length, 50);
  eq('끝 묶음 50', chunks[8].items.length, 50);
  eq('멱등키는 날짜·순번', chunks[0].idempotency_key, 'AND-20261119-001');
  eq('멱등키 재현성', sync.toGasPayload(rows, { date: '2026-11-19' })[0].idempotency_key, chunks[0].idempotency_key);

  /* ───────── 9. GAS 전송 ───────── */
  console.log('[9] GAS 전송 — 본문 토큰 · text/plain');
  {
    const sent = [];
    const f = async (url, opts) => {
      sent.push({ url, opts, body: JSON.parse(opts.body) });
      return { status: 200, body: { ok: true, meta: { server_ms: 12 } } };
    };
    const pushed = await sync.pushToGas([{ idempotency_key: 'AND-20261119-001', items: [rows[0]] }], { url: 'https://script.google.com/macros/s/TEST/exec', token: 'SECRET_TOKEN', fetchImpl: f });
    eq('1묶음 성공', pushed[0].ok, true);
    eq('액션 이름', sent[0].body.action, 'ingest_analytics');
    eq('토큰은 본문에만', sent[0].body.auth_token, 'SECRET_TOKEN');
    ok('token 은 URL 에 없다', !/SECRET_TOKEN/.test(sent[0].url), sent[0].url);
    ok('text/plain 으로 보낸다(CORS 회피)', /text\/plain/.test(sent[0].opts.headers['Content-Type']));
    ok('결과에 토큰이 새지 않는다', !JSON.stringify(pushed).includes('SECRET_TOKEN'));
  }

  /* ───────── 10. 화면 요약 로직 ───────── */
  console.log('[10] 화면 요약 — 최신값 중복 제거 · 이번 주 합계');
  {
    const path = require('path');
    const view = await import('file://' + path.join(__dirname, '..', '..', '..', 'js', 'analyticsView.js'));
    const rows = [
      { source: 'youtube', channel: 'shorts', external_id: 'V1', collected_at: '2026-11-18T12:00:00+09:00', collected_date: '2026-11-18', views: 100, revenue_krw: 0, revenue_source: '', note: '' },
      { source: 'youtube', channel: 'shorts', external_id: 'V1', collected_at: '2026-11-19T12:00:00+09:00', collected_date: '2026-11-19', views: 300, revenue_krw: 0, revenue_source: '', note: '' },
      { source: 'youtube', channel: 'shorts', external_id: 'V3', collected_at: '2026-11-16T12:00:00+09:00', collected_date: '2026-11-16', views: 500, revenue_krw: 0, revenue_source: '', note: '' },
      { source: 'youtube', channel: 'shorts', external_id: 'V3', collected_at: '2026-11-19T12:00:00+09:00', collected_date: '2026-11-19', views: 560, revenue_krw: 0, revenue_source: '', note: '' },
      { source: 'youtube', channel: 'longform', external_id: 'V2', collected_at: '2026-11-19T12:00:00+09:00', collected_date: '2026-11-19', views: 50, revenue_krw: 125, revenue_source: 'ypp', note: 'UNMAPPED' },
      { source: 'youtube', channel: 'channel', external_id: 'UC_A', collected_at: '2026-11-19T12:00:00+09:00', collected_date: '2026-11-19', subscribers: 321, note: 'CHANNEL_SUMMARY' },
      { source: 'instagram', channel: 'reels', external_id: 'M1', collected_at: '2026-11-19T12:00:00+09:00', collected_date: '2026-11-19', reach: 900, saves: 10, revenue_krw: 0, revenue_source: '', note: '' },
      { source: 'instagram', channel: 'feed', external_id: 'M2', collected_at: '2026-11-19T12:00:00+09:00', collected_date: '2026-11-19', reach: 400, revenue_krw: 90000, revenue_source: 'unknown', note: '' }
    ];
    const latest = view.latestRows(rows);
    eq('같은 영상은 최신 한 건만', latest.filter((r) => r.external_id === 'V1').length, 1);
    eq('최신 조회는 큰 쪽', latest.find((r) => r.external_id === 'V1').views, 300);
    const s = view.summarizeRows(rows, { since: '2026-11-17' });
    eq('이번 주 늘어난 유튜브 조회(V1 300 + V3 60 + V2 50)', s.youtubeWeekViews, 410);
    eq('이번 주 인스타 도달', s.instagramWeekReach, 1300);
    eq('실제 수익 합(출처 있는 것만)', s.revenueKrw, 125);
    ok('수익 출처는 ypp 하나', s.revenueSources.join(',') === 'ypp', s.revenueSources);
    ok('추정 플래그는 없다', s.revenueIsEstimate === undefined, s.revenueIsEstimate);
    eq('미연결 건수', s.unmapped, 1);
    eq('구독자', s.subscribers, 321);
    const flatOnly = view.summarizeRows([
      { source: 'youtube', channel: 'shorts', external_id: 'OLD', collected_at: '2026-11-13T00:00:00+09:00', collected_date: '2026-11-13', views: 5000, note: '' },
      { source: 'youtube', channel: 'shorts', external_id: 'OLD', collected_at: '2026-11-16T00:00:00+09:00', collected_date: '2026-11-16', views: 5000, note: '' },
      { source: 'youtube', channel: 'shorts', external_id: 'OLD', collected_at: '2026-11-19T00:00:00+09:00', collected_date: '2026-11-19', views: 5000, note: '' }
    ], { since: '2026-11-17' });
    eq('안 늘었으면 0 (누적 재합산 없음)', flatOnly.youtubeWeekViews, 0);
    ok('표면 표는 쇼츠·롱폼·릴스·피드', s.channels.map((c) => c.channel).join(',') === 'shorts,longform,reels,feed', s.channels.map((c) => c.channel));
  }

  /* ───────── 11. 주소 → ID 정규화 ───────── */
  console.log('[11] 외부ID 정규화 — 공유 주소의 ?si= · ?igsh= 제거');
  {
    const ids = require('../lib/ids');
    eq('youtu.be + ?si=', ids.youtubeIdOf('https://youtu.be/abc123XYZ_-?si=Q1w2E3'), 'abc123XYZ_-');
    eq('shorts 주소', ids.youtubeIdOf('https://www.youtube.com/shorts/abc123XYZ_-?feature=share'), 'abc123XYZ_-');
    eq('watch 주소', ids.youtubeIdOf('https://www.youtube.com/watch?v=abc123XYZ_-&t=10s'), 'abc123XYZ_-');
    eq('순수 ID', ids.youtubeIdOf('abc123XYZ_-'), 'abc123XYZ_-');
    eq('유튜브 아닌 주소', ids.youtubeIdOf('https://blog.naver.com/x'), '');
    eq('인스타 permalink 키', ids.instagramKeyOf('https://www.instagram.com/reel/Cxyz123/?igsh=abc'), 'instagram.com/reel/Cxyz123');
    eq('인스타 /reels/ 도 reel 로', ids.instagramKeyOf('https://instagram.com/reels/Cxyz123'), 'instagram.com/reel/Cxyz123');

    const linker = ids.createLinker({
      links: {
        'https://www.youtube.com/shorts/abc123XYZ_-?si=track': { brand: 'b', content_id: 'C9' },
        'https://www.instagram.com/p/POST1/?igsh=zz': { brand: 'b', content_id: 'C10' }
      }
    });
    eq('주소로 넣은 유튜브 링크도 ID 로 찾는다', linker('abc123XYZ_-', {}).content_id, 'C9');
    eq('인스타는 permalink 로 찾는다', linker('17900000000000000', { permalink: 'https://www.instagram.com/p/POST1/' }).content_id, 'C10');
    eq('없으면 연결 없음', linker('nope', {}).content_id, '');
  }
  {
    const VID = 'vid00000001';
    const cfg = Object.assign({}, config, { links: { ['https://youtu.be/' + VID + '?si=zzz']: { brand: 'daejeon_youth', content_id: 'C1' } } });
    const f = fakeFetch([
      { test: '/channels', reply: { body: { items: [{ id: 'UC_A', statistics: { subscriberCount: '5' }, contentDetails: { relatedPlaylists: { uploads: 'UU_A' } } }] } } },
      { test: '/playlistItems', reply: { body: { items: [{ contentDetails: { videoId: VID, videoPublishedAt: '2026-11-18T00:00:00Z' } }] } } },
      { test: '/videos', reply: { body: { items: [{ id: VID, snippet: { title: 'a', publishedAt: '2026-11-18T00:00:00Z' }, statistics: { viewCount: '10' }, contentDetails: { duration: 'PT20S' } }] } } }
    ]);
    const live = await sync.runSync({ config: cfg, env: { youtubeApiKey: 'KEY' }, fetchImpl: f, now: new Date('2026-11-19T03:00:00Z') });
    eq('설정에 공유 주소로 넣어도 카드가 붙는다', live.rows.find((r) => r.channel === 'shorts').content_id, 'C1');
  }

  console.log('\n' + (failed ? '❌ 실패 ' + failed + '건 / 통과 ' + passed + '건' : '✅ 전부 통과 ' + passed + '건'));
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
