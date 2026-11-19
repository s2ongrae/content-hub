// gas/test/run.js — content-hub GAS 를 가짜 구글 환경에서 실제로 돌려 보는 시험.
// 사용: node gas/test/run.js      (외부 패키지 없음, 실제 구글 호출 없음)
//
// 대상: 2026-11-18 O4 — gas/Orders.gs 의 list_drive_media · hub_order
//   · 드라이브 폴더 링크 파싱 · 파일 목록(종류·정렬·100개/15초 컷)
//   · 큐 프록시(토큰은 스크립트 속성에만 · 허용 타입 4종 · 30초 가드)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KST_OFFSET_MIN = 9 * 60;
const pad = (n, w = 2) => String(n).padStart(w, '0');

function formatDate(date, tz, fmt) {
  const d = new Date(date.getTime() + KST_OFFSET_MIN * 60 * 1000);
  const map = {
    yyyy: d.getUTCFullYear(), MM: pad(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds())
  };
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss|XXX/g, t => (t === 'XXX' ? '+09:00' : map[t])).replace(/'/g, '');
}

class FakeFile {
  constructor(name, mime, size, created) {
    this.id = 'file_' + name.replace(/[^A-Za-z0-9]/g, '_');
    this.name = name; this.mime = mime; this.size = size; this.created = created || new Date();
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getMimeType() { return this.mime; }
  getSize() { return this.size; }
  getDateCreated() { return this.created; }
  getLastUpdated() { return this.created; }
}

class FakeFolder {
  constructor(id, name, files) { this.id = id; this.name = name; this.files = files || []; }
  getName() { return this.name; }
  getId() { return this.id; }
  getFiles() {
    const list = this.files.slice();
    let i = 0;
    return { hasNext: () => i < list.length, next: () => list[i++] };
  }
}

function makeEnv() {
  const props = new Map();
  const cache = new Map();
  const folders = new Map();
  const fetched = [];
  let fetchReply = { code: 200, body: JSON.stringify({ ok: true, item: { id: 'Q-20261118-120000-test', status: 'PENDING' }, note: '접수했어요' }) };
  let nowShift = 0;

  const gas = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => null, getSheets: () => [] })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        getProperties: () => Object.fromEntries(props)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      formatDate,
      getUuid: () => require('crypto').randomUUID(),
      computeDigest: (alg, s) => Array.from(require('crypto').createHash('sha256').update(String(s === undefined ? '' : s), 'utf8').digest()),
      base64EncodeWebSafe: b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      newBlob: s => ({ getBytes: () => Array.from(Buffer.from(String(s), 'utf8')) }),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => {
        const out = { _text: text, getContent: () => out._text };
        out.setMimeType = () => out;
        return out;
      }
    },
    DriveApp: {
      getFolderById: id => {
        if (!folders.has(id)) throw new Error('폴더 없음: ' + id);
        return folders.get(id);
      }
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        fetched.push({ url, opts, body: JSON.parse(opts.payload) });
        if (fetchReply.throw) throw new Error(fetchReply.throw);
        const reply = fetchReply;
        return {
          getResponseCode: () => reply.code,
          getContentText: () => reply.body
        };
      }
    },
    Logger: { log: () => {} }
  };
  return {
    gas, props, cache, folders, fetched,
    setFetchReply(r) { fetchReply = r; },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [Date.now() + nowShift])); } static now() { return Date.now() + nowShift; } }
  };
}

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

const eq = (name, actual, expected) => ok(name, actual === expected, { actual, expected });

function loadGas() {
  const env = makeEnv();
  // Apps Script 는 모든 파일을 한 스코프로 올리지만, vm 은 파일 단위로 평가한다 →
  // Code.gs 의 M1_HANDLERS 가 핸들러를 참조하므로 Orders.gs 를 먼저 올린다.
  const files = ['Setup.gs', 'Auth.gs', 'Backup.gs', 'Notify.gs', 'Onboarding.gs', 'Orders.gs', 'Blog.gs', 'Analytics.gs', 'PostDetail.gs', 'Code.gs'];
  const sandbox = Object.assign({ console, Date: env.Date }, env.gas);
  vm.createContext(sandbox);
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    vm.runInContext(src, sandbox, { filename: f });
  }
  return { ctx: sandbox, env };
}

/** 핸들러가 던지는 AppError 를 {code, message} 로 받아 본다. */
/** top-level const 는 vm 전역 객체에 안 붙는다 → 컨텍스트 안에서 평가해 꺼낸다. */
function ev(ctx, expr) { return vm.runInContext(expr, ctx); }

function callHandler(ctx, name, ...args) {
  try {
    return { ok: true, data: ctx[name](...args) };
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message };
  }
}

console.log('\n[1] 화이트리스트 · 라우터 등록');
const A = loadGas();
eq('list_drive_media 는 읽기', ev(A.ctx,'ACTION_WHITELIST').list_drive_media.mode, 'READ');
eq('hub_order 는 쓰기(감사 기록)', ev(A.ctx,'ACTION_WHITELIST').hub_order.mode, 'WRITE');
ok('hub_order 는 라우터 락을 잡지 않는다(30초 외부 호출)', ev(A.ctx,'ACTION_WHITELIST').hub_order.longRunning === true);
ok('핸들러 2개가 등록됨', typeof ev(A.ctx,'M1_HANDLERS').list_drive_media === 'function' && typeof ev(A.ctx,'M1_HANDLERS').hub_order === 'function');

console.log('\n[2] 드라이브 폴더 링크 파싱');
eq('폴더 URL', A.ctx.driveFolderIdFrom_('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz01234'), '1AbCdEfGhIjKlMnOpQrStUvWxYz01234');
eq('open?id', A.ctx.driveFolderIdFrom_('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz01234'), '1AbCdEfGhIjKlMnOpQrStUvWxYz01234');
eq('ID 만', A.ctx.driveFolderIdFrom_('1AbCdEfGhIjKlMnOpQrStUvWxYz01234'), '1AbCdEfGhIjKlMnOpQrStUvWxYz01234');
eq('사용자 폴더(내 드라이브) 링크는 ID 없음', A.ctx.driveFolderIdFrom_('https://drive.google.com/drive/my-drive'), '');
eq('빈 값', A.ctx.driveFolderIdFrom_('   '), '');

console.log('\n[3] 드라이브 폴더 읽기');
const FOLDER_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz01234';
A.env.folders.set(FOLDER_ID, new FakeFolder(FOLDER_ID, '미미삼겹', [
  new FakeFile('표지.jpg', 'image/jpeg', 2048),
  new FakeFile('b_불판.mp4', 'video/mp4', 9000000),
  new FakeFile('a_간판.jpg', 'image/jpeg', 1024),
  new FakeFile('메모.txt', 'text/plain', 10)
]));
let r = callHandler(A.ctx, 'handleListDriveMedia_', null, { folder_url: 'https://drive.google.com/drive/folders/' + FOLDER_ID });
ok('폴더를 읽는다', r.ok, r);
ok('파일 4개', r.ok && r.data.count === 4, r.data && r.data.count);
eq('이름 순 정렬', r.ok && r.data.items.map(x => x.name).join(','), 'a_간판.jpg,b_불판.mp4,메모.txt,표지.jpg');
eq('영상 구분', r.ok && r.data.items.filter(x => x.kind === 'VIDEO').length, 1);
eq('사진 구분', r.ok && r.data.items.filter(x => x.kind === 'IMAGE').length, 2);
eq('그 밖(문서) 구분', r.ok && r.data.items.filter(x => x.kind === 'OTHER').length, 1);
ok('파일 ID·크기·촬영시각을 함께 준다', r.ok && r.data.items[0].id && r.data.items[0].size === 1024 && /^2026-/.test(r.data.items[0].created_at), r.data && r.data.items[0]);
ok('truncated=false', r.ok && r.data.truncated === false);
ok('가로/세로는 못 읽는다고 밝힌다', r.ok && /가로\/세로/.test(r.data.note), r.data && r.data.note);

r = callHandler(A.ctx, 'handleListDriveMedia_', null, {});
eq('링크가 없으면 ERR_NO_FOLDER', r.code, 'ERR_NO_FOLDER');
r = callHandler(A.ctx, 'handleListDriveMedia_', null, { folder_url: 'https://drive.google.com/drive/my-drive' });
eq('ID 를 못 찾으면 ERR_NO_FOLDER', r.code, 'ERR_NO_FOLDER');
r = callHandler(A.ctx, 'handleListDriveMedia_', null, { folder_url: 'https://drive.google.com/drive/folders/1ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ' });
eq('없는/권한 없는 폴더도 ERR_NO_FOLDER', r.code, 'ERR_NO_FOLDER');

console.log('\n[4] 100개 · 15초 컷');
const many = [];
for (let i = 0; i < 130; i++) many.push(new FakeFile('img_' + pad(i, 3) + '.jpg', 'image/jpeg', 1000));
const BIG = '1BIGBIGBIGBIGBIGBIGBIGBIGBIG1234';
A.env.folders.set(BIG, new FakeFolder(BIG, '많음', many));
r = callHandler(A.ctx, 'handleListDriveMedia_', null, { folder_url: BIG });
eq('최대 100개까지만', r.ok && r.data.count, 100);
ok('잘렸다고 알린다', r.ok && r.data.truncated === true && /일부만/.test(r.data.note), r.data && r.data.note);

console.log('\n[5] 오더 지시문');
const prompt = A.ctx.hubOrderPrompt_('content_render', {
  place_name: '미미삼겹', channel: 'shorts', slot_count: 7,
  user_body_sha256: 'abcdef0123456789deadbeef', tone_seed: 'seeds/skills/tone_reference_v1.md'
});
ok('첫 줄에 논리 타입·장소', /^\[콘텐츠 허브 오더 · content_render\] 미미삼겹 · shorts/.test(prompt), prompt.split('\n')[0]);
ok('슬롯·해시·톤 시드', /슬롯 7개/.test(prompt) && /abcdef0123456789/.test(prompt) && /tone_reference_v1/.test(prompt));
ok('렌더 도구 없으면 BLOCKED 안내', /BLOCKED: NEED/.test(prompt));
ok('커밋·원격 반영 금지 규칙', /커밋·원격 반영은 하지 않는다/.test(prompt));
ok('2,000자 이내', prompt.length <= 2000, prompt.length);
const longPlace = '가'.repeat(3000);
ok('너무 긴 입력도 2,000자로 자른다', A.ctx.hubOrderPrompt_('content_render', { place_name: longPlace }).length <= 2000);

console.log('\n[6] 오더 프록시 — 설정이 없으면 분명히 실패');
let o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render' }, { brand: 'daejeon_youth' });
eq('QUEUE_EXEC_URL 없음', o.code, 'ERR_SERVER_CONFIG');
A.env.props.set('QUEUE_EXEC_URL', 'https://example.com/not-gas');
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render' }, { brand: 'daejeon_youth' });
eq('큐 주소 형식이 아니면 거부', o.code, 'ERR_SERVER_CONFIG');
A.env.props.set('QUEUE_EXEC_URL', 'https://script.google.com/macros/s/AKfycbTESTTESTTESTTESTTESTTESTTESTTEST/exec');
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render' }, { brand: 'daejeon_youth' });
eq('QUEUE_TOKEN 없음', o.code, 'ERR_SERVER_CONFIG');

console.log('\n[7] 오더 프록시 — 허용 타입 · 큐 전달');
A.env.props.set('QUEUE_TOKEN', 'portal-key-for-test-0123456789abcdef');
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'no_such_type' }, { brand: 'daejeon_youth' });
eq('허용 밖 타입 거부', o.code, 'ERR_INVALID_ACTION');
eq('허용 타입 4종', ev(A.ctx,'HUB_ORDER_TYPES').join(','), 'content_render,content_upload,content_stats,blog_neighbor');
ok('큐를 부르지 않았다', A.env.fetched.length === 0);

o = callHandler(A.ctx, 'handleHubOrder_', null, {
  type: 'content_render', channel: 'shorts', place_name: '미미삼겹', slot_count: 7,
  user_body_sha256: 'abc123', tone_seed: 'seeds/skills/tone_reference_v1.md'
}, { brand: 'daejeon_youth' });
ok('오더 접수', o.ok, o);
eq('오더 id 를 돌려준다', o.ok && o.data.order_id, 'Q-20261118-120000-test');
eq('논리 타입을 응답에 남긴다', o.ok && o.data.type, 'content_render');
const sent = A.env.fetched[0];
ok('큐 본문은 queue_enqueue', sent && sent.body.action === 'queue_enqueue');
eq('큐 타입은 claude_prompt', sent.body.type, 'claude_prompt');
eq('워크스페이스 기본 content-hub', sent.body.workspace, 'content-hub');
eq('mode=edit', sent.body.payload.mode, 'edit');
eq('엔진 기본 auto', sent.body.payload.engine, 'auto');
ok('프롬프트에 오더 내용', /content_render/.test(sent.body.payload.prompt) && /미미삼겹/.test(sent.body.payload.prompt));
ok('큐 토큰은 본문에만, 응답에는 없다', sent.body.key === 'portal-key-for-test-0123456789abcdef' && !JSON.stringify(o.data).includes('portal-key'));
ok('text/plain 으로 보낸다(CORS 회피)', /text\/plain/.test(sent.opts.contentType));
ok('외부 실패를 삼키지 않는다(muteHttpExceptions)', sent.opts.muteHttpExceptions === true);

A.env.props.set('QUEUE_WORKSPACE', 'content-hub');
A.env.props.set('QUEUE_ENGINE', 'freellmapi');
callHandler(A.ctx, 'handleHubOrder_', null, { type: 'blog_neighbor' }, { brand: 'daejeon_youth' });
const sent2 = A.env.fetched[A.env.fetched.length - 1];
eq('엔진 설정을 따른다', sent2.body.payload.engine, 'freellmapi');

console.log('\n[8] 큐가 거절·장애일 때');
A.env.setFetchReply({ code: 200, body: JSON.stringify({ ok: false, error: { code: 'busy', message: '다른 저장이 진행 중이에요' } }) });
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render' }, { brand: 'daejeon_youth' });
eq('큐 거절은 ERR_QUEUE_REJECTED', o.code, 'ERR_QUEUE_REJECTED');
ok('거절 사유를 그대로 보여준다', /다른 저장/.test(o.message || ''), o.message);
A.env.setFetchReply({ code: 200, body: JSON.stringify({ ok: false, error: 'unauthorized' }) });
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render' }, { brand: 'daejeon_youth' });
eq('문자열 오류도 ERR_QUEUE_REJECTED', o.code, 'ERR_QUEUE_REJECTED');
ok('문자열 오류에 맞는 안내를 붙인다', /QUEUE_TOKEN/.test(o.message || ''), o.message);
A.env.setFetchReply({ code: 200, body: JSON.stringify({ ok: false, error: '작업 위치가 허용 목록에 없어요', code: 'workspace' }) });
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render' }, { brand: 'daejeon_youth' });
ok('워크스페이스 거절은 무엇을 고칠지 알려준다', /QUEUE_WORKSPACE/.test(o.message || ''), o.message);
A.env.setFetchReply({ code: 200, body: '<html>로그인 페이지</html>' });
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render' }, { brand: 'daejeon_youth' });
eq('JSON 이 아니면 ERR_QUEUE_UNREACHABLE', o.code, 'ERR_QUEUE_UNREACHABLE');
A.env.setFetchReply({ throw: 'DNS 실패' });
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render' }, { brand: 'daejeon_youth' });
eq('네트워크 실패도 ERR_QUEUE_UNREACHABLE', o.code, 'ERR_QUEUE_UNREACHABLE');
ok('토큰이 오류 문구에 새지 않는다', !/portal-key/.test(o.message || ''), o.message);

/* ───────── 내 블로그 보기 (gas/Blog.gs, 2026-11-19) ───────── */

/** 시트 흉내 — getRange(r,c,nr,nc).getValues/setValues 만 지원 */
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  setFrozenRows() {}
  getRange(r, c, nr, nc) {
    const sh = this; nr = nr || 1; nc = nc || 1;
    const rng = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
        const row = sh.rows[r - 1 + i] || []; const v = row[c - 1 + j]; return v === undefined ? '' : v; })),
      setValues: (vals) => { vals.forEach((row, i) => { const t = sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || [];
        row.forEach((v, j) => { t[c - 1 + j] = v; }); }); return rng; },
      setBackground: () => rng, setFontColor: () => rng, setFontWeight: () => rng
    };
    return rng;
  }
}
class FakeSS {
  constructor() { this.sheets = new Map(); }
  getSheetByName(n) { return this.sheets.get(n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.set(n, s); return s; }
  getSheets() { return Array.from(this.sheets.values()); }
}

const POST_LIST = (items) => JSON.stringify({ isSuccess: true, result: { page: 1, items } });
const item = (logNo, c, s, add) => ({ logNo, titleWithInspectMessage: '[대전 봉명동 맛집] 시험 &#x27;글&#x27; ' + logNo,
  commentCnt: c, sympathyCnt: s, shareCnt: 0, categoryName: '[ 청 년 술 상 ]', thumbnailCount: 7, addDate: add, allOpenPost: true });
const VISITOR_XML = '<visitorcnts><visitorcnt id="20261117" cnt="21" /><visitorcnt id="20261118" cnt="37" /></visitorcnts>';

const B = loadGas();
const routes = [];
let netReply = {};
B.ctx.UrlFetchApp = { fetch: (url, opts) => {
  routes.push({ url, opts });
  const key = Object.keys(netReply).find(k => url.indexOf(k) >= 0);
  const r = key ? netReply[key] : { code: 404, body: '' };
  if (r.throw) throw new Error(r.throw);
  return { getResponseCode: () => r.code, getContentText: () => r.body };
} };

console.log('\n[B1] 블로그 액션 등록');
const WL = ev(B.ctx, 'ACTION_WHITELIST'), HM = ev(B.ctx, 'M1_HANDLERS');
['blog_sync', 'list_blog_stats', 'blog_post_body', 'blog_rank_check'].forEach(a =>
  ok(a + ' 화이트리스트·핸들러', WL[a] && WL[a].m1 && typeof HM[a] === 'function'));
eq('목록 보기는 읽기', WL.list_blog_stats.mode, 'READ');
ok('바깥 호출하는 수집은 라우터 락을 잡지 않음', WL.blog_sync.longRunning === true && WL.blog_rank_check.longRunning === true);

console.log('\n[B2] 파서');
let posts = B.ctx.parseBlogPostList_(POST_LIST([item(224480755004, 17, 11, 1794906000000), { logNo: 'x' }]), 'youth-daejeon');
eq('잘못된 글 번호는 버린다', posts.length, 1);
eq('제목 엔티티 풀기', posts[0].title, "[대전 봉명동 맛집] 시험 '글' 224480755004");
eq('주소', posts[0].url, 'https://blog.naver.com/youth-daejeon/224480755004');
eq('발행일 KST', posts[0].published_at.slice(0, 10), '2026-11-17');
ok('댓글·공감·사진', posts[0].comment_cnt === 17 && posts[0].sympathy_cnt === 11 && posts[0].photo_count === 7);
o = callHandler(B.ctx, 'parseBlogPostList_', '<html>', 'youth-daejeon');
eq('형식이 바뀌면 조용히 0건이 아니라 오류', o.code, 'ERR_BLOG_FORMAT');
const vis = B.ctx.parseBlogVisitors_(VISITOR_XML);
ok('방문자 XML', vis.length === 2 && vis[1].day === '2026-11-18' && vis[1].visitors === 37, vis);

const HTML = '<meta property="og:title" content="og 제목"><div class="se-main-container">'
  + '<div class="se-component se-documentTitle"><p class="se-text-paragraph">[대전 봉명동 맛집] 본문 제목</p></div>'
  + '<div class="se-component se-text"><p class="se-text-paragraph"><span>안녕하세요 &amp; 반가워요</span></p><p class="se-text-paragraph"><span>​</span></p></div>'
  + '<script type="text/data" class="__se_module_data" data-module-v2=\'{"type":"v2_text"}\'></script>'
  + '<div class="se-component se-image"><img class="se-image-resource"><div class="se-caption"><p class="se-text-paragraph">사진 설명</p></div></div>'
  + '<div class="se-component se-imageGroup"><img class="se-image-resource"><img class="se-image-resource"></div>'
  + '<div class="se-component se-oglink"><a href="https://www.instagram.com/reel/abc/" class="se-oglink-info"><strong>#카드태그 새면안됨</strong></a></div>'
  + '<div class="se-component se-placesMap"><strong class="se-map-title">미미삼겹</strong><p class="se-map-address">대전광역시 유성구 문화원로 108</p></div>'
  + '<div class="se-component se-video"></div>'
  + '<div class="se-component se-text"><p class="se-text-paragraph">#대전맛집 #봉명동맛집</p></div>'
  + '</div><script>var x="<div class=\\"se-component se-text\\"><p class=\\"se-text-paragraph\\">스크립트</p>";</script>';
const pb = B.ctx.parseBlogPostBody_(HTML);
eq('제목은 본문 제목 우선', pb.title, '[대전 봉명동 맛집] 본문 제목');
eq('사진 3장(묶음 포함)', pb.photo_count, 3);
eq('영상 1개', pb.video_count, 1);
eq('링크 카드 1개', pb.link_cards, 1);
ok('링크 카드는 [LINK_CARD] 줄', /\[LINK_CARD: https:\/\/www\.instagram\.com\/reel\/abc\/\]/.test(pb.body), pb.body);
ok('카드 속 해시태그가 본문에 안 샘', !/카드태그/.test(pb.body), pb.body);
ok('지도는 이름·주소 한 줄', /미미삼겹 · 대전광역시 유성구/.test(pb.body), pb.body);
ok('빈 줄(제로폭)은 버림 · 엔티티 풀림', pb.body.split('\n')[0] === '안녕하세요 & 반가워요', pb.body);
ok('캡션도 글', /사진 설명/.test(pb.body));
ok('스크립트 안 글은 안 읽음', !/스크립트/.test(pb.body));
o = callHandler(B.ctx, 'parseBlogPostBody_', '<html>옛날 글</html>');
eq('본문 없으면 ERR_BLOG_FORMAT', o.code, 'ERR_BLOG_FORMAT');

const rk = B.ctx.findBlogRank_([{ link: 'https://blog.naver.com/other/1' }, { link: 'https://blog.naver.com/Youth-Daejeon/224480755004', title: '<b>대전</b>맛집' }], 'youth-daejeon', 0);
ok('검색 결과에서 내 글 순위', rk.rank === 2 && rk.log_no === '224480755004' && rk.title === '대전맛집', rk);
eq('없으면 0', B.ctx.findBlogRank_([{ link: 'https://blog.naver.com/x/1' }], 'youth-daejeon', 0).rank, 0);

console.log('\n[B3] 브랜드');
o = callHandler(B.ctx, 'handleBlogSync_', new FakeSS(), {}, { brand: 'ppiyak_kimmary' });
eq('김메리는 블로그 없음', o.code, 'ERR_BLOG_SKIPPED');

console.log('\n[B4] 수집 → 시트 누적 → 화면 묶음');
const ss = new FakeSS();
const contents = ss.insertSheet('Contents');
contents.rows = [['content_id', 'brand', 'blog_url', 'target_keywords'],
  ['DY-20261115-001', 'daejeon_youth', 'https://blog.naver.com/youth-daejeon/224480755004', '봉명동 냉삼, 대전 삼겹살'],
  ['KM-20261115-001', 'ppiyak_kimmary', '', '고양이 간식']];
const rankLog = ss.insertSheet('Rank_Log');
rankLog.rows = [['rank_log_id', 'brand', 'content_id', 'keyword', 'surface', 'rank_pos', 'index_status', 'bldex_grade', 'check_method', 'note', 'checked_at']];
netReply = {
  'post-list': { code: 200, body: POST_LIST([item(224480755004, 17, 11, 1794906000000), item(224462465538, 10, 13, 1793611200000)]) },
  'NVisitorgp4Ajax': { code: 200, body: VISITOR_XML }
};
let r1 = callHandler(B.ctx, 'handleBlogSync_', ss, {}, { brand: 'daejeon_youth' });
ok('수집 성공', r1.ok && r1.data.posts === 2 && r1.data.new_posts === 2 && r1.data.visitor_days === 2, r1);
eq('카드와 연결된 글 1개', r1.data && r1.data.linked_cards, 1);
ok('요청에 쿠키 없음', routes.every(x => !(x.opts.headers || {}).Cookie) && routes.some(x => /post-list/.test(x.url)));
// 같은 날 댓글이 늘어난 상태로 다시 수집 → 덮어씀
netReply['post-list'] = { code: 200, body: POST_LIST([item(224480755004, 20, 12, 1794906000000), item(224462465538, 10, 13, 1793611200000)]) };
let r2 = callHandler(B.ctx, 'handleBlogSync_', ss, {}, { brand: 'daejeon_youth' });
ok('다시 모으면 새 글 0', r2.ok && r2.data.new_posts === 0, r2);
eq('글 시트는 중복 없이 2줄', ss.getSheetByName('Blog_Posts').getLastRow(), 3);
eq('같은 날 일별 기록은 덮어씀', ss.getSheetByName('Blog_Post_Daily').getLastRow(), 3);
eq('방문자 날짜 중복 없음', ss.getSheetByName('Blog_Visitors').getLastRow(), 3);
// 7일 증가분 시험용: 3일 전 기록을 하나 넣는다
const dsh = ss.getSheetByName('Blog_Post_Daily');
const threeAgo = new Date(Date.now() - 3 * 86400000 + 9 * 3600000).toISOString().slice(0, 10);
dsh.rows.push([threeAgo, 'youth-daejeon', '224480755004', 15, 9, '']);
rankLog.rows.push(['RK-1', 'daejeon_youth', '', '봉명동 냉삼', 'naver_blog_search', 8, 'IN_TOP100', '', 'naver_openapi_sim', '224480755004', '2026-11-18T10:00:00+09:00']);
rankLog.rows.push(['RK-2', 'daejeon_youth', '', '봉명동 냉삼', 'naver_blog_search', 5, 'IN_TOP100', '', 'naver_openapi_sim', '224480755004', '2026-11-19T10:00:00+09:00']);
const st = callHandler(B.ctx, 'handleListBlogStats_', ss, { days: 365 }, { brand: 'daejeon_youth' });
ok('화면 묶음', st.ok && st.data.posts.length === 2, st);
const p1 = st.ok ? st.data.posts.find(p => p.log_no === '224480755004') : {};
ok('최근 글이 위', st.ok && st.data.posts[0].log_no === '224480755004');
ok('7일 증가분(댓글 +5 · 공감 +3)', p1.comment_7d === 5 && p1.sympathy_7d === 3, p1);
eq('카드 연결 유지', p1.content_id, 'DY-20261115-001');
ok('방문자 2일', st.ok && st.data.visitors.length === 2 && st.data.visitors[0].day === '2026-11-17', st.data && st.data.visitors);
ok('키워드 최신 순위 + 이전 순위', st.ok && st.data.ranks[0].rank === 5 && st.data.ranks[0].prev_rank === 8, st.data && st.data.ranks);
ok('키워드 힌트는 대전 청년 카드에서만', st.ok && st.data.keyword_hints.indexOf('봉명동 냉삼') >= 0 && st.data.keyword_hints.indexOf('고양이 간식') < 0, st.data && st.data.keyword_hints);
eq('검색 API 키 없음 표시', st.data && st.data.search_api_ready, false);
netReply['post-list'] = { code: 503, body: '' };
o = callHandler(B.ctx, 'handleBlogSync_', ss, {}, { brand: 'daejeon_youth' });
eq('네이버 장애는 ERR_BLOG_UNREACHABLE', o.code, 'ERR_BLOG_UNREACHABLE');

console.log('\n[B5] 본문 · 순위');
o = callHandler(B.ctx, 'handleBlogPostBody_', ss, { log_no: '../../evil' }, { brand: 'daejeon_youth' });
eq('글 번호는 숫자만(다른 주소로 못 샘)', o.code, 'ERR_VALIDATION_FAILED');
netReply['PostView'] = { code: 200, body: HTML };
o = callHandler(B.ctx, 'handleBlogPostBody_', ss, { log_no: '224480755004' }, { brand: 'daejeon_youth' });
ok('본문 가져오기', o.ok && o.data.photo_count === 3 && o.data.url === 'https://blog.naver.com/youth-daejeon/224480755004', o);
o = callHandler(B.ctx, 'handleBlogRankCheck_', ss, { keywords: ['봉명동 냉삼'] }, { brand: 'daejeon_youth' });
eq('키 없으면 ERR_NO_NAVER_KEY', o.code, 'ERR_NO_NAVER_KEY');
B.env.props.set('NAVER_CLIENT_ID', 'test-id'); B.env.props.set('NAVER_CLIENT_SECRET', 'test-secret');
netReply['openapi.naver.com'] = { code: 200, body: JSON.stringify({ total: 1200, items: [{ link: 'https://blog.naver.com/a/1' }, { link: 'https://blog.naver.com/a/2' }, { link: 'https://blog.naver.com/youth-daejeon/224480755004', title: 't' }] }) };
const before = rankLog.rows.length;
o = callHandler(B.ctx, 'handleBlogRankCheck_', ss, { keywords: '봉명동 냉삼, 대전 삼겹살,봉명동 냉삼' }, { brand: 'daejeon_youth' });
ok('순위 3위 · 키워드 중복 제거', o.ok && o.data.results.length === 2 && o.data.results[0].rank === 3, o);
eq('Rank_Log 에 2줄 추가', rankLog.rows.length - before, 2);
eq('Rank_Log 에 카드 번호 연결', rankLog.rows[rankLog.rows.length - 1][2], 'DY-20261115-001');
ok('키는 헤더로만(주소에 없음)', routes.filter(x => /openapi/.test(x.url)).every(x => !/test-secret/.test(x.url) && x.opts.headers['X-Naver-Client-Secret'] === 'test-secret'));
netReply['openapi.naver.com'] = { code: 401, body: '' };
o = callHandler(B.ctx, 'handleBlogRankCheck_', ss, { keywords: ['x'] }, { brand: 'daejeon_youth' });
ok('키가 틀리면 ERR_NO_NAVER_KEY · 비밀 안 샘', o.code === 'ERR_NO_NAVER_KEY' && !/test-secret/.test(o.message), o);
/* ───────── 유튜브·인스타 자동 수집 (gas/Analytics.gs) ───────── */
(function analyticsTests() {
  console.log('\n[A1] 자동 수집 적재 — 중복 키 · Metrics 비춤');
  const G = loadGas();
  ok('list_analytics 는 읽기', ev(G.ctx, 'ACTION_WHITELIST').list_analytics.mode === 'READ');
  ok('ingest_analytics 는 쓰기', ev(G.ctx, 'ACTION_WHITELIST').ingest_analytics.mode === 'WRITE');
  ok('핸들러 2개가 라우터에 등록됨', typeof ev(G.ctx, 'M1_HANDLERS').list_analytics === 'function' && typeof ev(G.ctx, 'M1_HANDLERS').ingest_analytics === 'function');

  const ss2 = new FakeSS();
  const metrics = new FakeSheet('Metrics');
  const metricCols = ev(G.ctx, 'SHEET_SCHEMAS').Metrics;
  metrics.getRange(1, 1, 1, metricCols.length).setValues([metricCols]);
  ss2.sheets.set('Metrics', metrics);

  const a1 = callHandler(G.ctx, 'handleIngestAnalytics_', ss2, {
    items: [
      { source: 'youtube', channel: 'shorts', external_id: 'VID1', content_id: 'DY-1', brand: 'daejeon_youth', checkpoint: 'D7', collected_at: '2026-11-19T12:00:00+09:00', views: 1200, likes: 30, comments: 4, revenue_krw: 36000, revenue_source: 'confirmed', score: 72 },
      { source: 'instagram', channel: 'feed', external_id: 'IG1', brand: 'daejeon_youth', checkpoint: 'LATEST', collected_at: '2026-11-19T12:00:00+09:00', reach: 900, likes: 40, saves: 12 }
    ]
  }, { brand: 'daejeon_youth' });
  ok('적재 성공', a1.ok, a1);
  eq('2건 삽입', a1.ok && a1.data.inserted, 2);
  eq('1건만 Metrics 로 비춤', a1.ok && a1.data.mirrored, 1);
  const sheet2 = ss2.getSheetByName('Analytics_Daily');
  ok('Analytics_Daily 시트를 스스로 만든다', !!sheet2);
  eq('23컬럼 헤더', sheet2 && sheet2.getLastColumn(), 23);
  const rows2 = sheet2.getRange(2, 1, sheet2.getLastRow() - 1, sheet2.getLastColumn()).getValues();
  eq('행 2개', rows2.length, 2);
  const header2 = sheet2.getRange(1, 1, 1, 24).getValues()[0];
  ok('수익 출처는 글자로 적힌다', String(rows2[0][header2.indexOf('revenue_source')]) === 'confirmed', rows2[0]);
  eq('Metrics 에 한 줄', metrics.getLastRow() - 1, 1);

  const a2 = callHandler(G.ctx, 'handleIngestAnalytics_', ss2, {
    items: [
      { source: 'youtube', channel: 'shorts', external_id: 'VID1', content_id: 'DY-1', brand: 'daejeon_youth', checkpoint: 'D7', collected_at: '2026-11-19T12:00:00+09:00', views: 9999 },
      { source: 'instagram', channel: 'feed', external_id: 'IG1', brand: 'daejeon_youth', checkpoint: 'LATEST', collected_at: '2026-11-19T12:00:00+09:00', reach: 1 }
    ]
  }, { brand: 'daejeon_youth' });
  eq('같은 키는 skip', a2.ok && a2.data.skipped, 2);
  eq('새 행 0', a2.ok && a2.data.inserted, 0);
  eq('Metrics 도 늘지 않는다', metrics.getLastRow() - 1, 1);

  let bad = callHandler(G.ctx, 'handleIngestAnalytics_', ss2, { items: [{ source: 'naver', channel: 'shorts', external_id: 'X' }] }, { brand: 'daejeon_youth' });
  eq('모르는 소스는 거절', bad.code, 'ERR_VALIDATION_FAILED');
  bad = callHandler(G.ctx, 'handleIngestAnalytics_', ss2, { items: [{ source: 'youtube', channel: 'blog', external_id: 'X' }] }, { brand: 'daejeon_youth' });
  eq('모르는 표면은 거절', bad.code, 'ERR_VALIDATION_FAILED');
  bad = callHandler(G.ctx, 'handleIngestAnalytics_', ss2, { items: [] }, { brand: 'daejeon_youth' });
  eq('빈 items 거절', bad.code, 'ERR_VALIDATION_FAILED');
  const many = [];
  for (let i = 0; i < 501; i++) many.push({ source: 'youtube', channel: 'shorts', external_id: 'B' + i });
  bad = callHandler(G.ctx, 'handleIngestAnalytics_', ss2, { items: many }, { brand: 'daejeon_youth' });
  eq('500건 넘으면 거절', bad.code, 'ERR_VALIDATION_FAILED');

  console.log('\n[A2] 자동 수집 조회 (list_analytics)');
  callHandler(G.ctx, 'handleIngestAnalytics_', ss2, {
    items: [
      { source: 'youtube', channel: 'longform', external_id: 'VID2', content_id: 'DY-2', brand: 'ppiyak_kimmary', collected_at: '2026-11-20T09:00:00+09:00', views: 50, note: 'UNMAPPED' },
      { source: 'youtube', channel: 'channel', external_id: 'UC_A', brand: 'ppiyak_kimmary', collected_at: '2026-11-20T09:00:00+09:00', subscribers: 321 }
    ]
  }, { brand: 'ppiyak_kimmary' });
  let list = callHandler(G.ctx, 'handleListAnalytics_', ss2, { brand: 'ALL' }, { brand: 'daejeon_youth' });
  ok('전체 조회', list.ok && list.data.count === 4, list.data && list.data.count);
  eq('소스별 건수', list.ok && list.data.summary.by_source.youtube, 3);
  eq('표면별 건수(쇼츠)', list.ok && list.data.summary.by_channel.shorts, 1);
  ok('마지막 수집 시각은 가장 큰 값', list.ok && list.data.summary.last_collected_at === '2026-11-20T09:00:00+09:00', list.data && list.data.summary);
  list = callHandler(G.ctx, 'handleListAnalytics_', ss2, { brand: 'ppiyak_kimmary' }, {});
  eq('브랜드 필터', list.ok && list.data.count, 2);
  list = callHandler(G.ctx, 'handleListAnalytics_', ss2, { brand: 'ALL', from: '2026-11-20', to: '2026-11-20' }, {});
  eq('기간 필터', list.ok && list.data.count, 2);
  list = callHandler(G.ctx, 'handleListAnalytics_', ss2, { brand: 'ALL', source: 'instagram' }, {});
  eq('소스 필터', list.ok && list.data.count, 1);
  ok('행은 화면이 쓰는 필드만 준다', list.ok && list.data.rows[0].views === 0 && list.data.rows[0].reach === 900, list.data && list.data.rows[0]);

  /* 시트가 collected_date 를 날짜(Date)로 저장해 돌려줘도 그날 행을 놓치지 않는다 (2026-11-19 실제 결함). */
  {
    const sd = new FakeSS();
    callHandler(G.ctx, 'handleIngestAnalytics_', sd, {
      items: [{ source: 'youtube', channel: 'shorts', external_id: 'DATE1', brand: 'daejeon_youth', collected_at: '2026-11-19T10:00:00+09:00', views: 10 }]
    }, { brand: 'daejeon_youth' });
    const sh = sd.getSheetByName('Analytics_Daily');
    const ci = sh.rows[0].indexOf('collected_date');
    sh.rows[1][ci] = new Date(2026, 10, 19);
    const l1 = callHandler(G.ctx, 'handleListAnalytics_', sd, { brand: 'daejeon_youth', from: '2026-11-01', to: '2026-11-30' }, {});
    ok('날짜로 저장된 행도 기간 필터를 통과한다', l1.ok && l1.data.count === 1, l1.data && { count: l1.data.count, rows: l1.data.rows });
    ok('응답의 collected_date 는 YYYY-MM-DD', l1.ok && l1.data.rows[0].collected_date === '2026-11-19', l1.data && l1.data.rows[0]);
    const again = callHandler(G.ctx, 'handleIngestAnalytics_', sd, {
      items: [{ source: 'youtube', channel: 'shorts', external_id: 'DATE1', brand: 'daejeon_youth', collected_at: '2026-11-19T10:00:00+09:00', views: 10 }]
    }, { brand: 'daejeon_youth' });
    ok('날짜로 저장된 행과도 중복을 거른다', again.ok && again.data.skipped === 1 && again.data.inserted === 0, again.data);
  }
})();


console.log('\n[B6] 피클 통계 받기 (blog_stats_ingest)');
ok('blog_stats_ingest 등록', WL.blog_stats_ingest && WL.blog_stats_ingest.m1 && WL.blog_stats_ingest.mode === 'WRITE' && typeof HM.blog_stats_ingest === 'function');
const KST_TODAY = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const KST_YDAY = new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
const goodPayload = () => ({
  day: KST_YDAY,
  daily: { visitors: 37, pageviews: 90 },
  post_views: [{ log_no: '224480755004', views: 41 }, { log_no: '224462465538', views: 7 }, { log_no: 'bad', views: 3 }, { log_no: '224459297302', views: -5 }],
  keywords: [{ keyword: '봉명동 냉삼', count: 12 }, { keyword: '봉명동 냉삼', count: 99 }, { keyword: '대전 삼겹살', count: 5 }, { keyword: '', count: 1 }],
  inflow: [{ channel: '네이버 검색', count: 30 }, { channel: '인스타그램', count: 4 }],
  audience: [{ kind: 'gender', label: '여성', pct: 61.5 }, { kind: 'gender', label: '남성', pct: 38.5 }, { kind: 'age', label: '30대', pct: 44 }, { kind: 'age', label: '20대', pct: 140 }, { kind: 'etc', label: 'x', pct: 1 }]
});
const IS = new FakeSS();
const ing = callHandler(B.ctx, 'handleBlogStatsIngest_', IS, goodPayload(), { brand: 'daejeon_youth' });
ok('받기 성공 · 잘못된 줄만 버림', ing.ok && ing.data.dropped === 6 && ing.data.counts.post_views === 2 && ing.data.counts.keywords === 2 && ing.data.counts.audience === 3, ing);
eq('같은 키워드 중복은 첫 값만', IS.getSheetByName('Blog_Keywords').rows[1][3], 12);
callHandler(B.ctx, 'handleBlogStatsIngest_', IS, goodPayload(), { brand: 'daejeon_youth' });
eq('같은 날 다시 보내면 덮어씀(조회수 2줄 + 헤더)', IS.getSheetByName('Blog_Post_Views').getLastRow(), 3);
eq('방문자·페이지뷰 저장', IS.getSheetByName('Blog_Visitors').rows[1].slice(2, 3)[0] === 37 && IS.getSheetByName('Blog_Visitors').rows[1][4] === 90, true);
o = callHandler(B.ctx, 'handleBlogStatsIngest_', IS, { day: '2999-01-01', keywords: [{ keyword: 'a', count: 1 }] }, { brand: 'daejeon_youth' });
eq('미래 날짜는 거부', o.code, 'ERR_VALIDATION_FAILED');
o = callHandler(B.ctx, 'handleBlogStatsIngest_', IS, { day: KST_YDAY }, { brand: 'daejeon_youth' });
eq('빈 통계는 거부', o.code, 'ERR_VALIDATION_FAILED');
o = callHandler(B.ctx, 'handleBlogStatsIngest_', IS, { day: KST_YDAY, keywords: Array.from({ length: 501 }, (_, i) => ({ keyword: 'k' + i, count: 1 })) }, { brand: 'daejeon_youth' });
eq('501줄은 거부', o.code, 'ERR_VALIDATION_FAILED');
o = callHandler(B.ctx, 'handleBlogStatsIngest_', IS, goodPayload(), { brand: 'ppiyak_kimmary' });
eq('김메리는 블로그 없음', o.code, 'ERR_BLOG_SKIPPED');

// 화면용 묶음: 이전 날 하루치를 더 넣어 7일 합산·글별 누계 확인
const p2 = goodPayload(); p2.day = new Date(Date.now() + 9 * 3600000 - 3 * 86400000).toISOString().slice(0, 10);
p2.post_views = [{ log_no: '224480755004', views: 10 }]; p2.keywords = [{ keyword: '봉명동 냉삼', count: 8 }];
callHandler(B.ctx, 'handleBlogStatsIngest_', IS, p2, { brand: 'daejeon_youth' });
const old = goodPayload(); old.day = new Date(Date.now() + 9 * 3600000 - 30 * 86400000).toISOString().slice(0, 10);
old.post_views = [{ log_no: '224480755004', views: 100 }]; old.keywords = [{ keyword: '옛날 검색어', count: 50 }];
callHandler(B.ctx, 'handleBlogStatsIngest_', IS, old, { brand: 'daejeon_youth' });
const posts2 = IS.insertSheet('Blog_Posts');
posts2.rows = [['blog_id', 'log_no', 'title', 'url', 'category', 'published_at', 'comment_cnt', 'sympathy_cnt', 'share_cnt', 'photo_count', 'content_id', 'first_seen_at', 'synced_at'],
  ['youth-daejeon', '224480755004', '글', 'u', 'c', '2026-11-17T00:00:00+09:00', 1, 1, 0, 3, '', '', '']];
IS.insertSheet('Contents').rows = [['content_id', 'brand', 'blog_url', 'target_keywords']];
IS.insertSheet('Rank_Log').rows = [['rank_log_id', 'brand', 'surface', 'keyword']];
const st2 = callHandler(B.ctx, 'handleListBlogStats_', IS, { days: 365 }, { brand: 'daejeon_youth' });
ok('글별 조회수 누계 41+10+100=151 · 7일 51', st2.ok && st2.data.posts[0].views_total === 151 && st2.data.posts[0].views_7d === 51, st2.data && st2.data.posts[0]);
ok('7일 검색어 합산(옛날 건 제외)', st2.ok && st2.data.keywords_7d.length === 2 && st2.data.keywords_7d[0].keyword === '봉명동 냉삼' && st2.data.keywords_7d[0].count === 20, st2.data && st2.data.keywords_7d);
ok('유입 경로 비율', st2.ok && st2.data.inflow_7d[0].channel === '네이버 검색' && st2.data.inflow_7d[0].pct > 85, st2.data && st2.data.inflow_7d);
ok('독자 분포는 가장 최근 날 기준', st2.ok && st2.data.audience && st2.data.audience.day === KST_YDAY && st2.data.audience.items.length === 3, st2.data && st2.data.audience);
ok('마지막 수집 시각', st2.ok && /^\d{4}-/.test(st2.data.stats_last_ingest_at), st2.data && st2.data.stats_last_ingest_at);
ok('수집 전 글은 조회수 null(0으로 속이지 않음)', (() => { const e = new FakeSS(); e.insertSheet('Blog_Posts').rows = posts2.rows; e.insertSheet('Contents').rows = [['content_id']]; e.insertSheet('Rank_Log').rows = [['rank_log_id']];
  const r = callHandler(B.ctx, 'handleListBlogStats_', e, {}, { brand: 'daejeon_youth' }); return r.ok && r.data.posts[0].views_total === null && r.data.audience === null; })());
ok('쿠키·비밀번호 같은 키는 라우터가 막는다', typeof B.ctx.assertNoSensitiveFields_ === 'function' && (() => { try { B.ctx.assertNoSensitiveFields_({ cookie: 'x' }, 'payload'); return false; } catch (e) { return e.code === 'ERR_SENSITIVE_FIELD'; } })());


/* ───────── 채널 드릴다운 (gas/PostDetail.gs, 2026-11-19) ───────── */
console.log('\n[P1] 등록 · 트랙 채널 계약');
const PD = loadGas();
const PWL = ev(PD.ctx, 'ACTION_WHITELIST'), PHM = ev(PD.ctx, 'M1_HANDLERS');
eq('get_post_detail 은 읽기', PWL.get_post_detail.mode, 'READ');
eq('list_media_meta 는 읽기', PWL.list_media_meta.mode, 'READ');
eq('upsert_media_meta 는 쓰기(라우터가 락)', PWL.upsert_media_meta.mode, 'WRITE');
ok('upsert_media_meta 는 longRunning 이 아니다(락 안에서 돈다)', !PWL.upsert_media_meta.longRunning);
ok('핸들러 3개 연결', typeof PHM.get_post_detail === 'function' && typeof PHM.upsert_media_meta === 'function' && typeof PHM.list_media_meta === 'function');
{
  const assertx = require('assert');
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'seeds', 'track_channels.json'), 'utf8'));
  let same = true;
  try { assertx.deepStrictEqual(JSON.parse(JSON.stringify(ev(PD.ctx, 'TRACK_CHANNELS'))), seed); } catch (e) { same = false; }
  ok('GAS TRACK_CHANNELS = seeds/track_channels.json', same, ev(PD.ctx, 'TRACK_CHANNELS'));
  eq('트랙 B 는 3채널', ev(PD.ctx, 'TRACK_CHANNELS').ppiyak_kimmary.join(','), 'shorts,reels,clip');
}

console.log('\n[P2] ID 정규화 — tools/analytics/lib/ids.js 와 같은 입력 표로 대조');
{
  const ids = require('../../tools/analytics/lib/ids.js');
  const YT = [
    'dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://youtube.com/shorts/dQw4w9WgXcQ?feature=share', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?feature=x&v=dQw4w9WgXcQ&t=3',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=tooshort', 'https://www.youtube.com/shorts/waytoolongidhere1',
    'https://example.com/shorts/dQw4w9WgXcQ', 'https://youtu.be/', 'not a url', '', '   ', 'https://www.youtube.com/@channel', 'https://www.youtube.com/watch/dQw4w9WgXcQ',
    'ftp://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXc', 'dQw4w9WgXcQQ'
  ];
  let ytBad = [];
  YT.forEach((t) => { if (PD.ctx.youtubeIdOf_(t) !== ids.youtubeIdOf(t)) ytBad.push({ t, gas: PD.ctx.youtubeIdOf_(t), js: ids.youtubeIdOf(t) }); });
  ok('유튜브 ' + YT.length + '개 입력이 ids.js 와 같다', ytBad.length === 0, ytBad);
  eq('유튜브 11자', PD.ctx.youtubeIdOf_('https://youtu.be/dQw4w9WgXcQ?si=x'), 'dQw4w9WgXcQ');

  const IG = [
    'https://www.instagram.com/reel/C9xYz12AbCd/', 'https://www.instagram.com/reels/C9xYz12AbCd/?igsh=abc', 'https://instagram.com/p/POST1/',
    'https://www.instagram.com/tv/TVCODE/', 'https://www.instagram.com/p/POST1', 'https://l.instagram.com/p/POST1/', 'https://www.instagram.com/explore/',
    'https://www.instagram.com/someone/', 'https://example.com/p/POST1/', 'instagram.com/p/POST1/', '', 'junk', 'https://www.instagram.com/reel/'
  ];
  let igBad = [];
  IG.forEach((t) => { if (PD.ctx.instagramKeyOf_(t) !== ids.instagramKeyOf(t)) igBad.push({ t, gas: PD.ctx.instagramKeyOf_(t), js: ids.instagramKeyOf(t) }); });
  ok('인스타 ' + IG.length + '개 입력이 ids.js 와 같다', igBad.length === 0, igBad);
  eq('인스타 reels → reel 로 통일', PD.ctx.instagramKeyOf_('https://www.instagram.com/reels/C9xYz12AbCd/?igsh=abc'), 'instagram.com/reel/C9xYz12AbCd');
  eq('shortcode 만', PD.ctx.instagramShortcodeOf_('https://www.instagram.com/p/POST1/'), 'POST1');
  eq('shortcode 없으면 빈값', PD.ctx.instagramShortcodeOf_('https://www.instagram.com/someone/'), '');

  eq('블로그 글 번호(경로)', PD.ctx.blogLogNoOf_('https://blog.naver.com/youth-daejeon/224480755004'), '224480755004');
  eq('블로그 글 번호(모바일)', PD.ctx.blogLogNoOf_('https://m.blog.naver.com/youth-daejeon/224480755004?referrerCode=1'), '224480755004');
  eq('블로그 글 번호(logNo=)', PD.ctx.blogLogNoOf_('https://blog.naver.com/PostView.naver?blogId=youth-daejeon&logNo=224480755004'), '224480755004');
  eq('8자리 이하는 글 번호가 아니다', PD.ctx.blogLogNoOf_('https://blog.naver.com/youth-daejeon/12345678'), '');
  eq('빈 값', PD.ctx.blogLogNoOf_(''), '');
}

console.log('\n[P3] Media_Meta — 시트 자동 생성 · 7일 갱신 규칙');
const MSS = new FakeSS();
const NOWISO = new Date().toISOString();
const metaItem = (id, extra) => Object.assign({ source: 'youtube', external_id: id, channel: 'shorts', title: '제목 ' + id, thumbnail_url: 'https://i.ytimg.test/' + id + '.jpg', published_at: '2026-11-10T00:00:00Z', duration_sec: 21 }, extra || {});
{
  ok('처음엔 시트가 없다', MSS.getSheetByName('Media_Meta') === null);
  let r = callHandler(PD.ctx, 'handleUpsertMediaMeta_', MSS, { items: [metaItem('vidAAAAAAA1'), metaItem('vidAAAAAAA2'), { source: 'instagram', external_id: '17900000000000001', channel: 'reels', title: '릴스', thumbnail_url: 'http://insecure.test/x.jpg', duration_sec: 0 }] }, { brand: 'ALL' });
  ok('올리기 성공', r.ok && r.data.inserted === 3 && r.data.updated === 0 && r.data.skipped === 0, r);
  const sh = MSS.getSheetByName('Media_Meta');
  ok('시트가 스스로 생겼다', !!sh);
  eq('9열', sh.rows[0].length, 9);
  eq('머리글 순서', sh.rows[0].join(','), 'meta_key,source,external_id,channel,title,thumbnail_url,published_at,duration_sec,updated_at');
  eq('meta_key = source:external_id', sh.rows[1][0], 'youtube:vidAAAAAAA1');
  eq('https 가 아닌 썸네일은 비운다', sh.rows[3][5], '');
  ok('updated_at 이 채워진다', /^\d{4}-\d{2}-\d{2}T/.test(String(sh.rows[1][8])), sh.rows[1][8]);

  r = callHandler(PD.ctx, 'handleUpsertMediaMeta_', MSS, { items: [metaItem('vidAAAAAAA1', { title: '바뀐 제목' })] }, { brand: 'ALL' });
  ok('7일 안에는 건너뛴다', r.ok && r.data.skipped === 1 && r.data.updated === 0 && r.data.inserted === 0, r);
  eq('제목이 안 바뀐다', sh.rows[1][4], '제목 vidAAAAAAA1');

  sh.rows[1][8] = new Date(Date.now() - 8 * 86400000).toISOString();
  r = callHandler(PD.ctx, 'handleUpsertMediaMeta_', MSS, { items: [metaItem('vidAAAAAAA1', { title: '바뀐 제목' })] }, { brand: 'ALL' });
  ok('7일이 지나면 갱신한다', r.ok && r.data.updated === 1 && r.data.skipped === 0, r);
  eq('제목이 바뀐다', sh.rows[1][4], '바뀐 제목');
  ok('updated_at 도 새로 쓴다', Date.now() - Date.parse(sh.rows[1][8]) < 60000, sh.rows[1][8]);
  eq('행은 늘지 않는다', sh.getLastRow(), 4);

  sh.rows[2][8] = new Date(Date.now() - 20 * 86400000);
  r = callHandler(PD.ctx, 'handleUpsertMediaMeta_', MSS, { items: [metaItem('vidAAAAAAA2', { title: '날짜 객체' })] }, { brand: 'ALL' });
  ok('시트가 날짜(Date)로 돌려줘도 7일 판정', r.ok && r.data.updated === 1, r);

  r = callHandler(PD.ctx, 'handleUpsertMediaMeta_', MSS, { items: [metaItem('vidAAAAAAA9'), metaItem('vidAAAAAAA9')] }, { brand: 'ALL' });
  ok('같은 묶음의 중복은 한 번만', r.ok && r.data.inserted === 1 && r.data.skipped === 1, r);

  r = callHandler(PD.ctx, 'handleUpsertMediaMeta_', MSS, { items: [{ source: 'tiktok', external_id: 'x', channel: 'shorts' }, { source: 'youtube', external_id: '', channel: 'shorts' }, { source: 'youtube', external_id: 'vidZZZZZZZ1', channel: 'blog' }] }, { brand: 'ALL' });
  eq('못 쓰는 행만 있으면 거부', r.code, 'ERR_VALIDATION_FAILED');
  r = callHandler(PD.ctx, 'handleUpsertMediaMeta_', MSS, { items: [metaItem('vidAAAAAAB1'), { source: 'tiktok', external_id: 'x', channel: 'shorts' }] }, { brand: 'ALL' });
  ok('못 쓰는 행은 세어서 버린다', r.ok && r.data.inserted === 1 && r.data.dropped === 1, r);
  eq('빈 items 는 거부', callHandler(PD.ctx, 'handleUpsertMediaMeta_', MSS, { items: [] }, {}).code, 'ERR_VALIDATION_FAILED');
  eq('501건은 거부', callHandler(PD.ctx, 'handleUpsertMediaMeta_', MSS, { items: Array.from({ length: 501 }, (_, i) => metaItem('v' + String(i).padStart(10, '0'))) }, {}).code, 'ERR_VALIDATION_FAILED');
  r = callHandler(PD.ctx, 'handleUpsertMediaMeta_', MSS, { items: [metaItem('vidAAAAAAC1', { title: '  긴   공백\n제목 '.padEnd(400, '가') })] }, { brand: 'ALL' });
  ok('제목은 한 줄·200자 이내', r.ok && MSS.getSheetByName('Media_Meta').rows.slice(-1)[0][4].length <= 200 && !/\n/.test(MSS.getSheetByName('Media_Meta').rows.slice(-1)[0][4]));
}

console.log('\n[P4] list_media_meta — 일괄 조회');
{
  let r = callHandler(PD.ctx, 'handleListMediaMeta_', MSS, { source: 'youtube', ids: ['vidAAAAAAA1', 'vidAAAAAAA2', 'nope'] }, {});
  ok('요청한 것만', r.ok && r.data.count === 2 && r.data.items.map((x) => x.external_id).sort().join(',') === 'vidAAAAAAA1,vidAAAAAAA2', r);
  ok('필드 9개를 문자열·숫자로', r.ok && r.data.items[0].title && typeof r.data.items[0].duration_sec === 'number' && r.data.items[0].thumbnail_url, r.data && r.data.items[0]);
  r = callHandler(PD.ctx, 'handleListMediaMeta_', MSS, { source: 'instagram', ids: [] }, {});
  ok('ids 가 비면 그 소스 전부', r.ok && r.data.count === 1, r);
  eq('잘못된 소스', callHandler(PD.ctx, 'handleListMediaMeta_', MSS, { source: 'tiktok' }, {}).code, 'ERR_VALIDATION_FAILED');
  eq('201개는 거부', callHandler(PD.ctx, 'handleListMediaMeta_', MSS, { ids: Array.from({ length: 201 }, (_, i) => 'x' + i) }, {}).code, 'ERR_VALIDATION_FAILED');
  r = callHandler(PD.ctx, 'handleListMediaMeta_', new FakeSS(), { source: 'youtube', ids: ['a'] }, {});
  ok('시트가 없어도 빈 목록(읽기는 시트를 만들지 않는다)', r.ok && r.data.count === 0, r);
}

console.log('\n[P5] get_post_detail — 시계열 · 트랙 채널 비교');
const AN_COLS = ['analytics_id', 'brand', 'content_id', 'source', 'external_id', 'channel', 'checkpoint', 'collected_at', 'collected_date',
  'views', 'impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'watch_time_sec', 'avg_view_pct', 'subscribers', 'revenue_krw', 'revenue_source', 'score', 'note'];
const CT_COLS = ['content_id', 'brand', 'status', 'blog_title', 'place_name', 'blog_status', 'blog_url', 'shorts_status', 'shorts_url',
  'reels_status', 'reels_url', 'clip_status', 'clip_url', 'ig_feed_status', 'ig_feed_url', 'daangn_status', 'daangn_url'];
const sheetOf = (ss, name, cols, objs) => {
  const sh = ss.insertSheet(name);
  sh.rows = [cols.slice()].concat(objs.map((o) => cols.map((c) => (o[c] === undefined ? '' : o[c]))));
  return sh;
};
const an = (o) => Object.assign({ analytics_id: 'AND-x', collected_at: o.collected_date + 'T06:10:00+09:00', views: 0, likes: 0, comments: 0 }, o);
const A_BRAND = 'daejeon_youth', B_BRAND = 'ppiyak_kimmary';
const DSS = new FakeSS();
sheetOf(DSS, 'Analytics_Daily', AN_COLS, [
  an({ brand: A_BRAND, content_id: 'DY-1', source: 'youtube', external_id: 'vidAAAAAAA1', channel: 'shorts', checkpoint: 'D1', collected_date: '2026-11-12', views: 10 }),
  an({ brand: A_BRAND, content_id: 'DY-1', source: 'youtube', external_id: 'vidAAAAAAA1', channel: 'shorts', checkpoint: 'LATEST', collected_date: '2026-11-13', views: 30 }),
  an({ brand: A_BRAND, content_id: 'DY-1', source: 'youtube', external_id: 'vidAAAAAAA1', channel: 'shorts', checkpoint: 'LATEST', collected_date: '2026-11-17', views: 50, likes: 5, avg_view_pct: 61 }),
  an({ brand: A_BRAND, content_id: 'DY-1', source: 'youtube', external_id: 'vidAAAAAAA1', channel: 'shorts', checkpoint: 'LATEST', collected_date: '2026-11-18', views: 80, likes: 9, comments: 2, avg_view_pct: 64 }),
  an({ brand: A_BRAND, content_id: 'DY-1', source: 'youtube', external_id: 'vidAAAAAAA1', channel: 'shorts', checkpoint: 'D7', collected_date: '2026-11-19', views: 90, likes: 10 }),
  an({ brand: A_BRAND, content_id: '', source: 'youtube', external_id: 'vidLONG0001', channel: 'longform', checkpoint: 'LATEST', collected_date: '2026-11-18', views: 7 }),
  an({ brand: A_BRAND, content_id: '', source: 'youtube', external_id: 'vidCCCCCCC1', channel: 'shorts', checkpoint: 'LATEST', collected_date: '2026-11-18', views: 12 }),
  an({ brand: A_BRAND, content_id: '', source: 'youtube', external_id: 'UCchannelxx', channel: 'channel', checkpoint: 'LATEST', collected_date: '2026-11-18', views: 999, subscribers: 5 }),
  an({ brand: A_BRAND, content_id: 'DY-1', source: 'instagram', external_id: '17900000000000001', channel: 'reels', checkpoint: 'LATEST', collected_date: '2026-11-18', views: 300, reach: 250, likes: 20, saves: 4 }),
  an({ brand: A_BRAND, content_id: 'DY-1', source: 'instagram', external_id: '17900000000000002', channel: 'feed', checkpoint: 'LATEST', collected_date: '2026-11-18', reach: 120, likes: 8, saves: 3 }),
  an({ brand: B_BRAND, content_id: 'KM-1', source: 'youtube', external_id: 'vidBBBBBBB1', channel: 'shorts', checkpoint: 'LATEST', collected_date: '2026-11-18', views: 40, likes: 4 }),
  an({ brand: B_BRAND, content_id: 'KM-1', source: 'instagram', external_id: '17900000000000011', channel: 'reels', checkpoint: 'LATEST', collected_date: '2026-11-18', views: 70, reach: 60, likes: 6 }),
  an({ brand: B_BRAND, content_id: 'KM-1', source: 'instagram', external_id: '17900000000000012', channel: 'feed', checkpoint: 'LATEST', collected_date: '2026-11-18', reach: 99, likes: 9 })
]);
sheetOf(DSS, 'Contents', CT_COLS, [
  { content_id: 'DY-1', brand: A_BRAND, status: 'PUBLISHED', place_name: '미미삼겹', blog_status: 'PUBLISHED', blog_url: 'https://blog.naver.com/youth-daejeon/224480755004',
    shorts_status: 'UPLOADED', shorts_url: 'https://youtu.be/vidAAAAAAA1?si=x', reels_status: 'UPLOADED', reels_url: 'https://www.instagram.com/reel/RCODE1/',
    clip_status: 'UPLOADED', clip_url: 'https://clip.naver.com/x', ig_feed_status: 'PUBLISHING', ig_feed_url: 'https://www.instagram.com/p/FCODE1/', daangn_status: 'SKIPPED' },
  { content_id: 'KM-1', brand: B_BRAND, status: 'PUBLISHED', place_name: '메리', blog_status: 'SKIPPED', blog_url: '',
    shorts_status: 'UPLOADED', shorts_url: 'https://www.youtube.com/shorts/vidBBBBBBB1', reels_status: 'UPLOADED', reels_url: 'https://www.instagram.com/reels/KCODE1/',
    clip_status: 'PUBLISHING', clip_url: '', ig_feed_status: 'UPLOADED', ig_feed_url: 'https://www.instagram.com/p/KFEED1/', daangn_status: 'SKIPPED' }
]);
sheetOf(DSS, 'Blog_Posts', ['blog_id', 'log_no', 'title', 'url', 'category', 'published_at', 'comment_cnt', 'sympathy_cnt', 'share_cnt', 'photo_count', 'content_id', 'first_seen_at', 'synced_at'], [
  { blog_id: 'youth-daejeon', log_no: '224480755004', title: '[대전 봉명동 맛집] 시험', url: 'https://blog.naver.com/youth-daejeon/224480755004', published_at: '2026-11-10T09:00:00+09:00', comment_cnt: 4, sympathy_cnt: 11 }
]);
const kd = (back) => new Date(Date.now() + 9 * 3600000 - back * 86400000).toISOString().slice(0, 10);
sheetOf(DSS, 'Blog_Post_Views', ['day', 'blog_id', 'log_no', 'views', 'synced_at'], [
  { day: kd(20), blog_id: 'youth-daejeon', log_no: '224480755004', views: 100 },
  { day: kd(3), blog_id: 'youth-daejeon', log_no: '224480755004', views: 30 },
  { day: kd(1), blog_id: 'youth-daejeon', log_no: '224480755004', views: 12 },
  { day: kd(1), blog_id: 'youth-daejeon', log_no: '224462465538', views: 999 }
]);
sheetOf(DSS, 'Blog_Keywords', ['day', 'blog_id', 'keyword', 'count', 'synced_at'], [
  { day: kd(1), blog_id: 'youth-daejeon', keyword: '봉명동 냉삼', count: 12 }, { day: kd(30), blog_id: 'youth-daejeon', keyword: '옛날', count: 50 }]);
sheetOf(DSS, 'Blog_Inflow', ['day', 'blog_id', 'channel', 'count', 'synced_at'], [
  { day: kd(1), blog_id: 'youth-daejeon', channel: '네이버 검색', count: 30 }]);
{
  callHandler(PD.ctx, 'handleUpsertMediaMeta_', DSS, { items: [metaItem('vidAAAAAAA1', { title: '미미삼겹 쇼츠' }), { source: 'instagram', external_id: '17900000000000001', channel: 'reels', title: '미미삼겹 릴스' }] }, {});
}
{
  const channelsOf = (d) => d.compare.map((c) => c.channel).join(',');
  let r = callHandler(PD.ctx, 'handleGetPostDetail_', DSS, { source: 'youtube', external_id: 'vidAAAAAAA1' }, { brand: 'ALL' });
  ok('유튜브 상세', r.ok, r);
  const d = r.data;
  eq('행의 content_id 로 카드가 자동 연결', d.content_id, 'DY-1');
  ok('linked', d.linked === true && d.content_missing === false);
  eq('표면', d.channel, 'shorts');
  ok('수집됨', d.collected === true);
  eq('메타 제목', d.meta && d.meta.title, '미미삼겹 쇼츠');
  eq('체크포인트 키', Object.keys(d.checkpoints).sort().join(','), 'D1,D7,LATEST');
  eq('LATEST 체크포인트는 마지막 LATEST(80)', d.checkpoints.LATEST.views, 80);
  eq('D7 체크포인트', d.checkpoints.D7.views, 90);
  eq('추이: 날짜마다 한 줄(5일)', d.daily.length, 5);
  eq('추이 날짜 순서', d.daily.map((p) => p.collected_date).join(','), '2026-11-12,2026-11-13,2026-11-17,2026-11-18,2026-11-19');
  eq('latest 는 마지막 날', d.latest.collected_date, '2026-11-19');
  eq('트랙 A 채널셋 6칸', d.track_channels.join(','), 'blog,shorts,reels,feed,clip,daangn');
  eq('비교: SKIPPED(당근) 는 빠진다', channelsOf(d), 'blog,shorts,reels,feed,clip');
  const by = {}; d.compare.forEach((c) => { by[c.channel] = c; });
  eq('비교 쇼츠 현재값은 LATEST 한 줄(80, 합산 아님)', by.shorts.metrics.views, 80);
  eq('비교 쇼츠 ID', by.shorts.external_id, 'vidAAAAAAA1');
  eq('비교 릴스는 content_id 로 조인', by.reels.metrics.views, 300);
  eq('비교 피드는 도달', by.feed.metrics.reach, 120);
  eq('피드 상태는 그대로(PUBLISHING)', by.feed.status, 'PUBLISHING');
  ok('클립은 지표 API 없음', by.clip.has_metrics_api === false && by.clip.metrics === null && by.clip.collected === false, by.clip);
  eq('클립 상태', by.clip.status, 'UPLOADED');
  eq('비교 블로그: 글 번호', by.blog.external_id, '224480755004');
  ok('비교 블로그: 조회 누계 142 · 7일 42', by.blog.metrics && by.blog.metrics.views === 142 && by.blog.metrics.views_7d === 42, by.blog.metrics);
  eq('비교 블로그: 공감', by.blog.metrics.sympathy, 11);
  ok('내부 열(payload·토큰 등)이 새지 않는다', !JSON.stringify(d).match(/payload_file_id|lease_token/));
}
{
  let r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'youtube', 'vidBBBBBBB1', '', '');
  ok('트랙 B 유튜브 상세', r.ok, r);
  eq('트랙 B 채널셋 3칸', r.data.track_channels.join(','), 'shorts,reels,clip');
  eq('트랙 B 비교는 쇼츠·릴스·클립만(블로그·피드·당근 없음)', r.data.compare.map((c) => c.channel).join(','), 'shorts,reels,clip');
  const clip = r.data.compare.find((c) => c.channel === 'clip');
  eq('클립 지연은 PUBLISHING 으로 드러난다', clip.status, 'PUBLISHING');
  eq('릴스 값', r.data.compare.find((c) => c.channel === 'reels').metrics.views, 70);
  ok('피드 행 값이 비교에 섞이지 않는다', !JSON.stringify(r.data).includes('17900000000000012') && !JSON.stringify(r.data.compare).includes('"reach":99'));

  r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'instagram', '17900000000000012', '', '');
  eq('트랙 B 의 피드 게시물 상세는 거부', r.code, 'ERR_NOT_FOUND');
  r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'instagram', '17900000000000011', '', '');
  ok('트랙 B 릴스 상세는 열린다', r.ok && r.data.channel === 'reels' && r.data.compare.length === 3, r);
  r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'youtube', 'vidLONG0001', '', '');
  eq('롱폼은 트랙 채널이 아니라 거부', r.code, 'ERR_NOT_FOUND');
}
{
  let r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'youtube', 'vidCCCCCCC1', '', '');
  ok('미연결(content_id 없음)', r.ok && r.data.linked === false && r.data.content_id === '' && r.data.compare.length === 0 && r.data.collected === true, r);
  eq('미연결이어도 브랜드로 채널셋은 준다', r.data.track_channels.length, 6);

  r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'youtube', 'vidDDDDDDD1', 'DY-1', '');
  ok('수집 전(행 없음): collected=false · 카드는 연결 · 비교는 나온다', r.ok && r.data.collected === false && r.data.linked === true && r.data.daily.length === 0 && r.data.latest === null && r.data.compare.length === 5, r);
  eq('수집 전 체크포인트는 비어 있다', Object.keys(r.data.checkpoints).length, 0);

  r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'youtube', 'vidDDDDDDD1', 'DY-404', '');
  ok('없는 카드 ID 는 content_missing', r.ok && r.data.content_missing === true && r.data.linked === false, r);

  r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'instagram', 'RCODE1', 'DY-1', '');
  ok('인스타 주소(shortcode)로도 카드에 묶인 릴스를 찾는다', r.ok && r.data.external_id === '17900000000000001' && r.data.channel === 'reels', r);
  r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'instagram', 'FCODE1', 'DY-1', '');
  ok('피드 shortcode 는 피드 미디어로', r.ok && r.data.external_id === '17900000000000002' && r.data.channel === 'feed', r);
  eq('인스타 메타 제목', callHandler(PD.ctx, 'getPostDetail_', DSS, 'instagram', '17900000000000001', '', '').data.meta.title, '미미삼겹 릴스');
}
{
  let r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'blog', '224480755004', '', 'daejeon_youth');
  ok('블로그 상세', r.ok && r.data.collected === true && r.data.channel === 'blog', r);
  ok('조회 누계 142 · 7일 42', r.data.blog.views_total === 142 && r.data.blog.views_7d === 42, r.data.blog);
  eq('일별 추이 3일(오래된 날도 포함)', r.data.blog.daily.length, 3);
  eq('추이는 날짜순', r.data.blog.daily.map((x) => x.views).join(','), '100,30,12');
  ok('다른 글의 조회수는 섞이지 않는다', !JSON.stringify(r.data.blog.daily).includes('999'));
  ok('검색어는 7일 안만', r.data.blog.keywords_7d.length === 1 && r.data.blog.keywords_7d[0].keyword === '봉명동 냉삼', r.data.blog.keywords_7d);
  ok('유입 경로', r.data.blog.inflow_7d[0].channel === '네이버 검색');
  ok('범위 안내 문구(글별이 아님)', /블로그 전체/.test(r.data.blog.scope_note));
  eq('글 번호로 카드 자동 연결', r.data.content_id, 'DY-1');
  eq('제목', r.data.meta.title, '[대전 봉명동 맛집] 시험');
  eq('댓글·공감', r.data.blog.comment_cnt + '/' + r.data.blog.sympathy_cnt, '4/11');

  r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'blog', '224400000000', '', 'daejeon_youth');
  ok('수집 전 글은 0 이 아니라 null', r.ok && r.data.collected === false && r.data.blog.views_total === null && r.data.blog.daily.length === 0, r);
  r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'blog', '224480755004', 'KM-1', '');
  eq('김메리 카드로는 블로그 상세를 못 연다', r.code, 'ERR_BLOG_SKIPPED');
  r = callHandler(PD.ctx, 'getPostDetail_', DSS, 'blog', '224480755004', '', 'ppiyak_kimmary');
  ok('카드가 없고 글 번호가 연결돼 있으면 카드 브랜드(A)를 따른다', r.ok && r.data.brand === 'daejeon_youth', r);
}

console.log('\n[P6] 입력 검증 · 권한');
{
  eq('source 가 이상하면 거부', callHandler(PD.ctx, 'getPostDetail_', DSS, 'tiktok', 'vidAAAAAAA1', '', '').code, 'ERR_VALIDATION_FAILED');
  eq('유튜브 ID 11자가 아니면 거부', callHandler(PD.ctx, 'getPostDetail_', DSS, 'youtube', 'short', '', '').code, 'ERR_VALIDATION_FAILED');
  eq('블로그 글 번호가 숫자가 아니면 거부', callHandler(PD.ctx, 'getPostDetail_', DSS, 'blog', 'abc', '', '').code, 'ERR_VALIDATION_FAILED');
  eq('빈 ID 거부', callHandler(PD.ctx, 'getPostDetail_', DSS, 'youtube', '', '', '').code, 'ERR_VALIDATION_FAILED');
  eq('수식 같은 ID 거부', callHandler(PD.ctx, 'getPostDetail_', DSS, 'instagram', '=IMPORTXML("x")', '', '').code, 'ERR_VALIDATION_FAILED');
  eq('이상한 content_id 거부', callHandler(PD.ctx, 'getPostDetail_', DSS, 'youtube', 'vidAAAAAAA1', "DY-1'; DROP", '').code, 'ERR_VALIDATION_FAILED');
  const none = callHandler(PD.ctx, 'handleGetPostDetail_', new FakeSS(), { source: 'youtube', external_id: 'vidAAAAAAA1' }, {});
  ok('시트가 하나도 없어도 빈 상세(읽기는 시트를 만들지 않는다)', none.ok && none.data.collected === false && none.data.compare.length === 0, none);

  PD.env.props.set('API_SECRET_TOKEN', 'test-secret-token-0123456789abcdef');
  const authOf = (action, token) => callHandler(PD.ctx, 'authenticateRequest_', null, { action, auth_token: token, client_id: 'pd-test', brand: 'ALL' }, { allowAllBrand: true });
  ['get_post_detail', 'list_media_meta', 'upsert_media_meta'].forEach((a) => {
    eq(a + ': 토큰이 없으면 거부', authOf(a, '').code, 'ERR_UNAUTHORIZED');
    eq(a + ': 틀린 토큰이면 거부', authOf(a, 'wrong-token').code, 'ERR_UNAUTHORIZED');
    ok(a + ': 맞는 토큰이면 통과', authOf(a, 'test-secret-token-0123456789abcdef').ok);
  });
  eq('화이트리스트 밖 액션은 거부', authOf('delete_everything', 'test-secret-token-0123456789abcdef').code, 'ERR_UNKNOWN_ACTION');
  eq('GET 쿼리 토큰은 거부', callHandler(PD.ctx, 'authenticateRequest_', { parameter: { auth_token: 'x' } }, { action: 'get_post_detail', auth_token: 'test-secret-token-0123456789abcdef' }, {}).code, 'ERR_GET_TOKEN_FORBIDDEN');
}

console.log('\n' + (failed ? '❌ 실패 ' + failed + '건 / 통과 ' + passed + '건' : '✅ 전부 통과 ' + passed + '건'));
process.exit(failed ? 1 : 0);
