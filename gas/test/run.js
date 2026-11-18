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
  const files = ['Setup.gs', 'Auth.gs', 'Backup.gs', 'Notify.gs', 'Onboarding.gs', 'Orders.gs', 'Code.gs'];
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

console.log('\n' + (failed ? '❌ 실패 ' + failed + '건 / 통과 ' + passed + '건' : '✅ 전부 통과 ' + passed + '건'));
process.exit(failed ? 1 : 0);
