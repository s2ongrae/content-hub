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
  const files = ['Setup.gs', 'Auth.gs', 'Backup.gs', 'Notify.gs', 'Onboarding.gs', 'Orders.gs', 'Blog.gs', 'Code.gs'];
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

console.log('\n' + (failed ? '❌ 실패 ' + failed + '건 / 통과 ' + passed + '건' : '✅ 전부 통과 ' + passed + '건'));
process.exit(failed ? 1 : 0);
