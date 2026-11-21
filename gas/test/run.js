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
        deleteProperty: k => { props.delete(k); },
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
  const files = ['Setup.gs', 'Auth.gs', 'Backup.gs', 'Notify.gs', 'Onboarding.gs', 'Orders.gs', 'Upload.gs', 'Bgm.gs', 'Result.gs', 'Blog.gs', 'BlogSeo.gs', 'Insight.gs', 'Analytics.gs', 'PostDetail.gs', 'Code.gs'];
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
eq('허용 타입 5종(2026-11-21 content_draft 추가)', ev(A.ctx,'HUB_ORDER_TYPES').join(','), 'content_render,content_upload,content_stats,blog_neighbor,content_draft');
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

console.log('\n[8b] 영상 렌더 오더(계약 v1) — 큐에 실제 타입 content_render');
const okReply = { code: 200, body: JSON.stringify({ ok: true, item: { id: 'Q-20261119-210000-rend', status: 'WAITING_APPROVAL' }, needs_approval: true, risk_level: 'HIGH', approval_expires_at: '2026-11-19T21:15:00+09:00', note: '위험 작업 — 승인 필요' }) };
A.env.setFetchReply(okReply);
const goodRender = { type: 'content_render', content_id: 'CH-20261119-001', brand: 'daejeon_youth', inputs: ['01_외관.mp4', '02 메뉴판.mov'], profile: 'captions', crop_x: 0.4 };
const fetchedBefore = A.env.fetched.length;
o = callHandler(A.ctx, 'handleHubOrder_', null, goodRender, { brand: 'daejeon_youth' });
ok('렌더 오더 접수', o.ok, o);
const rs = A.env.fetched[A.env.fetched.length - 1];
ok('큐를 한 번 불렀다', A.env.fetched.length === fetchedBefore + 1);
eq('큐 타입은 content_render(claude_prompt 아님)', rs.body.type, 'content_render');
eq('payload 는 계약 키뿐', Object.keys(rs.body.payload).sort().join(','), 'brand,content_id,crop_x,inputs,profile');
ok('프롬프트·모드·엔진을 보내지 않는다(결정적 작업)', rs.body.payload.prompt === undefined && rs.body.payload.mode === undefined && rs.body.payload.engine === undefined);
eq('입력 파일 이름이 그대로', rs.body.payload.inputs.join('|'), '01_외관.mp4|02 메뉴판.mov');
eq('워크스페이스는 설정을 따른다', rs.body.workspace, 'content-hub');
eq('응답 queue_type', o.ok && o.data.queue_type, 'content_render');
eq('승인 필요를 돌려준다', o.ok && o.data.needs_approval, true);
eq('위험도를 돌려준다', o.ok && o.data.risk_level, 'HIGH');
ok('승인 기한을 돌려준다', o.ok && /2026-11-19T21:15/.test(o.data.approval_expires_at), o);
ok('큐 토큰은 응답에 없다', o.ok && !JSON.stringify(o.data).includes('portal-key'));

o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, goodRender, { profile: undefined, crop_x: undefined }), { brand: 'daejeon_youth' });
ok('profile·crop_x 생략 가능', o.ok, o);
const rs2 = A.env.fetched[A.env.fetched.length - 1];
eq('profile 기본 captions', rs2.body.payload.profile, 'captions');
ok('crop_x 를 만들어 넣지 않는다', !('crop_x' in rs2.body.payload));
ok('fit 을 만들어 넣지 않는다(비우면 노트북이 원본 방향으로 정한다)', !('fit' in rs2.body.payload));

console.log('\n[8b-2b] 프레이밍(fit) — crop · blur · pad 만 큐에 넘긴다');
o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, goodRender, { fit: ' BLUR ' }), { brand: 'daejeon_youth' });
ok('fit 이 있는 오더 접수', o.ok, o);
eq('fit 은 소문자로 큐에 실린다', A.env.fetched[A.env.fetched.length - 1].body.payload.fit, 'blur');
ok('fit 이 payload 키에 들어간다', Object.keys(A.env.fetched[A.env.fetched.length - 1].body.payload).indexOf('fit') >= 0);
['auto', 'left', 'CROPX'].forEach((f) => eq('거부: fit=' + f, callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, goodRender, { fit: f }), { brand: 'daejeon_youth' }).code, 'ERR_VALIDATION_FAILED'));

console.log('\n[8h] 사진 입력(content_render images) — 25장 · 영상 8개와 별개');
A.env.setFetchReply(okReply);
const photoNames = Array.from({ length: 25 }, (_, i) => '사진' + pad(i + 1) + '_' + (i < 2 ? '외관' : (i < 4 ? '음식' : '분위기')) + '.jpg');
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render', content_id: 'CH-20261121-IMG', brand: 'daejeon_youth', images: photoNames }, { brand: 'daejeon_youth' });
ok('사진 25장만으로 렌더 오더 접수(입력 영상 없음)', o.ok, o);
const rimg = A.env.fetched[A.env.fetched.length - 1].body;
eq('큐 타입은 content_render(claude_prompt 아님)', rimg.type, 'content_render');
ok('사진 이름은 그대로 · inputs 키는 없다', JSON.stringify(rimg.payload.images) === JSON.stringify(photoNames) && !('inputs' in rimg.payload), Object.keys(rimg.payload));
eq('응답 queue_type', o.ok && o.data.queue_type, 'content_render');
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render', content_id: 'CH-20261121-IMG', brand: 'daejeon_youth', images: ['a.jpg', 'a.jpg', 'b.webp'], photo_seconds: 3.456, xfade: 0.3 }, { brand: 'daejeon_youth' });
const rimg2 = A.env.fetched[A.env.fetched.length - 1].body.payload;
ok('사진 이름 중복은 버리고 순서는 지킨다', JSON.stringify(rimg2.images) === JSON.stringify(['a.jpg', 'b.webp']), rimg2.images);
ok('장당 길이·전환을 소수 2자리로 넘길 수 있다', rimg2.photo_seconds === 3.46 && rimg2.xfade === 0.3, rimg2);
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render', content_id: 'CH-20261121-IMG', brand: 'daejeon_youth', inputs: ['v.mp4'], images: ['a.jpg'] }, { brand: 'daejeon_youth' });
const rmix = A.env.fetched[A.env.fetched.length - 1].body.payload;
ok('영상+사진 섞어 보낼 수 있다', o.ok && rmix.inputs[0] === 'v.mp4' && rmix.images[0] === 'a.jpg', rmix);
const nImg = A.env.fetched.length;
[
  ['사진 빈 배열 + 영상 없음', { content_id: 'CH-1', brand: 'daejeon_youth', images: [] }],
  ['사진 26장', { content_id: 'CH-1', brand: 'daejeon_youth', images: Array.from({ length: 26 }, (_, i) => 'p' + i + '.jpg') }],
  ['사진 확장자 gif', { content_id: 'CH-1', brand: 'daejeon_youth', images: ['a.gif'] }],
  ['사진 경로', { content_id: 'CH-1', brand: 'daejeon_youth', images: ['../a.jpg'] }],
  ['사진 배열 아님', { content_id: 'CH-1', brand: 'daejeon_youth', images: 'a.jpg' }],
  ['영상·사진 같은 이름', { content_id: 'CH-1', brand: 'daejeon_youth', inputs: ['a.mp4'], images: ['a.mp4'] }],
  ['photo_seconds 범위 밖', { content_id: 'CH-1', brand: 'daejeon_youth', images: ['a.jpg'], photo_seconds: 20 }]
].forEach(([name, pl]) => eq('거부: ' + name, callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({ type: 'content_render' }, pl), { brand: 'daejeon_youth' }).code, 'ERR_VALIDATION_FAILED'));
ok('거부된 사진 오더는 큐를 부르지 않았다', A.env.fetched.length === nImg);
ok('images 키가 아예 없는 content_render 는 지금처럼 조립본 오더(claude_prompt)다', (function () {
  const before = A.env.fetched.length;
  const r = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render', channel: 'shorts', place_name: '미미삼겹' }, { brand: 'daejeon_youth' });
  return r.ok && A.env.fetched.length === before + 1 && A.env.fetched[A.env.fetched.length - 1].body.type === 'claude_prompt';
})());
A.env.setFetchReply(okReply);
ok('사진 25장 + 영상 8개 + 컷 150개 payload 도 큐 한도(4,000자) 안', (function () {
  const r = A.ctx.hubRenderPayload_({ content_id: 'CH-20261121-IMG', brand: 'daejeon_youth',
    inputs: Array.from({ length: 8 }, (_, i) => 'v' + i + '.mp4'), images: photoNames,
    cuts: Array.from({ length: 150 }, (_, i) => [i * 2, i * 2 + 1, i % 8]) });
  return JSON.stringify(r).length < 4000 && (r.payload_source === 'drive' || !r.captions);
})(), '큐 payload 가 4,000자를 넘으면 payload_source 가 스스로 바뀌어야 한다');

console.log('\n[8h-mv] 뮤직비디오 payload (2026-11-21 Phase 1)');
{
  const mvPhotos = ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg'];
  const goodMv = {
    type: 'content_render', content_id: 'CH-20261121-MV1', brand: 'daejeon_youth', mode: 'mv', images: mvPhotos,
    mv: { audio: '내 노래.mp3', density: 'fast_2beat', effects: 'pulse', mood: 'pop', length_sec: 30, lyric_mode: 'mine', lyrics: '첫 줄\n둘째 줄' }
  };
  const beforeMv = A.env.fetched.length;
  const oMv = callHandler(A.ctx, 'handleHubOrder_', null, goodMv, { brand: 'daejeon_youth' });
  ok('뮤직비디오 오더 접수(큐 타입은 content_render)', oMv.ok && A.env.fetched.length === beforeMv + 1 && A.env.fetched[A.env.fetched.length - 1].body.type === 'content_render', oMv);
  const pMv = A.env.fetched[A.env.fetched.length - 1].body.payload;
  ok('payload: mode mv · 사진 이름 · 음원 이름만(경로 없음)', pMv.mode === 'mv' && pMv.images.join() === mvPhotos.join() && pMv.mv.audio === '내 노래.mp3' && pMv.profile === 'captions', pMv);
  ok('payload: 가사 줄과 줄 수', pMv.mv.lyrics === '첫 줄\n둘째 줄' && pMv.mv.lines === 2 && pMv.mv.density === 'fast_2beat' && pMv.mv.length_sec === 30, pMv.mv);
  ok('기본값: 밀도 1마디 · 이펙트 pulse · 길이 곡 끝 · 가사 모드 내 가사 · BPM 자동', (function () {
    const r = A.ctx.hubRenderPayload_({ content_id: 'CH-1', brand: 'daejeon_youth', mode: 'mv', images: mvPhotos, mv: { audio: 'a.m4a' } });
    return r.mv.density === 'normal_4beat' && r.mv.effects === 'pulse' && r.mv.length_sec === 0 && r.mv.lyric_mode === 'mine' && r.mv.bpm_hint === 0;
  })());
  ok('긴 가사는 큐에 안 싣고 payload_source:drive 로 보낸다(카드에서 읽게)', (function () {
    const r = A.ctx.hubRenderPayload_({ content_id: 'CH-1', brand: 'daejeon_youth', mode: 'mv', images: mvPhotos, mv: { audio: 'a.mp3', lyrics: '가나다라마바사아자차카타파하 '.repeat(160) } });
    return r.payload_source === 'drive' && !r.mv.lyrics && r.mv.lines === 1 && JSON.stringify(r).length <= 3500;
  })());
  ok('연주곡(lyric_mode none)은 가사를 버린다', (function () {
    const r = A.ctx.hubRenderPayload_({ content_id: 'CH-1', brand: 'daejeon_youth', mode: 'mv', images: mvPhotos, mv: { audio: 'a.mp3', lyric_mode: 'none', lyrics: '가사' } });
    return !r.mv.lyrics && r.mv.lines === 0;
  })());
  ok('내 음원 이름은 한글·공백·m4a 까지 받는다', (function () {
    const r = A.ctx.hubRenderPayload_({ content_id: 'CH-1', brand: 'daejeon_youth', mode: 'mv', images: mvPhotos, mv: { audio: '내 노래 v2.m4a' } });
    return r.mv.audio === '내 노래 v2.m4a';
  })());
  const nBeforeBad = A.env.fetched.length;
  [
    ['사진 2장', { images: ['a.jpg', 'b.jpg'], mv: { audio: 'a.mp3' } }],
    ['음원 없음', { images: mvPhotos, mv: {} }],
    ['음원 경로', { images: mvPhotos, mv: { audio: '../a.mp3' } }],
    ['음원 확장자', { images: mvPhotos, mv: { audio: 'a.exe' } }],
    ['밀도 값', { images: mvPhotos, mv: { audio: 'a.mp3', density: 'x' } }],
    ['이펙트 값', { images: mvPhotos, mv: { audio: 'a.mp3', effects: 'flash' } }],
    ['분위기 값', { images: mvPhotos, mv: { audio: 'a.mp3', mood: 'jazz' } }],
    ['길이 범위', { images: mvPhotos, mv: { audio: 'a.mp3', length_sec: 999 } }],
    ['BPM 범위', { images: mvPhotos, mv: { audio: 'a.mp3', bpm_hint: 900 } }],
    ['영상까지 섞음', { images: mvPhotos, inputs: ['a.mp4'], mv: { audio: 'a.mp3' } }],
    ['모르는 mode', { mode: 'mv2', images: mvPhotos, mv: { audio: 'a.mp3' } }]
  ].forEach(([name, pl]) => eq('거부: ' + name, callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({ type: 'content_render', content_id: 'CH-20261121-MV1', brand: 'daejeon_youth', mode: 'mv' }, pl), { brand: 'daejeon_youth' }).code, 'ERR_VALIDATION_FAILED'));
  ok('거부된 뮤직비디오 오더는 큐를 부르지 않았다', A.env.fetched.length === nBeforeBad);
}

console.log('\n[8h-lock] 무음 보조 글자·첫 프레임 잠금 (2026-11-21)');
{
  const baseLock = { content_id: 'CH-20261121-LOCK', brand: 'daejeon_youth', inputs: ['a.mp4', 'b.mp4'] };
  const pL = A.ctx.hubRenderPayload_(Object.assign({}, baseLock, { template: 'daejeon_youth', hook: '이 가격 실화냐?', hook_sub: '끝까지 보셈 진짜로', frame_lock: true, frame_lock_image: 'mary_front.jpg', frame_lock_seconds: 0.04 }));
  ok('hook_sub 는 6자에서 자른다', pL.hook_sub === '끝까지 보셈', pL.hook_sub);
  ok('frame_lock 세 칸이 payload 에 실린다', pL.frame_lock === true && pL.frame_lock_image === 'mary_front.jpg' && pL.frame_lock_seconds === 0.04, pL);
  const offL = A.ctx.hubRenderPayload_(Object.assign({}, baseLock, { frame_lock: false, frame_lock_image: 'm.jpg' }));
  ok('frame_lock 이 꺼져 있으면 사진을 버린다', offL.frame_lock === undefined && offL.frame_lock_image === undefined, offL);
  const rejectL = (pl) => { try { A.ctx.hubRenderPayload_(Object.assign({}, baseLock, pl)); return false; } catch (e) { return e.code === 'ERR_VALIDATION_FAILED'; } };
  ok('거부: frame_lock 문자열 · 사진 경로 · 사진 확장자 · 길이 범위',
    rejectL({ frame_lock: 'yes' }) && rejectL({ frame_lock: true, frame_lock_image: '../m.jpg' }) && rejectL({ frame_lock: true, frame_lock_image: 'm.gif' }) && rejectL({ frame_lock: true, frame_lock_seconds: 2 }));
  ok('사진 없이 잠그기만 해도 통과(잇기만 한다)', (() => { const r = A.ctx.hubRenderPayload_(Object.assign({}, baseLock, { frame_lock: true })); return r.frame_lock === true && r.frame_lock_image === undefined; })());
  ok('hook_sub·frame_lock 이 붙고도 큐 한도(4,000자) 안', JSON.stringify(pL).length < 4000, JSON.stringify(pL).length);
}

console.log('\n[8i] content_draft — 초안 생성(LOW · 파일 안 고침)');
const nodeCrypto = require('crypto');
const sha = (t) => nodeCrypto.createHash('sha256').update(String(t), 'utf8').digest('hex');
const blocksIn = ['첫 문단 원문입니다.', '둘째 문단은 두 줄로\n되어 있습니다.'];
const blockObjs = blocksIn.map((t, i) => ({ id: 'U' + (i + 1), origin: 'USER', text: t, sha256: sha(t) }));
const memoHash = sha(blocksIn.join('\n\n'));
const goodDraft = {
  type: 'content_draft', content_id: 'CH-20261121-DR1', brand: 'daejeon_youth', format: 'blog',
  concept: { kind: 'review', tone: 'plain', hint: '웃긴데 정보는 정확하게' },
  facts: { place_name: '미미삼겹', price_menu: '삼겹 16,000원' },
  memo_sha256: memoHash, blocks: blockObjs,
  media: [{ name: '사진01_외관.jpg', role: '외관' }],
  ask: { titles: 3, bridge: true, captions: true, outro: true }
};
o = callHandler(A.ctx, 'handleHubOrder_', null, goodDraft, { brand: 'daejeon_youth' });
ok('초안 오더 접수', o.ok, o);
const rdr = A.env.fetched[A.env.fetched.length - 1].body;
eq('큐 타입은 content_draft(claude_prompt 아님)', rdr.type, 'content_draft');
eq('응답 queue_type', o.ok && o.data.queue_type, 'content_draft');
ok('블록은 USER·해시 둘 다 보낸다', rdr.payload.blocks[0].origin === 'USER' && rdr.payload.blocks[0].sha256 === sha(blocksIn[0]), rdr.payload.blocks[0]);
eq('개념·장르·요청은 그대로', rdr.payload.concept.kind + '/' + rdr.payload.concept.tone + '/' + rdr.payload.ask.titles, 'review/plain/3');
eq('사진 이름·역할만 보낸다(내용·바이트 없음)', JSON.stringify(rdr.payload.media), JSON.stringify([{ name: '사진01_외관.jpg', role: '외관' }]));
ok('팩트는 400자로 자르고 허용 키만', (function () {
  const r = A.ctx.hubDraftPayload_(Object.assign({}, goodDraft, { facts: { place_name: '가'.repeat(500), evil: 'x' } }));
  return r.facts.place_name.length === 400 && !('evil' in r.facts);
})());
o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, goodDraft, { format: 'video', length_sec: 30, content_id: 'CH-20261121-DR2' }), { brand: 'daejeon_youth' });
ok('영상 대본 오더 접수 · 길이 포함', o.ok && A.env.fetched[A.env.fetched.length - 1].body.payload.length_sec === 30, o);
const nDr = A.env.fetched.length;
[
  ['허용 외 필드', { evil: 1 }],
  ['format 틀림', { format: 'shorts' }],
  ['brand 틀림', { brand: 'x' }],
  ['concept.kind 틀림', { concept: { kind: 'hack' } }],
  ['concept.tone 틀림', { concept: { tone: 'shout' } }],
  ['memo_sha256 없음', { memo_sha256: '' }],
  ['memo_sha256 형식', { memo_sha256: 'abc' }],
  ['블록 해시 불일치', { blocks: [{ id: 'U1', text: '바뀐 문단', sha256: sha('원래 문단') }] }],
  ['메모 해시 불일치', { memo_sha256: sha('다른 메모') }],
  ['블록에 sha256 없음', { blocks: [{ id: 'U1', text: blocksIn[0] }] }],
  ['블록이 AI_ADD', { blocks: [{ id: 'U1', origin: 'AI_ADD', text: blocksIn[0], sha256: sha(blocksIn[0]) }] }],
  ['블록 61개', { blocks: Array.from({ length: 61 }, (_, i) => ({ id: 'U' + i, text: 'x' + i, sha256: sha('x' + i) })), memo_sha256: sha(Array.from({ length: 61 }, (_, i) => 'x' + i).join('\n\n')) }],
  ['사진 26장', { media: Array.from({ length: 26 }, (_, i) => ({ name: 'p' + i + '.jpg' })) }],
  ['payload_source 틀림', { payload_source: 'sheet' }],
  ['titles 5', { ask: { titles: 5 } }]
].forEach(([name, patch]) => eq('거부: ' + name, callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, goodDraft, patch), { brand: 'daejeon_youth' }).code, 'ERR_VALIDATION_FAILED'));
ok('거부된 초안 오더는 큐를 부르지 않았다', A.env.fetched.length === nDr);
ok('긴 메모는 문장을 자르지 않고 payload_source:drive 로 바꾼다', (function () {
  const parts = Array.from({ length: 12 }, (_, i) => ('문단' + i + ' ').repeat(60));
  const long = parts.join('\n\n');
  const bs = parts.map((t, i) => ({ id: 'U' + (i + 1), text: t, sha256: sha(t) }));
  const r = A.ctx.hubDraftPayload_(Object.assign({}, goodDraft, { blocks: bs, memo_sha256: sha(long), facts: { place_name: '미미삼겹'.repeat(30) } }));
  return r.payload_source === 'drive' && !r.blocks && !r.facts && JSON.stringify(r).length <= 3500;
})());
ok('drive 모드도 블록 없이 접수된다(워커가 카드에서 읽는다)', (function () {
  const r = A.ctx.hubDraftPayload_({ content_id: 'CH-1', brand: 'daejeon_youth', format: 'blog', memo_sha256: memoHash, payload_source: 'drive' });
  return r.payload_source === 'drive' && !r.blocks;
})());
A.env.setFetchReply({ code: 200, body: JSON.stringify({ ok: false, error: { code: 'ERR_UNKNOWN_TYPE', message: '허용되지 않은 작업 타입입니다: content_draft' } }) });
o = callHandler(A.ctx, 'handleHubOrder_', null, goodDraft, { brand: 'daejeon_youth' });
eq('큐가 content_draft 를 모르면 같은 안내(ERR_QUEUE_TYPE_UNKNOWN)', o.code, 'ERR_QUEUE_TYPE_UNKNOWN');
ok('무엇을 배포해야 하는지 말한다(초안 생성)', /content_draft/.test(o.message || '') && /배포/.test(o.message || ''), o.message);
A.env.setFetchReply(okReply);

console.log('\n[8j] 초안 결과 저장 — update_content patch_mode:deep (하위 키만 합친다)');
ok('deepMergeObjects_ 가 있다', typeof ev(A.ctx, 'deepMergeObjects_') === 'function');
(function () {
  const before = { studio: { formats: { video: { steps: 3 } }, meta: { format: 'video' } }, production: { captions: [[0, 1, '가']] } };
  const after = ev(A.ctx, 'deepMergeObjects_')(before, { studio: { formats: { blog: { draft: { titles: ['a'] } } }, meta: { format: 'blog' } } });
  ok('깊은 병합: 다른 포맷(영상)은 남고 초안만 더해진다', after.studio.formats.video.steps === 3 && after.studio.formats.blog.draft.titles[0] === 'a', after.studio);
  ok('깊은 병합: 배열은 통째로 바꾸고 없는 키는 보존', JSON.stringify(after.production.captions) === JSON.stringify([[0, 1, '가']]) && after.studio.meta.format === 'blog');
  ok('깊이 9 이상은 그대로 교체(스택 보호)', (function () {
    let deep = { v: 1 };
    for (let i = 0; i < 12; i++) deep = { n: deep };
    const r = ev(A.ctx, 'deepMergeObjects_')({ n: { n: { keep: 1 } } }, deep);
    return !!r && typeof r === 'object';
  })());
})();

console.log('\n[8b-2] 컷(잘라낼 구간) — 짧은 모양으로 큐에 보낸다');
A.env.setFetchReply(okReply);
o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, goodRender, { inputs: ['a.mp4'], cuts: [[1.234, 2.5], { from: 4, to: 5 }] }), { brand: 'daejeon_youth' });
ok('컷이 있는 오더 접수', o.ok, o);
eq('응답이 접수한 컷 개수를 알려 준다(옛 GAS 는 이 값이 없어 화면이 알아챈다)', o.ok && o.data.cuts, 2);
const rcut = A.env.fetched[A.env.fetched.length - 1];
eq('영상 1개면 [from,to] 로 줄여 보낸다(소수 2자리)', JSON.stringify(rcut.body.payload.cuts), JSON.stringify([[1.23, 2.5], [4, 5]]));
ok('payload 키에 cuts 가 더해진다', Object.keys(rcut.body.payload).indexOf('cuts') >= 0);
o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, goodRender, { cuts: [[1, 2, 1], { from: 3, to: 4, file: 0 }] }), { brand: 'daejeon_youth' });
eq('영상이 둘이면 [from,to,파일번호]', JSON.stringify(A.env.fetched[A.env.fetched.length - 1].body.payload.cuts), JSON.stringify([[1, 2, 1], [3, 4, 0]]));
o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, goodRender, { cuts: [] }), { brand: 'daejeon_youth' });
ok('cuts 가 빈 목록이면 키를 넣지 않는다', o.ok && !('cuts' in A.env.fetched[A.env.fetched.length - 1].body.payload));
const nCut = A.env.fetched.length;
const one = Object.assign({}, goodRender, { inputs: ['a.mp4'] });
[
  ['cuts 가 배열 아님', 'x', goodRender],
  ['to<=from', [[2, 1]], one],
  ['음수', [[-1, 1]], one],
  ['숫자 아님', [['a', 3]], one],
  ['영상이 둘인데 파일 번호 없음', [[1, 2]], goodRender],
  ['파일 번호 범위 밖', [[1, 2, 5]], goodRender],
  ['151개', Array.from({ length: 151 }, (_, i) => [i * 2, i * 2 + 1]), one],
  ['구간 1시간 초과', [[0, 3601]], one],
  ['반올림하면 0초', [[1.001, 1.004]], one]
].forEach(([name, cuts, base]) => eq('거부: ' + name, callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, base, { cuts }), { brand: 'daejeon_youth' }).code, 'ERR_VALIDATION_FAILED'));
ok('거부된 컷 오더는 큐를 부르지 않았다', A.env.fetched.length === nCut);
o = callHandler(A.ctx, 'handleHubOrder_', null, goodRender, { brand: 'daejeon_youth' });
eq('컷이 없으면 0개로 알려 준다', o.ok && o.data.cuts, 0);

console.log('\n[8b-3] 완제품 옵션 — 자막 번인 · 내레이션을 큐에 넘긴다');
const oneIn = Object.assign({}, goodRender, { inputs: ['a.mp4'] });
A.env.setFetchReply(okReply);
o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, oneIn, {
  captions: [{ start: 0.234, end: 1.4, text: '오토바이 여러 대' }], sub_style: 'long'
}), { brand: 'daejeon_youth' });
ok('자막이 있는 렌더 오더 접수', o.ok, o);
const rcap = A.env.fetched[A.env.fetched.length - 1].body.payload;
eq('자막 큐는 [start,end,text] 로 줄여 보낸다', JSON.stringify(rcap.captions), JSON.stringify([[0.23, 1.4, '오토바이 여러 대']]));
eq('sub_style 을 그대로 넘긴다', rcap.sub_style, 'long');
eq('응답이 접수한 자막 큐 수를 알려 준다(옛 GAS 는 없어 화면이 알아챈다)', o.ok && o.data.captions, 1);
o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, oneIn, {
  captions: [[0, 2, '가']], narration: [[0, 2, '와! 대박', 'hype']], narrate: true, voice: 'ko-KR-SunHiNeural', burn_subtitles: false
}), { brand: 'daejeon_youth' });
const rnar = A.env.fetched[A.env.fetched.length - 1].body.payload;
ok('내레이션 톤·보이스·narrate 를 넘긴다', o.ok && JSON.stringify(rnar.narration) === JSON.stringify([[0, 2, '와! 대박', 'hype']]) && rnar.voice === 'ko-KR-SunHiNeural' && rnar.narrate === true, rnar);
eq('burn_subtitles:false 도 그대로 넘긴다', rnar.burn_subtitles, false);
o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, oneIn, {
  captions: Array.from({ length: 45 }, (_, i) => [i * 0.5, i * 0.5 + 0.4, '자' + i])
}), { brand: 'daejeon_youth' });
const rdrive = A.env.fetched[A.env.fetched.length - 1].body.payload;
ok('큐가 40개를 넘으면 payload_source:drive 로만 보낸다(인라인 제거)', o.ok && rdrive.payload_source === 'drive' && !('captions' in rdrive), Object.keys(rdrive));
ok('drive payload 는 4,000자 안에 들어간다', JSON.stringify(rdrive).length < 4000);
const nCap = A.env.fetched.length;
[
  ['captions 배열 아님', Object.assign({}, oneIn, { captions: 'x' })],
  ['자막 문장 빈 값', Object.assign({}, oneIn, { captions: [[0, 1, ' ']] })],
  ['자막 끝<=시작', Object.assign({}, oneIn, { captions: [[2, 1, '가']] })],
  ['자막 200자 초과', Object.assign({}, oneIn, { captions: [[0, 1, '가'.repeat(201)]] })],
  ['내레이션 톤 틀림', Object.assign({}, oneIn, { narration: [[0, 2, '가', 'shout']] })],
  ['sub_style 틀림', Object.assign({}, oneIn, { captions: [[0, 1, '가']], sub_style: 'big' })],
  ['payload_source 틀림', Object.assign({}, oneIn, { payload_source: 'sheet' })],
  ['voice 형식 틀림', Object.assign({}, oneIn, { voice: 'sunhi' })],
  ['narrate 문자열', Object.assign({}, oneIn, { narrate: 'yes' })]
].forEach(([name, pl]) => eq('거부: ' + name, callHandler(A.ctx, 'handleHubOrder_', null, pl, { brand: 'daejeon_youth' }).code, 'ERR_VALIDATION_FAILED'));
ok('거부된 자막 오더는 큐를 부르지 않았다', A.env.fetched.length === nCap);

console.log('\n[8b-3] 영상 렌더 2·3단계 오더(stage) — 클린 마스터를 이어받는다(원본 이름 없음)');
A.env.setFetchReply(okReply);
const stBase = { type: 'content_render', content_id: 'KM-20261120-001', brand: 'ppiyak_kimmary' };
const sentOf = () => A.env.fetched[A.env.fetched.length - 1].body;
o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, stBase, { stage: 'transcribe', inputs: ['x.mp4'], junk: 1 }), { brand: 'ppiyak_kimmary' });
ok('자막 초안 오더 접수 · 큐 타입은 content_render', o.ok && sentOf().type === 'content_render', o);
eq('payload 는 content_id·brand·stage 뿐(원본 이름·모르는 필드는 버린다)', JSON.stringify(sentOf().payload), JSON.stringify({ content_id: 'KM-20261120-001', brand: 'ppiyak_kimmary', stage: 'transcribe' }));
o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, stBase, { stage: 'finish', burn: true, ai_notice: true, bgm: { name: '잔잔한 곡.mp3', volume_db: -22 }, cover: { t: 2.345 }, evil: 'x' }), { brand: 'ppiyak_kimmary' });
ok('마무리 오더 접수', o.ok, o);
eq('마무리 payload: 옵션만 · 커버 시각은 소수 2자리', JSON.stringify(sentOf().payload), JSON.stringify({ content_id: 'KM-20261120-001', brand: 'ppiyak_kimmary', stage: 'finish', burn: true, ai_notice: true, bgm: { name: '잔잔한 곡.mp3', volume_db: -22 }, cover: { t: 2.35 } }));
o = callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, stBase, { stage: 'finish' }), { brand: 'ppiyak_kimmary' });
eq('마무리 기본값: 자막 굽기 켬 · AI 안내 끔 · BGM·커버 없음', JSON.stringify(sentOf().payload), JSON.stringify({ content_id: 'KM-20261120-001', brand: 'ppiyak_kimmary', stage: 'finish', burn: true, ai_notice: false }));
const nSt = A.env.fetched.length;
[
  ['모르는 stage', { stage: 'hack' }],
  ['BGM 경로', { stage: 'finish', bgm: { name: '../x.mp3' } }],
  ['BGM 확장자', { stage: 'finish', bgm: { name: 'x.exe' } }],
  ['BGM 볼륨 범위 밖', { stage: 'finish', bgm: { name: 'x.mp3', volume_db: 3 } }],
  ['커버 시각 범위 밖', { stage: 'finish', cover: { t: 5000 } }],
  ['커버 시각 숫자 아님', { stage: 'finish', cover: { t: 'a' } }],
  ['content_id 경로', { stage: 'transcribe', content_id: '../x' }],
  ['brand 틀림', { stage: 'transcribe', brand: 'x' }]
].forEach(([name, patch]) => eq('거부: ' + name, callHandler(A.ctx, 'handleHubOrder_', null, Object.assign({}, stBase, patch), { brand: 'ppiyak_kimmary' }).code, 'ERR_VALIDATION_FAILED'));
ok('거부된 단계 오더는 큐를 부르지 않았다', A.env.fetched.length === nSt);

console.log('\n[8c] 렌더 오더 입력 검증 — 큐를 부르기 전에 막는다');
const n0 = A.env.fetched.length;
const badCases = [
  ['content_id 에 경로', Object.assign({}, goodRender, { content_id: '../x' })],
  ['content_id 41자', Object.assign({}, goodRender, { content_id: 'a'.repeat(41) })],
  ['brand 틀림', Object.assign({}, goodRender, { brand: 'other' })],
  ['inputs 비어 있음', Object.assign({}, goodRender, { inputs: [] })],
  ['inputs 9개', Object.assign({}, goodRender, { inputs: Array.from({ length: 9 }, (_, i) => 'v' + i + '.mp4') })],
  ['경로 구분자', Object.assign({}, goodRender, { inputs: ['a/b.mp4'] })],
  ['역슬래시', Object.assign({}, goodRender, { inputs: ['a\b.mp4'] })],
  ['상위 경로 ..', Object.assign({}, goodRender, { inputs: ['a..mp4'] })],
  ['점으로 시작', Object.assign({}, goodRender, { inputs: ['.hidden.mp4'] })],
  ['확장자 txt', Object.assign({}, goodRender, { inputs: ['a.txt'] })],
  ['문자열 아님', Object.assign({}, goodRender, { inputs: [123] })],
  ['profile 틀림', Object.assign({}, goodRender, { profile: 'loud' })],
  ['crop_x 범위 밖', Object.assign({}, goodRender, { crop_x: 1.5 })],
  ['crop_x 숫자 아님', Object.assign({}, goodRender, { crop_x: 'left' })]
];
badCases.forEach(([name, pl]) => {
  const r = callHandler(A.ctx, 'handleHubOrder_', null, pl, { brand: 'daejeon_youth' });
  eq('거부: ' + name, r.code, 'ERR_VALIDATION_FAILED');
});
ok('거부된 오더는 큐를 부르지 않았다', A.env.fetched.length === n0);

console.log('\n[8d] 큐가 content_render 를 아직 모를 때(배포 전) — 앱이 깨지지 않게');
A.env.setFetchReply({ code: 200, body: JSON.stringify({ ok: false, error: { code: 'ERR_UNKNOWN_TYPE', message: '허용되지 않은 작업 타입입니다: content_render' } }) });
const n1 = A.env.fetched.length;
o = callHandler(A.ctx, 'handleHubOrder_', null, goodRender, { brand: 'daejeon_youth' });
eq('ERR_QUEUE_TYPE_UNKNOWN 으로 알린다', o.code, 'ERR_QUEUE_TYPE_UNKNOWN');
ok('무엇을 하면 되는지 말한다(새 버전 배포)', /새 버전/.test(o.message || ''), o.message);
ok('큐를 한 번만 불렀다 — claude_prompt 로 되돌려 다시 보내지 않는다', A.env.fetched.length === n1 + 1 && A.env.fetched[n1].body.type === 'content_render');
A.env.setFetchReply({ code: 200, body: JSON.stringify({ ok: false, error: '허용되지 않은 작업 타입입니다: content_render' }) });
o = callHandler(A.ctx, 'handleHubOrder_', null, goodRender, { brand: 'daejeon_youth' });
eq('문자열 오류도 같은 코드', o.code, 'ERR_QUEUE_TYPE_UNKNOWN');
A.env.setFetchReply({ code: 200, body: JSON.stringify({ ok: false, error: { code: 'busy', message: '다른 저장이 진행 중이에요' } }) });
o = callHandler(A.ctx, 'handleHubOrder_', null, goodRender, { brand: 'daejeon_youth' });
eq('다른 거절은 그대로 ERR_QUEUE_REJECTED', o.code, 'ERR_QUEUE_REJECTED');

console.log('\n[8e] 옛 content_render(inputs 없음, #/create 조립본 오더)는 그대로 claude_prompt');
A.env.setFetchReply(okReply);
o = callHandler(A.ctx, 'handleHubOrder_', null, { type: 'content_render', channel: 'shorts', place_name: '미미삼겹', slot_count: 7 }, { brand: 'daejeon_youth' });
ok('옛 오더 접수', o.ok, o);
const rs3 = A.env.fetched[A.env.fetched.length - 1];
eq('큐 타입 claude_prompt', rs3.body.type, 'claude_prompt');
eq('mode=edit', rs3.body.payload.mode, 'edit');
eq('응답 queue_type', o.ok && o.data.queue_type, 'claude_prompt');

console.log('\n[8f] 오더 진행 상태 (hub_order_status) — 읽기 전용, 큐 queue_list 한 번');
eq('hub_order_status 는 읽기', ev(A.ctx, 'ACTION_WHITELIST').hub_order_status.mode, 'READ');
ok('핸들러가 등록됨', typeof ev(A.ctx, 'M1_HANDLERS').hub_order_status === 'function');
ok('긴 외부 호출이라 라우터 락을 잡지 않는다', ev(A.ctx, 'ACTION_WHITELIST').hub_order_status.longRunning === true);
{
  const ST = (extra) => Object.assign({ id: 'Q-20261119-210000-rend', type: 'content_render', status: 'RUNNING', risk_level: 'HIGH',
    created_at: '2026-11-19T21:00:00+09:00', started_at: '2026-11-19T21:01:00+09:00', beat_at: '2026-11-19T21:02:00+09:00',
    finished_at: '', approval_expires_at: '2026-11-19T21:15:00+09:00', result: '', error: '', summary: '영상 렌더 → CH-1', needs_decision: false,
    changed_files: 'x', branch: 'secret-branch' }, extra || {});
  const listReply = (items) => ({ code: 200, body: JSON.stringify({ ok: true, items: items, count: items.length }) });

  // 입력 검증 — 큐를 부르지 않는다
  const b0 = A.env.fetched.length;
  ['', 'Q-1', '../x', 'Q-20261119-210000-REND', 'Q-20261119-210000-rend; DROP', 'x'.repeat(200)].forEach((bad) => {
    eq('order_id 형식 거부: ' + JSON.stringify(bad).slice(0, 30), callHandler(A.ctx, 'handleHubOrderStatus_', null, { order_id: bad }).code, 'ERR_VALIDATION_FAILED');
  });
  ok('형식 검증은 큐를 부르기 전에 끝난다', A.env.fetched.length === b0);

  // 설정 없음
  const savedUrl = A.env.props.get('QUEUE_EXEC_URL'), savedTok = A.env.props.get('QUEUE_TOKEN');
  A.env.props.delete('QUEUE_EXEC_URL');
  eq('QUEUE_EXEC_URL 없음', callHandler(A.ctx, 'handleHubOrderStatus_', null, { order_id: 'Q-20261119-210000-rend' }).code, 'ERR_SERVER_CONFIG');
  A.env.props.set('QUEUE_EXEC_URL', 'https://example.com/not-gas');
  eq('큐 주소 형식이 아니면 거부', callHandler(A.ctx, 'handleHubOrderStatus_', null, { order_id: 'Q-20261119-210000-rend' }).code, 'ERR_SERVER_CONFIG');
  A.env.props.set('QUEUE_EXEC_URL', savedUrl);
  A.env.props.delete('QUEUE_TOKEN');
  eq('QUEUE_TOKEN 없음', callHandler(A.ctx, 'handleHubOrderStatus_', null, { order_id: 'Q-20261119-210000-rend' }).code, 'ERR_SERVER_CONFIG');
  A.env.props.set('QUEUE_TOKEN', savedTok);

  // 정상
  A.env.setFetchReply(listReply([ST({ id: 'Q-20261119-200000-aaaa', status: 'DONE' }), ST()]));
  const nb = A.env.fetched.length;
  let s = callHandler(A.ctx, 'handleHubOrderStatus_', null, { order_id: 'Q-20261119-210000-rend' });
  ok('상태 조회 성공', s.ok, s);
  eq('그 id 의 항목만 고른다(다른 오더 DONE 이 섞이지 않는다)', s.ok && s.data.status, 'RUNNING');
  const sent = A.env.fetched[A.env.fetched.length - 1];
  ok('큐를 한 번만 불렀다', A.env.fetched.length === nb + 1);
  eq('큐 본문은 queue_list(읽기)', sent.body.action, 'queue_list');
  eq('포털 상한 20건', sent.body.limit, 20);
  ok('큐 토큰은 본문에만, 응답에는 없다', sent.body.key === 'portal-key-for-test-0123456789abcdef' && !JSON.stringify(s.data).includes('portal-key'));
  eq('돌려주는 필드는 정해진 것뿐', Object.keys(s.data).sort().join(','),
    'approval_expires_at,beat_at,created_at,error,finished_at,order_id,result,risk_level,started_at,status,type');
  ok('큐의 다른 필드(branch·changed_files·summary)는 내려가지 않는다', !/secret-branch|changed_files|summary/.test(JSON.stringify(s.data)));

  // 길이 제한 · 대소문자
  A.env.setFetchReply(listReply([ST({ status: 'done', result: 'r'.repeat(900), error: 'e'.repeat(900) })]));
  s = callHandler(A.ctx, 'handleHubOrderStatus_', null, { order_id: 'Q-20261119-210000-rend' });
  ok('result·error 는 300자로 자른다', s.ok && s.data.result.length === 300 && s.data.error.length === 300, s.data && s.data.result.length);
  eq('status 는 대문자로', s.ok && s.data.status, 'DONE');

  // 없는 id
  A.env.setFetchReply(listReply([ST({ id: 'Q-20261119-200000-aaaa' })]));
  s = callHandler(A.ctx, 'handleHubOrderStatus_', null, { order_id: 'Q-20261119-210000-rend' });
  eq('목록에 없으면 ERR_NOT_FOUND', s.code, 'ERR_NOT_FOUND');
  ok('안내 문구에 20건 한계를 말한다', /20건/.test(s.message || ''), s.message);

  // 큐 거절 · 장애
  A.env.setFetchReply({ code: 200, body: JSON.stringify({ ok: false, error: 'unauthorized' }) });
  eq('큐 거절은 ERR_QUEUE_REJECTED', callHandler(A.ctx, 'handleHubOrderStatus_', null, { order_id: 'Q-20261119-210000-rend' }).code, 'ERR_QUEUE_REJECTED');
  A.env.setFetchReply({ code: 200, body: '<html>로그인</html>' });
  eq('JSON 이 아니면 ERR_QUEUE_UNREACHABLE', callHandler(A.ctx, 'handleHubOrderStatus_', null, { order_id: 'Q-20261119-210000-rend' }).code, 'ERR_QUEUE_UNREACHABLE');
  A.env.setFetchReply({ throw: 'DNS 실패' });
  s = callHandler(A.ctx, 'handleHubOrderStatus_', null, { order_id: 'Q-20261119-210000-rend' });
  eq('네트워크 실패도 ERR_QUEUE_UNREACHABLE', s.code, 'ERR_QUEUE_UNREACHABLE');
  ok('오류 문구에 토큰이 새지 않는다', !/portal-key/.test(s.message || ''), s.message);
  A.env.setFetchReply(okReply);
}

console.log('\n[8g] 포털 오더함 큐가 content_render 를 모를 때(code "type") — 같은 안내');
A.env.setFetchReply({ code: 200, body: JSON.stringify({ ok: false, code: 'type', error: '이 오더함에서는 보낼 수 없는 오더예요.' }) });
o = callHandler(A.ctx, 'handleHubOrder_', null, goodRender, { brand: 'daejeon_youth' });
eq('포털식 거절도 ERR_QUEUE_TYPE_UNKNOWN', o.code, 'ERR_QUEUE_TYPE_UNKNOWN');
A.env.setFetchReply({ code: 200, body: JSON.stringify({ ok: false, error: { code: 'type', message: '이 오더함에서는 보낼 수 없는 오더예요.' } }) });
o = callHandler(A.ctx, 'handleHubOrder_', null, goodRender, { brand: 'daejeon_youth' });
eq('객체 형태 type 거절도 같은 코드', o.code, 'ERR_QUEUE_TYPE_UNKNOWN');
A.env.setFetchReply(okReply);

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

  /* 쇼츠 3지표 진단 카드가 넣는 값 — 평균 시청 지속(초)을 LATEST 한 줄로 받는다 (2026-11-21) */
  console.log('\n[A3] 성과 숫자 입력 — 진단 카드의 평균 시청 지속');
  {
    const before = metrics.getLastRow();
    const rec = callHandler(G.ctx, 'handleRecordMetrics_', ss2, {
      items: [{ content_id: 'DY-1', channel: 'shorts', snapshot: 'LATEST', avg_dwell_sec: 18, measured_at: '2026-11-21' }]
    }, { brand: 'daejeon_youth' });
    ok('LATEST 시점도 저장된다', rec.ok && rec.data.count === 1, rec);
    eq('Metrics 에 한 줄 추가', metrics.getLastRow() - before, 1);
    const mh = metrics.rows[0];
    const last = metrics.rows[metrics.rows.length - 1];
    eq('시점은 LATEST', String(last[mh.indexOf('checkpoint')]), 'LATEST');
    eq('평균 시청 지속 18초', Number(last[mh.indexOf('avg_dwell_sec')]), 18);
    eq('브랜드는 요청에서 채운다', String(last[mh.indexOf('brand')]), 'daejeon_youth');
    eq('조회는 비워도 0 (추정하지 않음)', Number(last[mh.indexOf('views')]), 0);
    const lm = callHandler(G.ctx, 'handleListMetrics_', ss2, { brand: 'daejeon_youth', channel: 'shorts' }, {});
    ok('list_metrics 로 다시 읽힌다', lm.ok && lm.data.rows.some((r) => r.avg_dwell_sec === 18 && r.snapshot === 'LATEST'), lm.data && lm.data.rows);
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
  /* 2026-11-19 결함 수정: 인스타 CDN 썸네일 주소는 630~700자 — 480자 상한이면 통째로 버린다. */
  const longThumb = 'https://scontent-icn2-1.cdninstagram.com/v/t51.2885-15/' + 'x'.repeat(660) + '.jpg';
  r = callHandler(PD.ctx, 'handleUpsertMediaMeta_', MSS, { items: [metaItem('vidAAAAAAC2', { thumbnail_url: longThumb })] }, { brand: 'ALL' });
  ok('700자 썸네일 주소도 살린다', r.ok && MSS.getSheetByName('Media_Meta').rows.slice(-1)[0][5] === longThumb, { len: longThumb.length });
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
  /* 2026-11-19 결함 수정: D+1·7·14·30일째는 수집기가 LATEST 대신 D1/D7… 행을 쓴다.
     그날 목록·비교에서 영상이 사라지지 않도록 최근 수집일 행으로 폴백하는지 본다. */
  const row = (cp, day, views) => an({ brand: A_BRAND, content_id: 'DY-1', source: 'youtube', external_id: 'vidAAAAAAA1', channel: 'shorts', checkpoint: cp, collected_date: day, views: views });
  const onlyD7 = [row('D1', '2026-11-13', 30), row('D7', '2026-11-19', 90)];
  eq('LATEST 가 없는 D+7 당일: 가장 최근 수집일 행으로 폴백(90)', PD.ctx.postCurrentRow_(onlyD7).views, 90);
  eq('LATEST 가 있으면 그대로 LATEST 를 쓴다', PD.ctx.postCurrentRow_(onlyD7.concat([row('LATEST', '2026-11-18', 80)])).views, 80);
  ok('channel 요약 행은 현재값으로 쓰지 않는다', PD.ctx.postCurrentRow_([{ checkpoint: 'channel', collected_at: '2026-11-19T06:00:00+09:00', views: 999 }]) === null);
  /* 같은 함정을 상세 응답 전체로도 확인 — D7 당일 카드 비교에 쇼츠가 남아야 한다 */
  const D7 = new FakeSS();
  sheetOf(D7, 'Analytics_Daily', AN_COLS, [
    an({ brand: A_BRAND, content_id: 'DY-1', source: 'youtube', external_id: 'vidAAAAAAA1', channel: 'shorts', checkpoint: 'D1', collected_date: '2026-11-13', views: 30 }),
    an({ brand: A_BRAND, content_id: 'DY-1', source: 'youtube', external_id: 'vidAAAAAAA1', channel: 'shorts', checkpoint: 'D7', collected_date: '2026-11-19', views: 90 })
  ]);
  sheetOf(D7, 'Contents', CT_COLS, [{ content_id: 'DY-1', brand: A_BRAND, status: 'PUBLISHED', shorts_status: 'UPLOADED', shorts_url: 'https://youtu.be/vidAAAAAAA1', blog_status: 'SKIPPED', reels_status: 'SKIPPED', clip_status: 'SKIPPED', ig_feed_status: 'SKIPPED', daangn_status: 'SKIPPED' }]);
  const d7 = callHandler(PD.ctx, 'getPostDetail_', D7, 'youtube', 'vidAAAAAAA1', '', '');
  ok('D+7 당일에도 비교에 쇼츠가 남는다(사라지지 않음)', d7.ok && d7.data.compare.some((c) => c.channel === 'shorts' && c.metrics && c.metrics.views === 90), d7.data && d7.data.compare);
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

console.log('\n[U] 영상 올리기 (gas/Upload.gs) — 드라이브 조각 저장 · 목록 · 받아 가기');
{
  class DFile {
    constructor(name, bytes) { this.name = name; this.bytes = Array.from(bytes); this.trashed = false; this.id = 'df_' + Math.random().toString(36).slice(2); }
    getId() { return this.id; }
    getName() { return this.name; }
    getSize() { return this.bytes.length; }
    getBlob() { return { getBytes: () => this.bytes.slice(), getDataAsString: () => Buffer.from(this.bytes).toString('utf8') }; }
    getLastUpdated() { return this.updated || (this.updated = new Date()); }
    setTrashed(v) { this.trashed = !!v; return this; }
    isTrashed() { return this.trashed === true; }
  }
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  class DFolder {
    constructor(name) { this.name = name; this.id = 'dfolder_' + name + '_' + Math.random().toString(36).slice(2, 8); this.files = []; this.folders = []; this.shared = 'default'; }
    getId() { return this.id; }
    getName() { return this.name; }
    live() { return this.files.filter(f => !f.trashed); }
    getFiles() { return iter(this.live()); }
    getFilesByName(n) { return iter(this.live().filter(f => f.name === n)); }
    getFoldersByName(n) { return iter(this.folders.filter(f => f.name === n)); }
    createFolder(n) { const f = new DFolder(n); this.folders.push(f); return f; }
    createFile(a, content) { const f = typeof a === 'string' ? new DFile(a, Buffer.from(String(content), 'utf8')) : new DFile(a.name, a.bytes); this.files.push(f); return f; }
    setSharing(a, p) { this.shared = a + '/' + p; return this; }
  }
  const U = loadGas();
  const root = new DFolder('내 드라이브');
  const all = new Map();
  const reg = (f) => { all.set(f.id, f); f.folders.forEach(reg); };
  U.ctx.DriveApp = {
    getRootFolder: () => root,
    getFolderById: (id) => { reg(root); if (!all.has(id)) throw new Error('폴더 없음: ' + id); return all.get(id); },
    Access: { PRIVATE: 'PRIVATE' }, Permission: { NONE: 'NONE' }
  };
  const origBlob = U.ctx.Utilities.newBlob;
  U.ctx.Utilities.newBlob = (x, mime, name) => (typeof x === 'string' ? origBlob(x) : { bytes: Array.from(x), name, getBytes: () => Array.from(x) });
  U.ctx.Utilities.base64Decode = (s) => Array.from(Buffer.from(String(s), 'base64'));
  U.ctx.Utilities.base64Encode = (b) => Buffer.from(b).toString('base64');

  const chunk = (p) => callHandler(U.ctx, 'handleUploadVideoChunk_', null, p);
  const list = (cid) => callHandler(U.ctx, 'handleUploadVideoList_', null, { content_id: cid });
  const fetchPart = (p) => callHandler(U.ctx, 'handleUploadVideoFetch_', null, p);
  const b64 = (buf) => Buffer.from(buf).toString('base64');
  const orig = Buffer.from(Array.from({ length: 4500 }, (_, i) => (i * 7) % 256));
  const slices = [orig.subarray(0, 2000), orig.subarray(2000, 4000), orig.subarray(4000)];

  const wl = ev(U.ctx, 'ACTION_WHITELIST');
  ok('4개 액션이 화이트리스트·핸들러에 있다', ['upload_video_chunk', 'upload_video_list', 'upload_video_fetch', 'upload_video_delete'].every(a => wl[a] && wl[a].m1 === true && typeof ev(U.ctx, 'M1_HANDLERS')[a] === 'function'));
  ok('조각 저장은 쓰기(감사 행은 남기지 않음)·목록/받기는 읽기', wl.upload_video_chunk.mode === 'WRITE' && wl.upload_video_chunk.noAudit === true && wl.upload_video_list.mode === 'READ' && wl.upload_video_fetch.mode === 'READ');
  ok('모두 라우터 락을 잡지 않는다(드라이브 외부 호출)', ['upload_video_chunk', 'upload_video_list', 'upload_video_fetch', 'upload_video_delete'].every(a => wl[a].longRunning === true));
  ok('doPost 가 noAudit 액션은 감사 행을 건너뛴다', /auth\.spec\.mode === 'WRITE' && !auth\.spec\.noAudit/.test(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8')));

  eq('아무것도 안 올렸으면 빈 목록(폴더도 만들지 않는다)', JSON.stringify(list('C-001').data), JSON.stringify({ content_id: 'C-001', items: [] }));
  ok('빈 목록 조회는 드라이브 폴더를 만들지 않는다', root.folders.length === 0);

  slices.forEach((s, i) => {
    const r1 = chunk({ content_id: 'C-001', name: '외관 01.mp4', index: i, parts: 3, total_size: 4500, data: b64(s) });
    ok('조각 ' + i + ' 저장', r1.ok && r1.data.bytes === s.length && r1.data.index === i, r1);
  });
  const L1 = list('C-001');
  ok('목록: 이름·크기·조각 수·완료', L1.ok && L1.data.items.length === 1 && L1.data.items[0].name === '외관 01.mp4' && L1.data.items[0].size === 4500 && L1.data.items[0].parts === 3 && L1.data.items[0].parts_found === 3 && L1.data.items[0].complete === true, L1);
  const up = root.folders[0];
  ok('폴더 구조: ContentHubOS_Uploads / C-001', up.name === 'ContentHubOS_Uploads' && up.folders[0].name === 'C-001');
  ok('폴더는 비공개로 만든다', up.shared === 'PRIVATE/NONE' && up.folders[0].shared === 'PRIVATE/NONE', [up.shared, up.folders[0].shared]);
  ok('조각 파일 이름 규칙(.part00001of00003)', up.folders[0].live().map(f => f.name).sort().join(',') === '외관 01.mp4.part00000of00003,외관 01.mp4.part00001of00003,외관 01.mp4.part00002of00003', up.folders[0].live().map(f => f.name));
  ok('루트 폴더 ID 를 스크립트 속성에 기억한다', U.env.props.get('UPLOAD_ROOT_FOLDER_ID') === up.id);

  const got = [0, 1, 2].map(i => fetchPart({ content_id: 'C-001', name: '외관 01.mp4', index: i, parts: 3 }));
  ok('조각 받기: 이어 붙이면 원본과 같다', got.every(g => g.ok) && Buffer.compare(Buffer.concat(got.map(g => Buffer.from(g.data.data, 'base64'))), orig) === 0, got.map(g => g.code));
  eq('없는 조각은 ERR_NOT_FOUND', fetchPart({ content_id: 'C-001', name: '외관 01.mp4', index: 1, parts: 4 }).code, 'ERR_NOT_FOUND');
  eq('올린 적 없는 content_id 는 ERR_NOT_FOUND', fetchPart({ content_id: 'C-NONE', name: 'a.mp4', index: 0, parts: 1 }).code, 'ERR_NOT_FOUND');

  const retry = chunk({ content_id: 'C-001', name: '외관 01.mp4', index: 1, parts: 3, data: b64(slices[1]) });
  ok('같은 조각을 다시 보내도 중복되지 않는다', retry.ok && list('C-001').data.items[0].size === 4500 && up.folders[0].live().length === 3);

  // 안 끝난 업로드
  chunk({ content_id: 'C-002', name: 'b.mov', index: 0, parts: 3, data: b64(slices[0]) });
  chunk({ content_id: 'C-002', name: 'b.mov', index: 2, parts: 3, data: b64(slices[2]) });
  const L2 = list('C-002').data.items[0];
  ok('조각이 빠지면 complete=false 와 찾은 개수를 알린다', L2.complete === false && L2.parts_found === 2 && L2.parts === 3, L2);

  // 0번은 새 업로드: 조각 수가 달랐던 옛 조각을 치운다
  chunk({ content_id: 'C-002', name: 'b.mov', index: 0, parts: 1, data: b64(slices[2]) });
  const L3 = list('C-002').data.items[0];
  ok('0번을 다시 올리면 옛 조각을 모두 지운다', L3.parts === 1 && L3.complete === true && L3.size === slices[2].length && !L3.mixed, L3);

  // 다른 파일이 섞여 있어도 건드리지 않는다
  const c1 = up.folders[0];
  c1.createFile({ name: 'memo.txt', bytes: [1, 2, 3] });
  chunk({ content_id: 'C-001', name: '외관 01.mp4', index: 0, parts: 3, data: b64(slices[0]) });
  ok('이름 규칙에 안 맞는 파일은 건드리지 않고 목록에도 안 나온다', c1.live().some(f => f.name === 'memo.txt') && list('C-001').data.items.length === 1);

  // 검증
  const goodP = { content_id: 'C-003', name: 'z.mp4', index: 0, parts: 1, data: b64(Buffer.from('abc')) };
  const code = (p) => chunk(Object.assign({}, goodP, p)).code;
  eq('content_id 에 경로 금지', code({ content_id: '../x' }), 'ERR_VALIDATION_FAILED');
  eq('확장자 mp4·mov·m4v·jpg·png·webp 만', code({ name: 'z.exe' }), 'ERR_VALIDATION_FAILED');
  eq('사진 확장자 gif 는 아직 거부', code({ name: 'z.gif' }), 'ERR_VALIDATION_FAILED');
  ok('사진(jpg·jpeg·png·webp) 업로드 허용', ['사진01_외관.jpg', 'a.jpeg', 'b.PNG', 'c.webp'].every(n => chunk(Object.assign({}, goodP, { name: n, content_id: 'C-IMG', data: b64(Buffer.from('img')) })).ok));
  eq('사진 목록에 kind=photo 로 나온다', list('C-IMG').data.items[0].kind, 'photo');
  eq('영상 목록은 kind=video', list('C-001').data.items[0].kind, 'video');
  eq('사진은 장당 10MB 까지(넘으면 거부)', code({ name: 'big.jpg', total_size: 10 * 1024 * 1024 + 1 }), 'ERR_VALIDATION_FAILED');
  ok('사진 10MB 는 통과(영상 1.5GB 와 별도 상한)', chunk(Object.assign({}, goodP, { name: 'ok.jpg', content_id: 'C-IMG2', total_size: 10 * 1024 * 1024, data: b64(Buffer.from('x')) })).ok);
  ok('카드 한 장에 사진 25장까지', (function () {
    for (let i = 0; i < 25; i++) chunk({ content_id: 'C-IMG3', name: 'p' + pad(i) + '.jpg', index: 0, parts: 1, data: b64(Buffer.from('x')) });
    const r = chunk({ content_id: 'C-IMG3', name: 'p25.jpg', index: 0, parts: 1, data: b64(Buffer.from('x')) });
    return r.code === 'ERR_VALIDATION_FAILED' && /25/.test(r.message || '');
  })());
  ok('사진을 다시 보내면(같은 이름) 상한에 걸리지 않는다', chunk({ content_id: 'C-IMG3', name: 'p00.jpg', index: 0, parts: 1, data: b64(Buffer.from('y')) }).ok);
  eq('경로·.. 금지', code({ name: '../z.mp4' }), 'ERR_VALIDATION_FAILED');
  eq('점으로 시작 금지', code({ name: '.z.mp4' }), 'ERR_VALIDATION_FAILED');
  eq('index 는 parts 안', code({ index: 1 }), 'ERR_VALIDATION_FAILED');
  eq('index 는 정수', code({ index: 0.5 }), 'ERR_VALIDATION_FAILED');
  eq('parts 상한 800', code({ parts: 801 }), 'ERR_VALIDATION_FAILED');
  eq('base64 아닌 data 거부', code({ data: '<script>' }), 'ERR_VALIDATION_FAILED');
  eq('빈 data 거부', code({ data: '' }), 'ERR_VALIDATION_FAILED');
  eq('조각 2MB 초과 거부', code({ data: b64(Buffer.alloc(2 * 1024 * 1024 + 1, 1)) }), 'ERR_VALIDATION_FAILED');
  ok('조각 정확히 2MB 는 통과', chunk(Object.assign({}, goodP, { data: b64(Buffer.alloc(2 * 1024 * 1024, 1)) })).ok);
  eq('total_size 1.5GB 초과 거부', code({ total_size: 1500 * 1024 * 1024 + 1 }), 'ERR_VALIDATION_FAILED');
  eq('list: 이상한 content_id 거부', list('a b').code, 'ERR_VALIDATION_FAILED');
  eq('fetch: parts 누락 거부', fetchPart({ content_id: 'C-001', name: '외관 01.mp4', index: 0 }).code, 'ERR_VALIDATION_FAILED');

  // 삭제
  chunk({ content_id: 'C-001', name: '외관 01.mp4', index: 1, parts: 3, data: b64(slices[1]) });
  chunk({ content_id: 'C-001', name: '외관 01.mp4', index: 2, parts: 3, data: b64(slices[2]) });
  const del = callHandler(U.ctx, 'handleUploadVideoDelete_', null, { content_id: 'C-001', name: '외관 01.mp4' });
  ok('삭제: 조각을 모두 휴지통으로', del.ok && del.data.removed === 3 && list('C-001').data.items.length === 0 && c1.live().some(f => f.name === 'memo.txt'), del);
  eq('삭제: 올린 적 없으면 0개', callHandler(U.ctx, 'handleUploadVideoDelete_', null, { content_id: 'C-NONE', name: 'a.mp4' }).data.removed, 0);

  // 요청 크기 한도: 조각 업로드만 3.4MB, 나머지는 그대로 512KB
  const big = (action, n) => '{"action":"' + action + '","payload":{"data":"' + 'A'.repeat(n) + '"}}';
  const sizeCode = (raw) => callHandler(U.ctx, 'assertRequestSizeWithinLimit_', raw).code;
  ok('일반 액션 600KB 는 거부(512KB 유지)', sizeCode(big('update_content', 600 * 1024)) === 'ERR_PAYLOAD_TOO_LARGE');
  ok('조각 업로드 2.8MB 는 통과', sizeCode(big('upload_video_chunk', 2800000)) === undefined);
  ok('조각 업로드도 3.4MB 초과는 거부', sizeCode(big('upload_video_chunk', 3600000)) === 'ERR_PAYLOAD_TOO_LARGE');
  ok('action 을 뒤에 숨겨도 큰 본문은 거부', sizeCode('{"payload":{"data":"' + 'A'.repeat(2800000) + '"},"action":"upload_video_chunk"}') === 'ERR_PAYLOAD_TOO_LARGE');

  // 인증
  U.env.props.set('API_SECRET_TOKEN', 'test-secret-token-0123456789abcdef');
  const authOf = (action, token) => callHandler(U.ctx, 'authenticateRequest_', null, { action, auth_token: token, client_id: 'up-test' }, { allowAllBrand: true });
  ['upload_video_chunk', 'upload_video_list', 'upload_video_fetch', 'upload_video_delete'].forEach((a) => {
    eq(a + ': 토큰이 없으면 거부', authOf(a, '').code, 'ERR_UNAUTHORIZED');
    ok(a + ': 맞는 토큰이면 통과', authOf(a, 'test-secret-token-0123456789abcdef').ok);
  });
  /* ── 자산(자막·결과 보고) ── */
  const put = (p) => callHandler(U.ctx, 'handleAssetPut_', null, p);
  const get = (p) => callHandler(U.ctx, 'handleAssetGet_', null, p);
  ok('asset_put·asset_get 가 화이트리스트·핸들러에 있다(put 은 쓰기·감사 행 없음, get 은 읽기)', wl.asset_put.mode === 'WRITE' && wl.asset_put.noAudit === true && wl.asset_put.longRunning === true && wl.asset_get.mode === 'READ' && typeof ev(U.ctx, 'M1_HANDLERS').asset_put === 'function' && typeof ev(U.ctx, 'M1_HANDLERS').asset_get === 'function');
  eq('아직 없는 자산은 exists=false(폴더도 만들지 않는다)', JSON.stringify(get({ content_id: 'C-ASSET', kind: 'srt_final' }).data), JSON.stringify({ content_id: 'C-ASSET', kind: 'srt_final', exists: false }));
  const srtText = '1\n00:00:01,000 --> 00:00:02,500\n안녕하세요\n';
  const pr = put({ content_id: 'C-ASSET', kind: 'srt_draft', text: srtText });
  ok('자막 초안 저장', pr.ok && pr.data.kind === 'srt_draft' && pr.data.bytes === Buffer.byteLength(srtText), pr);
  const gr = get({ content_id: 'C-ASSET', kind: 'srt_draft' });
  ok('읽으면 글자 그대로(한글 포함)·수정 시각이 있다', gr.ok && gr.data.exists === true && gr.data.text === srtText && /^2026-|^20\d\d-/.test(gr.data.updated_at), gr);
  put({ content_id: 'C-ASSET', kind: 'srt_draft', text: '두 번째 내용' });
  const assetFolder = root.folders[0].folders.find((f) => f.name === 'C-ASSET');
  ok('같은 종류를 다시 저장하면 덮어쓴다(파일이 하나)', get({ content_id: 'C-ASSET', kind: 'srt_draft' }).data.text === '두 번째 내용' && assetFolder.live().filter((f) => f.name === 'srt_draft.txt').length === 1);
  put({ content_id: 'C-ASSET', kind: 'srt_final', text: '확정본' });
  put({ content_id: 'C-ASSET', kind: 'report_finish', text: '{"a":1}' });
  ok('종류마다 따로 저장된다', get({ content_id: 'C-ASSET', kind: 'srt_final' }).data.text === '확정본' && get({ content_id: 'C-ASSET', kind: 'report_finish' }).data.text === '{"a":1}' && get({ content_id: 'C-ASSET', kind: 'srt_draft' }).data.text === '두 번째 내용');
  ok('빈 글도 저장할 수 있다(말소리 없음 → 빈 초안)', put({ content_id: 'C-ASSET', kind: 'srt_draft', text: '' }).ok && get({ content_id: 'C-ASSET', kind: 'srt_draft' }).data.text === '');
  eq('허용 밖 kind 거부', put({ content_id: 'C-ASSET', kind: 'evil', text: 'x' }).code, 'ERR_VALIDATION_FAILED');
  eq('경로 같은 kind 거부', put({ content_id: 'C-ASSET', kind: '../x', text: 'x' }).code, 'ERR_VALIDATION_FAILED');
  eq('이상한 content_id 거부', put({ content_id: '../x', kind: 'srt_draft', text: 'x' }).code, 'ERR_VALIDATION_FAILED');
  eq('200KB 넘으면 거부', put({ content_id: 'C-ASSET', kind: 'srt_draft', text: 'a'.repeat(200001) }).code, 'ERR_PAYLOAD_TOO_LARGE');
  ok('200KB 이하는 통과', put({ content_id: 'C-ASSET', kind: 'srt_draft', text: 'a'.repeat(200000) }).ok);
  ok('자산 파일은 영상 조각 목록에 섞이지 않는다', list('C-ASSET').data.items.length === 0);
  {
    // 실제 드라이브는 폴더 목록에 휴지통 파일을 섞어 줄 수 있다 → 휴지통에 넣은 옛 글이 더 최근 시각이어도 읽지 않는다
    put({ content_id: 'C-ASSET', kind: 'srt_final', text: '새 확정본' });
    const oldF = assetFolder.files.find((f) => f.name === 'srt_final.txt' && f.trashed);
    oldF.updated = new Date(Date.now() + 3600000);
    const liveOrig = assetFolder.live;
    assetFolder.live = function () { return this.files.slice(); };   // 휴지통 포함 목록
    ok('휴지통에 넣은 옛 자산은 읽지 않는다(시각이 더 늦어도)', get({ content_id: 'C-ASSET', kind: 'srt_final' }).data.text === '새 확정본');
    assetFolder.live = liveOrig;
  }
  ['asset_put', 'asset_get'].forEach((a) => {
    eq(a + ': 토큰이 없으면 거부', authOf(a, '').code, 'ERR_UNAUTHORIZED');
    ok(a + ': 맞는 토큰이면 통과', authOf(a, 'test-secret-token-0123456789abcdef').ok);
  });

  /* ── [V] 무료 BGM (gas/Bgm.gs) — 찾기·보관·노트북 전달 ── */
  console.log('\n[V] 무료 BGM 찾기·보관 (gas/Bgm.gs)');
  {
    const BG = ['bgm_search', 'bgm_pick', 'bgm_list', 'bgm_fetch', 'bgm_delete'];
    const HMv = ev(U.ctx, 'M1_HANDLERS');
    ok('BGM 액션 5개가 화이트리스트·핸들러에 있다', BG.every(a => wl[a] && wl[a].m1 === true && typeof HMv[a] === 'function'));
    ok('보관·삭제는 쓰기, 찾기·목록·받기는 읽기 · 모두 라우터 락 없음', wl.bgm_pick.mode === 'WRITE' && wl.bgm_delete.mode === 'WRITE' && wl.bgm_search.mode === 'READ' && wl.bgm_list.mode === 'READ' && wl.bgm_fetch.mode === 'READ' && BG.every(a => wl[a].longRunning === true));
    BG.forEach((a) => {
      eq(a + ': 토큰이 없으면 거부', authOf(a, '').code, 'ERR_UNAUTHORIZED');
      ok(a + ': 맞는 토큰이면 통과', authOf(a, 'test-secret-token-0123456789abcdef').ok);
    });

    const uid = (n) => '0a1b2c3d-0000-4000-8000-' + String(n).padStart(12, '0');
    const R = (n, over) => Object.assign({ id: uid(n), title: 'Calm Piano ' + n, creator: 'Some Artist', license: 'by', license_version: '3.0', license_url: 'https://creativecommons.org/licenses/by/3.0/', provider: 'jamendo', source: 'jamendo', url: 'https://prod-1.storage.jamendo.com/?trackid=' + (1000 + n) + '&format=mp32', foreign_landing_url: 'https://www.jamendo.com/track/' + (1000 + n), duration: 120000, genres: ['ambient'] }, over || {});
    const audio = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4600000, 7)]);   // 약 4.4MB → 조각 3개
    const calls = [];
    let apiReply = { code: 200, json: { result_count: 0, results: [] } };
    let audioReply = { code: 200, bytes: audio };
    U.ctx.UrlFetchApp = {
      fetch: (url, opts) => {
        calls.push(url);
        if (/^https:\/\/api\.openverse\.org\//.test(url)) {
          const rep = typeof apiReply === 'function' ? apiReply(url) : apiReply;
          return { getResponseCode: () => rep.code, getContentText: () => JSON.stringify(rep.json || {}) };
        }
        if (/\.storage\.jamendo\.com\//.test(url)) return { getResponseCode: () => audioReply.code, getBlob: () => ({ getBytes: () => Array.from(audioReply.bytes) }) };
        throw new Error('허용 밖 주소: ' + url);
      }
    };
    const search = (p) => callHandler(U.ctx, 'handleBgmSearch_', null, p);
    const pick = (p) => callHandler(U.ctx, 'handleBgmPick_', null, p);
    const blist = () => callHandler(U.ctx, 'handleBgmList_', null, {});
    const bfetch = (p) => callHandler(U.ctx, 'handleBgmFetch_', null, p);
    const bdel = (p) => callHandler(U.ctx, 'handleBgmDelete_', null, p);

    eq('찾을 말이 없으면 거부', search({ q: '   ' }).code, 'ERR_VALIDATION_FAILED');
    apiReply = { code: 200, json: { result_count: 77, results: [
      R(1), R(2, { license: 'cc0', license_version: '1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/' }),
      R(3, { license: 'by-sa' }), R(4, { license: 'by-nc' }), R(5, { license: 'by-nd' }),
      R(6, { provider: 'freesound', source: 'freesound' }), R(7, { duration: 10000 }), R(8, { duration: 900000 }),
      R(9, { url: 'https://evil.example.com/a.mp3' }), R(10, { url: 'https://prod-1.storage.jamendo.com.evil.com/?trackid=1&format=mp32' }),
      R(11, { id: 'not-a-uuid' }), R(12, { title: '  제목\n에   줄바꿈  ', creator: 'x'.repeat(200) })
    ] } };
    const s1 = search({ q: 'Calm Piano' });
    ok('찾기: CC0·퍼블릭 도메인·CC BY 만 남기고 SA·NC·ND·타 출처·길이 밖·이상한 주소·id 는 뺀다', s1.ok && s1.data.items.map(i => i.id).join() === [uid(1), uid(2), uid(12)].join(), s1.data && s1.data.items.map(i => i.id));
    const it1 = s1.data.items[0], it2 = s1.data.items[1];
    ok('찾기: 출처 문구(곡명·만든이·라이선스·링크)와 표기 필요 여부', /Music: "Calm Piano 1" by Some Artist/.test(it1.credit) && /CC BY 3\.0/.test(it1.credit) && /creativecommons\.org\/licenses\/by\/3\.0/.test(it1.credit) && /jamendo\.com\/track\/1001/.test(it1.credit) && it1.credit_required === true && it2.credit_required === false && it2.license_label === 'CC0 1.0', [it1, it2]);
    ok('찾기: 서버 내부용 audio_url 은 화면으로 보내지 않는다 · 길이는 초', !('audio_url' in it1) && it1.duration_sec === 120 && it1.preview_url.indexOf('https://prod-1.storage.jamendo.com/') === 0);
    ok('찾기: 제목·만든이의 줄바꿈·길이를 정리한다', s1.data.items[2].title === '제목 에 줄바꿈' && s1.data.items[2].creator.length === 60, s1.data.items[2]);
    ok('찾기: Openverse 에 jamendo·허용 라이선스로만 묻고 검색어를 인코딩한다', /source=jamendo/.test(calls[0]) && /license=by,cc0,pdm/.test(calls[0]) && /q=Calm%20Piano/.test(calls[0]), calls[0]);
    const nCalls = calls.length;
    search({ q: 'Calm Piano' });
    ok('같은 검색(같은 말·쪽)은 캐시에서 준다(바깥 호출 없음)', calls.length === nCalls);
    apiReply = { code: 429, json: {} };
    eq('검색이 너무 잦아 막히면(429) 안내와 함께 ERR_BGM_UNREACHABLE', search({ q: 'other words' }).code, 'ERR_BGM_UNREACHABLE');

    // 보관
    eq('곡 id 형식이 이상하면 거부', pick({ id: '../x' }).code, 'ERR_VALIDATION_FAILED');
    const before = calls.length;
    apiReply = () => ({ code: 200, json: R(3, { license: 'by-sa' }) });
    eq('쓸 수 없는 라이선스(by-sa)는 내려받지 않고 거부', pick({ id: uid(3) }).code, 'ERR_VALIDATION_FAILED');
    ok('거부된 곡은 음원 주소를 부르지 않는다', !calls.slice(before).some(u => /storage\.jamendo/.test(u)));
    apiReply = () => ({ code: 404, json: {} });
    eq('없는 곡은 ERR_NOT_FOUND', pick({ id: uid(404) }).code, 'ERR_NOT_FOUND');

    apiReply = () => ({ code: 200, json: R(1) });
    const p1 = pick({ id: uid(1) });
    ok('보관: 이름은 영문 slug + id 앞 8자 .mp3, 크기·출처 문구가 돌아온다', p1.ok && p1.data.name === 'calm-piano-1-0a1b2c3d.mp3' && p1.data.bytes === audio.length && p1.data.already === false && /Music: "Calm Piano 1"/.test(p1.data.credit), p1);
    const bgmDir = up.folders.find(f => f.name === '_bgm');
    ok('보관: ContentHubOS_Uploads/_bgm 비공개 폴더에 mp3 와 출처 json 이 생긴다', !!bgmDir && bgmDir.shared === 'PRIVATE/NONE' && bgmDir.live().map(f => f.name).sort().join() === 'calm-piano-1-0a1b2c3d.credit.json,calm-piano-1-0a1b2c3d.mp3', bgmDir && bgmDir.live().map(f => f.name));
    const metaJson = JSON.parse(bgmDir.live().find(f => /credit\.json$/.test(f.name)).getBlob().getDataAsString());
    ok('출처 json: 곡명·만든이·라이선스·표기 필요·출처 문구·길이·보관 시각', metaJson.title === 'Calm Piano 1' && metaJson.creator === 'Some Artist' && metaJson.license === 'by' && metaJson.credit_required === true && /Music:/.test(metaJson.credit) && metaJson.duration_sec === 120 && !!metaJson.saved_at, metaJson);
    const dl = calls.length;
    const p1b = pick({ id: uid(1) });
    ok('이미 보관한 곡은 다시 내려받지 않는다', p1b.ok && p1b.data.already === true && calls.slice(dl).every(u => !/storage\.jamendo/.test(u)), p1b);

    audioReply = { code: 200, bytes: Buffer.from('<html>not audio</html>'.repeat(10000)) };
    apiReply = () => ({ code: 200, json: R(20) });
    eq('mp3 가 아니면(머리글이 다르면) 거부', pick({ id: uid(20) }).code, 'ERR_VALIDATION_FAILED');
    audioReply = { code: 200, bytes: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]) };
    eq('너무 작은 파일은 거부', pick({ id: uid(20) }).code, 'ERR_VALIDATION_FAILED');
    audioReply = { code: 503, bytes: Buffer.alloc(0) };
    eq('내려받기가 실패하면 ERR_BGM_UNREACHABLE', pick({ id: uid(20) }).code, 'ERR_BGM_UNREACHABLE');
    ok('실패한 곡은 폴더에 남지 않는다', bgmDir.live().every(f => /calm-piano-1/.test(f.name)));
    audioReply = { code: 200, bytes: audio };

    // 목록 · 받기
    const l1 = blist();
    ok('목록: 이름·크기·조각 수·곡명·출처 문구', l1.ok && l1.data.items.length === 1 && l1.data.items[0].name === 'calm-piano-1-0a1b2c3d.mp3' && l1.data.items[0].bytes === audio.length && l1.data.items[0].parts === 3 && l1.data.items[0].title === 'Calm Piano 1' && l1.data.items[0].credit_required === true && /Music:/.test(l1.data.items[0].credit), l1.data);
    const f0 = [0, 1, 2].map(i => bfetch({ name: 'calm-piano-1-0a1b2c3d.mp3', index: i }));
    ok('받기: 조각을 이어 붙이면 원본과 같다(조각 3개)', f0.every(g => g.ok && g.data.parts === 3 && g.data.size === audio.length) && Buffer.compare(Buffer.concat(f0.map(g => Buffer.from(g.data.data, 'base64'))), audio) === 0, f0.map(g => g.code));
    ok('받기: 0번 조각에만 출처 문구를 싣는다', /Music:/.test(f0[0].data.credit) && f0[1].data.credit === undefined);
    eq('받기: 없는 곡은 ERR_NOT_FOUND', bfetch({ name: 'nope.mp3', index: 0 }).code, 'ERR_NOT_FOUND');
    eq('받기: 조각 번호가 범위를 벗어나면 거부', bfetch({ name: 'calm-piano-1-0a1b2c3d.mp3', index: 9 }).code, 'ERR_VALIDATION_FAILED');
    ok('받기: 경로·이상한 이름은 거부', ['../x.mp3', 'a/b.mp3', 'x.exe', '.hid.mp3', ''].every(n => bfetch({ name: n, index: 0 }).code === 'ERR_VALIDATION_FAILED'));

    // 삭제
    const d1 = bdel({ name: 'calm-piano-1-0a1b2c3d.mp3' });
    ok('삭제: mp3 와 출처 json 을 함께 휴지통으로', d1.ok && d1.data.removed === 2 && bgmDir.live().length === 0 && blist().data.items.length === 0, d1);
    eq('삭제: 이름 검사', bdel({ name: '../x.mp3' }).code, 'ERR_VALIDATION_FAILED');
  }

  /* ── [V2] 내 음원 올리기 (gas/Bgm.gs bgm_put) — 뮤직비디오 모드 ── */
  console.log('\n[V2] 내 음원 올리기 (bgm_put)');
  {
    const HMp = ev(U.ctx, 'M1_HANDLERS');
    const authOf = (action, token) => callHandler(U.ctx, 'authenticateRequest_', null, { action, auth_token: token, client_id: 'bgmput-test' }, { allowAllBrand: true });
    const bigW = (action, n) => '{"action":"' + action + '","payload":{"data":"' + 'A'.repeat(n) + '"}}';
    const sizeW = (raw) => callHandler(U.ctx, 'assertRequestSizeWithinLimit_', raw).code;
    ok('bgm_put 이 화이트리스트·핸들러에 있다', !!wl.bgm_put && wl.bgm_put.m1 === true && wl.bgm_put.mode === 'WRITE' && wl.bgm_put.noAudit === true && wl.bgm_put.longRunning === true && typeof HMp.bgm_put === 'function');
    eq('bgm_put: 토큰이 없으면 거부', authOf('bgm_put', '').code, 'ERR_UNAUTHORIZED');
    ok('bgm_put: 2.8MB 조각은 통과 · 3.6MB 는 거부(3.4MB 한도)', sizeW(bigW('bgm_put', 2800000)) === undefined && sizeW(bigW('bgm_put', 3600000)) === 'ERR_PAYLOAD_TOO_LARGE');

    const put = (p) => callHandler(U.ctx, 'handleBgmPut_', null, p);
    const blist2 = () => callHandler(U.ctx, 'handleBgmList_', null, {});
    const bfetch2 = (p) => callHandler(U.ctx, 'handleBgmFetch_', null, p);
    const bdel2 = (p) => callHandler(U.ctx, 'handleBgmDelete_', null, p);
    const b64x = (buf) => Buffer.from(buf).toString('base64');
    // mp3 머리글(ID3) + 데이터 3조각
    const song = Buffer.concat([Buffer.from('ID3'), Buffer.from(Array.from({ length: 4400000 }, (_, i) => (i * 11) % 256))]);
    const sParts = [song.subarray(0, 1500000), song.subarray(1500000, 3000000), song.subarray(3000000)];
    const up1 = put({ name: '내 노래.mp3', index: 0, parts: 3, total_size: song.length, data: b64x(sParts[0]), title: '내 노래' });
    ok('1조각: 아직 다 안 왔다(done:false)', up1.ok && up1.data.done === false && up1.data.received === 1, up1);
    const up2 = put({ name: '내 노래.mp3', index: 1, parts: 3, total_size: song.length, data: b64x(sParts[1]) });
    ok('2조각: 받은 수가 늘어난다(조각 파일은 목록에 안 보인다)', up2.ok && up2.data.received === 2 && blist2().data.items.length === 0, up2);
    const up3 = put({ name: '내 노래.mp3', index: 2, parts: 3, total_size: song.length, data: b64x(sParts[2]) });
    ok('3조각: 다 모이면 하나로 붙여 저장(done:true · 크기 일치)', up3.ok && up3.data.done === true && up3.data.bytes === song.length && up3.data.received === 3, up3);
    const folder2 = ev(U.ctx, "uploadFolder_('_bgm', false)");
    ok('조각 파일은 남지 않고 곡과 메타만 남는다', folder2.live().map(f => f.name).sort().join() === '내 노래.credit.json,내 노래.mp3', folder2.live().map(f => f.name));
    const li2 = blist2();
    ok('목록: 내 파일은 source:user · 출처 표기 없음 · 제목', li2.ok && li2.data.items.length === 1 && li2.data.items[0].source === 'user' && li2.data.items[0].credit_required === false && li2.data.items[0].title === '내 노래', li2.data && li2.data.items);
    const gf = [0, 1, 2].map(i => bfetch2({ name: '내 노래.mp3', index: i }));
    ok('받기: 노트북이 조각을 이어 붙이면 원본과 같다', gf.every(g => g.ok) && Buffer.compare(Buffer.concat(gf.map(g => Buffer.from(g.data.data, 'base64'))), song) === 0);

    // 같은 이름을 다시 올리면 덮어쓴다
    const song2 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(120100, 3)]);
    const r0 = put({ name: '내 노래.mp3', index: 0, parts: 1, total_size: song2.length, data: b64x(song2) });
    ok('다시 올리면 덮어쓴다(파일 하나·새 크기)', r0.ok && r0.data.done === true && folder2.live().filter(f => f.name === '내 노래.mp3').length === 1 && blist2().data.items[0].bytes === song2.length, r0);

    // 거부들
    const n2 = folder2.live().length;
    eq('음원이 아닌 확장자 거부', put({ name: 'a.exe', index: 0, parts: 1, total_size: 200000, data: b64x(song2) }).code, 'ERR_VALIDATION_FAILED');
    eq('경로가 든 이름 거부', put({ name: '../a.mp3', index: 0, parts: 1, total_size: 200000, data: b64x(song2) }).code, 'ERR_VALIDATION_FAILED');
    const sizeBefore = blist2().data.items.find(x => x.name === '내 노래.mp3').bytes;
    eq('알려 준 크기와 다르면 거부(조각은 치운다)', put({ name: '내 노래.mp3', index: 0, parts: 1, total_size: 999999, data: b64x(song2) }).code, 'ERR_VALIDATION_FAILED');
    ok('크기 불일치 뒤 조각이 남지 않는다', folder2.live().filter(f => f.name.indexOf('내 노래.mp3.p') === 0).length === 0);
    ok('실패한 재올리기는 멀쩡한 옛 곡을 지우지 않는다', blist2().data.items.some(x => x.name === '내 노래.mp3' && x.bytes === sizeBefore));
    eq('mp3 머리글이 아니면 거부', put({ name: '가짜.mp3', index: 0, parts: 1, total_size: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(120000)]).length, data: b64x(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(120000)])) }).code, 'ERR_VALIDATION_FAILED');
    eq('조각 번호 범위 밖 거부', put({ name: '내 노래.mp3', index: 5, parts: 1, total_size: 200000, data: b64x(song2) }).code, 'ERR_VALIDATION_FAILED');
    eq('빈 조각 거부', put({ name: '내 노래.mp3', index: 0, parts: 1, total_size: 200000, data: '' }).code, 'ERR_VALIDATION_FAILED');
    eq('너무 작은 곡 거부', put({ name: '작음.mp3', index: 0, parts: 1, total_size: 1000, data: b64x(song2) }).code, 'ERR_VALIDATION_FAILED');
    ok('거부된 올리기는 폴더를 늘리지 않는다', folder2.live().length === n2);

    // m4a 머리글
    const m4a = Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypM4A '), Buffer.alloc(120000, 1)]);
    const rm4 = put({ name: 'voice memo.m4a', index: 0, parts: 1, total_size: m4a.length, data: b64x(m4a) });
    ok('m4a 도 받는다(ftyp 머리글)', rm4.ok && rm4.data.done === true, rm4);

    const dd = bdel2({ name: '내 노래.mp3' });
    ok('삭제: 곡과 메타를 함께 휴지통으로', dd.ok && dd.data.removed === 2 && !blist2().data.items.some(x => x.name === '내 노래.mp3'), dd);
    const dd2 = bdel2({ name: 'voice memo.m4a' });
    ok('삭제: 한글·공백 이름도 된다', dd2.ok && dd2.data.removed === 2 && blist2().data.items.length === 0, dd2);
  }

  /* ── [W] 결과 파일 보관·받기 (gas/Result.gs) ── */
  console.log('\n[W] 결과 파일 보관 (gas/Result.gs)');
  {
    const RA = ['result_put', 'result_list', 'result_fetch', 'result_delete'];
    const HMw = ev(U.ctx, 'M1_HANDLERS');
    ok('결과 액션 4개가 화이트리스트·핸들러에 있다', RA.every(a => wl[a] && wl[a].m1 === true && typeof HMw[a] === 'function'));
    ok('put·delete 는 쓰기(put 은 감사 행 없음), list·fetch 는 읽기 · 모두 라우터 락 없음', wl.result_put.mode === 'WRITE' && wl.result_put.noAudit === true && wl.result_delete.mode === 'WRITE' && wl.result_list.mode === 'READ' && wl.result_fetch.mode === 'READ' && RA.every(a => wl[a].longRunning === true));
    RA.forEach((a) => {
      eq(a + ': 토큰이 없으면 거부', authOf(a, '').code, 'ERR_UNAUTHORIZED');
      ok(a + ': 맞는 토큰이면 통과', authOf(a, 'test-secret-token-0123456789abcdef').ok);
    });
    const bigW = (action, n) => '{"action":"' + action + '","payload":{"data":"' + 'A'.repeat(n) + '"}}';
    const sizeW = (raw) => callHandler(U.ctx, 'assertRequestSizeWithinLimit_', raw).code;
    ok('result_put 조각(2.8MB)은 통과 · 3.6MB 는 거부 · 다른 액션은 512KB 유지', sizeW(bigW('result_put', 2800000)) === undefined && sizeW(bigW('result_put', 3600000)) === 'ERR_PAYLOAD_TOO_LARGE' && sizeW(bigW('result_list', 600 * 1024)) === 'ERR_PAYLOAD_TOO_LARGE');

    const rput = (p) => callHandler(U.ctx, 'handleResultPut_', null, p);
    const rlist = (cid) => callHandler(U.ctx, 'handleResultList_', null, { content_id: cid });
    const rfetch = (p) => callHandler(U.ctx, 'handleResultFetch_', null, p);
    const rdel = (p) => callHandler(U.ctx, 'handleResultDelete_', null, p);
    const enc = (buf) => Buffer.from(buf).toString('base64');
    const video = Buffer.from(Array.from({ length: 4500 }, (_, i) => (i * 13) % 256));
    const vs = [video.subarray(0, 2000), video.subarray(2000, 4000), video.subarray(4000)];

    eq('아무것도 안 올렸으면 빈 목록(폴더도 만들지 않는다)', JSON.stringify(rlist('R-001').data), JSON.stringify({ content_id: 'R-001', items: [] }));
    ok('빈 목록 조회는 폴더를 만들지 않는다', !up.folders.some(f => f.name === 'out_R-001'));
    vs.forEach((s, i) => {
      const r = rput({ content_id: 'R-001', name: 'R-001_finish.mp4', index: i, parts: 3, total_size: 4500, data: enc(s) });
      ok('조각 ' + i + ' 저장', r.ok && r.data.bytes === s.length && r.data.index === i, r);
    });
    const jpg = Buffer.from([255, 216, 255, 224, 1, 2, 3, 4]);
    ok('커버(jpg)는 조각 1개로', rput({ content_id: 'R-001', name: 'R-001_cover.jpg', index: 0, parts: 1, data: enc(jpg) }).ok);
    const outDir = up.folders.find(f => f.name === 'out_R-001');
    ok('폴더 구조: ContentHubOS_Uploads / out_R-001 · 비공개 · 영상 올리기 폴더(R-001)와 따로', !!outDir && outDir.shared === 'PRIVATE/NONE' && !up.folders.some(f => f.name === 'R-001'), up.folders.map(f => f.name));
    const L = rlist('R-001').data.items;
    ok('목록: 이름·크기·조각 수·완료·종류·올린 시각', L.length === 2 && L[1].name === 'R-001_finish.mp4' && L[1].size === 4500 && L[1].parts === 3 && L[1].complete === true && L[1].kind === 'video' && /^20\d\d-/.test(L[1].updated_at) && L[0].name === 'R-001_cover.jpg' && L[0].kind === 'image' && L[0].size === 8, L);
    const got = [0, 1, 2].map(i => rfetch({ content_id: 'R-001', name: 'R-001_finish.mp4', index: i, parts: 3 }));
    ok('받기: 조각을 이어 붙이면 원본과 같다', got.every(g => g.ok) && Buffer.compare(Buffer.concat(got.map(g => Buffer.from(g.data.data, 'base64'))), video) === 0, got.map(g => g.code));
    eq('받기: 없는 조각은 ERR_NOT_FOUND', rfetch({ content_id: 'R-001', name: 'R-001_finish.mp4', index: 1, parts: 4 }).code, 'ERR_NOT_FOUND');
    eq('받기: 올린 적 없는 카드는 ERR_NOT_FOUND', rfetch({ content_id: 'R-NONE', name: 'a.mp4', index: 0, parts: 1 }).code, 'ERR_NOT_FOUND');
    // 덮어쓰기: 0번을 다시 올리면 앞선 조각이 사라지고 새 크기로
    rput({ content_id: 'R-001', name: 'R-001_finish.mp4', index: 0, parts: 1, data: enc(vs[2]) });
    const L2 = rlist('R-001').data.items.find(x => x.name === 'R-001_finish.mp4');
    ok('같은 이름을 다시 올리면 덮어쓴다(옛 조각 삭제)', L2.parts === 1 && L2.size === vs[2].length && L2.complete === true, L2);
    // 안 끝난 업로드
    rput({ content_id: 'R-002', name: 'x.mp4', index: 0, parts: 3, data: enc(vs[0]) });
    const L3 = rlist('R-002').data.items[0];
    ok('조각이 빠지면 complete=false 와 찾은 개수', L3.complete === false && L3.parts_found === 1 && L3.parts === 3, L3);
    // 검증
    const base = { content_id: 'R-003', name: 'ok.mp4', index: 0, parts: 1, data: enc(Buffer.from('abc')) };
    const rc = (p) => rput(Object.assign({}, base, p)).code;
    ok('이름·확장자 검사: 경로·.mov·.png·점으로 시작', ['../x.mp4', 'a/b.mp4', 'x.mov', 'x.png', '.hid.mp4', 'x'.repeat(90) + '.mp4', ''].every(n => rc({ name: n }) === 'ERR_VALIDATION_FAILED'));
    ok('content_id·조각 번호·data 검사', rc({ content_id: '../x' }) === 'ERR_VALIDATION_FAILED' && rc({ content_id: '_x' }) === 'ERR_VALIDATION_FAILED' && rc({ parts: 0 }) === 'ERR_VALIDATION_FAILED' && rc({ parts: 101 }) === 'ERR_VALIDATION_FAILED' && rc({ index: 1 }) === 'ERR_VALIDATION_FAILED' && rc({ data: '' }) === 'ERR_VALIDATION_FAILED' && rc({ data: 'a b!' }) === 'ERR_VALIDATION_FAILED');
    eq('조각이 2MB 를 넘으면 거부', rc({ data: enc(Buffer.alloc(2 * 1024 * 1024 + 1)) }), 'ERR_VALIDATION_FAILED');
    ok('영상 올리기 목록에는 결과 파일이 섞이지 않는다(폴더가 다르다)', callHandler(U.ctx, 'handleUploadVideoList_', null, { content_id: 'R-001' }).data.items.length === 0);
    // 삭제
    const d = rdel({ content_id: 'R-001', name: 'R-001_cover.jpg' });
    ok('삭제: 파일 하나의 조각 전부 휴지통으로 · 다른 파일은 그대로', d.ok && d.data.removed === 1 && rlist('R-001').data.items.map(x => x.name).join() === 'R-001_finish.mp4', d);
    eq('삭제: 올린 적 없으면 0개', rdel({ content_id: 'R-NONE', name: 'a.mp4' }).data.removed, 0);
    eq('삭제: 이름 검사', rdel({ content_id: 'R-001', name: '../x.mp4' }).code, 'ERR_VALIDATION_FAILED');
  }
}

console.log('\n[B] 백업 버그 3종 (gas/Backup.gs) — 보존 정리 · 시트 사본 · 무결성 점검 분리/이어하기');
{
  /* ── 가짜 드라이브·시트 ── */
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  class BFile {
    constructor(name, content, created, registry) {
      this.name = name; this.content = content == null ? '' : content; this.created = created || new Date(); this.trashed = false; this.parent = null;
      this.id = 'bf_' + Math.random().toString(36).slice(2, 12); this.copies = 0; this.registry = registry; if (registry) registry.set(this.id, this);
    }
    getId() { return this.id; }
    getName() { return this.name; }
    getSize() { return String(this.content).length || 10; }
    getDateCreated() { return this.created; }
    getBlob() { return { getBytes: () => Array.from(Buffer.from(String(this.content))), getDataAsString: () => String(this.content) }; }
    setTrashed(v) { this.trashed = !!v; return this; }
    isTrashed() { return this.trashed === true; }
    getSharingAccess() { return 'PRIVATE'; }
    makeCopy(name, folder) { this.copies++; const f = new BFile(name, this.content, new Date(), this.registry); (folder || this.parent).adopt(f); return f; }
    moveTo(folder) { if (this.parent) this.parent.files = this.parent.files.filter((x) => x !== this); folder.adopt(this); return this; }
  }
  class BFolder {
    constructor(name, registry) { this.name = name; this.files = []; this.folders = []; this.registry = registry; this.id = 'bd_' + name + '_' + Math.random().toString(36).slice(2, 8); if (registry) registry.set(this.id, this); }
    getId() { return this.id; }
    getName() { return this.name; }
    adopt(f) { f.parent = this; this.files.push(f); return f; }
    live() { return this.files.filter((f) => !f.trashed); }
    getFiles() { return iter(this.live()); }
    getFilesByName(n) { return iter(this.live().filter((f) => f.name === n)); }
    getFoldersByName(n) { return iter(this.folders.filter((f) => f.name === n)); }
    createFolder(n) { const f = new BFolder(n, this.registry); this.folders.push(f); return f; }
    createFile(a, content) { const name = typeof a === 'string' ? a : a.name; return this.adopt(new BFile(name, typeof a === 'string' ? content : '(blob)', new Date(), this.registry)); }
    setSharing() { return this; }
    getSharingAccess() { return 'PRIVATE'; }
  }
  class BSheet {
    constructor(name, rows, cols, opts) { this.name = name; this.rows = rows; this.cols = cols; this.hidden = !!(opts && opts.hidden); this.values = (opts && opts.values) || null; this.formulas = (opts && opts.formulas) || 0; this.owner = null; }
    getName() { return this.name; }
    setName(n) { this.name = n; return this; }
    getLastRow() { return this.rows; }
    getLastColumn() { return this.cols; }
    isSheetHidden() { return this.hidden; }
    hideSheet() { this.hidden = true; return this; }
    getRange(r, c, nr, nc) { return { getValues: () => (this.values ? this.values.slice(r - 1, r - 1 + (nr || 1)).map((x) => x.slice(c - 1)) : [Array(nc || 1).fill('')]), setValues: (v) => { this.appended = (this.appended || []).concat(v); this.rows += v.length; } }; }
    appendRow(row) { (this.appended = this.appended || []).push(row); this.rows++; }
    copyTo(target) { if (this.owner && this.owner.failAt && target.copyCount >= this.owner.failAt) throw new Error('copyTo 실패(시험)'); target.copyCount = (target.copyCount || 0) + 1; const c = new BSheet('Copy of ' + this.name, this.rows, this.cols, { hidden: false, formulas: this.formulas }); c.owner = target; target.sheets.push(c); return c; }
  }
  class BSS {
    constructor(name, sheets, reg) { this.name = name; this.sheets = sheets; this.sheets.forEach((s) => { s.owner = this; }); this.id = 'ss_' + Math.random().toString(36).slice(2, 10); this.file = new BFile(name, 'x'.repeat(100), new Date(), reg); }
    getId() { return this.file.id; }
    getSheets() { return this.sheets.slice(); }
    getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
    deleteSheet(sh) { this.sheets = this.sheets.filter((s) => s !== sh); }
  }

  function makeWorld() {
    const W = loadGas();
    const registry = new Map();
    const root = new BFolder('내 드라이브', registry);
    const triggers = [];
    const log = { triggerCalls: [] };
    const builder = (fn) => {
      const rec = { fn, calls: [] };
      const b = new Proxy({}, { get: (_, name) => (name === 'create' ? () => { triggers.push(rec); return rec; } : (...a) => { rec.calls.push([String(name), a]); return b; }) });
      return b;
    };
    W.ctx.DriveApp = {
      getRootFolder: () => root,
      getFolderById: (id) => { if (!registry.has(id)) throw new Error('폴더 없음 ' + id); return registry.get(id); },
      getFileById: (id) => { if (!registry.has(id)) throw new Error('파일 없음 ' + id); return registry.get(id); },
      Access: { PRIVATE: 'PRIVATE', ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { NONE: 'NONE' }
    };
    W.ctx.MimeType = { PLAIN_TEXT: 'text/plain' };
    W.ctx.ScriptApp = {
      newTrigger: (fn) => builder(fn),
      getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, _rec: t })),
      deleteTrigger: (h) => { const i = triggers.indexOf(h._rec); if (i >= 0) triggers.splice(i, 1); },
      WeekDay: { SUNDAY: 'SUNDAY' }
    };
    return { W, registry, root, triggers };
  }
  const stampOf = (day, hh) => '202611' + String(day).padStart(2, '0') + '_' + String(hh || 3).padStart(2, '0') + '0015';

  /* ── 버그 3: 보존 정리 ── */
  {
    const { W, registry } = makeWorld();
    const key = (n) => W.ctx.snapshotKeyOf_(n);
    ok('이름 → 스냅샷 키: SHEETS·manifest·presets·payload 가 모두 같은 키', ['_SHEETS', '_backup_manifest.json', '_config_presets.json', '_payload_abc123.json'].every((suf) => key('SNAPSHOT_DAILY_20261120_030015' + suf).key === 'SNAPSHOT_DAILY_20261120_030015'));
    ok('키는 tier·타임스탬프까지 읽는다', key('SNAPSHOT_MANUAL_20261120_030015_SHEETS').tier === 'MANUAL' && key('SNAPSHOT_DAILY_20261120_030015_SHEETS').stamp === '20261120_030015');
    ok('규칙에 안 맞는 이름은 null(건드리지 않는다)', key('memo.txt') === null && key('SNAPSHOT_DAILY_x_SHEETS') === null && key('SNAPSHOT_YEARLY_20261120_030015_SHEETS') === null);

    const folder = new BFolder('daily', registry);
    const mk = (tier, day, hh, payloads) => {
      const base = 'SNAPSHOT_' + tier + '_' + stampOf(day, hh);
      const t = new Date(2026, 10, day, hh || 3);
      ['_SHEETS', '_backup_manifest.json', '_config_presets.json'].forEach((s) => folder.adopt(new BFile(base + s, '', t, registry)));
      for (let i = 0; i < payloads; i++) folder.adopt(new BFile(base + '_payload_p' + i + '.json', '{}', t, registry));
      return base;
    };
    // 일일 스냅샷 20개(11/1~11/20) — 각 스냅샷에 payload 40개씩 = 파일 860개
    for (let d = 1; d <= 20; d++) mk('DAILY', d, 3, 40);
    for (let d = 1; d <= 3; d++) mk('MANUAL', d, 12, 5);
    folder.adopt(new BFile('README_memo.txt', 'x', new Date(2020, 0, 1), registry));
    const total = folder.live().length;
    ok('시험 준비: 일일 20묶음×43파일 + 수동 3묶음×8파일 + 메모 1개', total === 20 * 43 + 3 * 8 + 1, total);

    const res = W.ctx.applyRetention_('DAILY', folder);
    const liveDaily = folder.live().filter((f) => /^SNAPSHOT_DAILY_/.test(f.name));
    const keptKeys = new Set(liveDaily.map((f) => f.name.match(/^(SNAPSHOT_DAILY_\d{8}_\d{6})/)[1]));
    ok('일일 14개 스냅샷이 온전히 남는다(최근 14일)', keptKeys.size === 14 && res.kept.length === 14, [keptKeys.size, res.kept.length]);
    ok('남은 14개는 11/7~11/20 이다(최신 14개)', [...keptKeys].every((k) => Number(k.slice(15, 17)) >= 7) && keptKeys.has('SNAPSHOT_DAILY_' + stampOf(20, 3)) && keptKeys.has('SNAPSHOT_DAILY_' + stampOf(7, 3)) && !keptKeys.has('SNAPSHOT_DAILY_' + stampOf(6, 3)));
    ok('남은 스냅샷마다 파일 43개가 전부 있다(payload 40 + 3)', [...keptKeys].every((k) => liveDaily.filter((f) => f.name.indexOf(k) === 0).length === 43));
    ok('15번째부터(11/1~11/6, 6개)만 휴지통으로 간다', res.trashed.length === 6 && folder.files.filter((f) => f.trashed).length === 6 * 43 && folder.files.filter((f) => f.trashed).every((f) => Number(f.name.match(/_(\d{8})_/)[1].slice(6, 8)) <= 6));
    ok('수동 백업·메모 파일은 일일 정리가 건드리지 않는다', folder.live().filter((f) => /^SNAPSHOT_MANUAL_/.test(f.name)).length === 24 && folder.live().some((f) => f.name === 'README_memo.txt'));

    const again = W.ctx.applyRetention_('DAILY', folder);
    ok('다시 돌려도 더 지우지 않는다(멱등)', again.trashed.length === 0 && folder.live().filter((f) => /^SNAPSHOT_DAILY_/.test(f.name)).length === 14 * 43);

    // 14개 이하면 아무것도 지우지 않는다
    const f2 = new BFolder('daily2', registry);
    for (let d = 1; d <= 9; d++) { ['_SHEETS', '_backup_manifest.json'].concat(Array.from({ length: 30 }, (_, i) => '_payload_p' + i + '.json')).forEach((s) => f2.adopt(new BFile('SNAPSHOT_DAILY_' + stampOf(d, 3) + s, '', new Date(2026, 10, d), registry))); }
    ok('스냅샷이 9개뿐이면 payload 가 수백 개여도 하나도 안 지운다', W.ctx.applyRetention_('DAILY', f2).trashed.length === 0 && f2.files.every((f) => !f.trashed));

    // 수동 10 · 주간 8 · 월간 6
    const manual = new BFolder('m', registry);
    for (let d = 1; d <= 13; d++) { ['_SHEETS', '_backup_manifest.json', '_payload_a.json'].forEach((s) => manual.adopt(new BFile('SNAPSHOT_MANUAL_' + stampOf(d, 12) + s, '', new Date(2026, 10, d), registry))); }
    ok('수동은 10개 스냅샷을 남긴다', W.ctx.applyRetention_('MANUAL', manual).kept.length === 10 && manual.live().length === 30);
    const weekly = new BFolder('w', registry);
    for (let d = 1; d <= 12; d++) ['_SHEETS', '_payload_a.json'].forEach((s) => weekly.adopt(new BFile('SNAPSHOT_WEEKLY_' + stampOf(d, 3) + s, '', new Date(2026, 10, d), registry)));
    ok('주간은 8개', W.ctx.applyRetention_('WEEKLY', weekly).kept.length === 8 && weekly.live().length === 16);
    const monthly = new BFolder('mo', registry);
    for (let d = 1; d <= 9; d++) ['_SHEETS', '_payload_a.json'].forEach((s) => monthly.adopt(new BFile('SNAPSHOT_MONTHLY_' + stampOf(d, 4) + s, '', new Date(2026, 10, d), registry)));
    ok('월간은 6개', W.ctx.applyRetention_('MONTHLY', monthly).kept.length === 6 && monthly.live().length === 12);

    // 생성 시각이 뒤섞여도(복사 시각) 키의 타임스탬프로 최신을 가른다
    const f3 = new BFolder('f3', registry);
    for (let d = 1; d <= 16; d++) f3.adopt(new BFile('SNAPSHOT_DAILY_' + stampOf(d, 3) + '_SHEETS', '', new Date(2026, 10, 30 - d), registry));   // 만든 시각은 거꾸로
    const r3 = W.ctx.applyRetention_('DAILY', f3);
    ok('파일 생성 시각이 거꾸로여도 이름의 시각이 최신인 14개를 남긴다', r3.trashed.sort().join(',') === ['SNAPSHOT_DAILY_' + stampOf(1, 3), 'SNAPSHOT_DAILY_' + stampOf(2, 3)].join(','), r3.trashed);

    // 이어하기 중인 스냅샷은 지우지 않는다
    const f4 = new BFolder('f4', registry);
    for (let d = 1; d <= 16; d++) f4.adopt(new BFile('SNAPSHOT_DAILY_' + stampOf(d, 3) + '_SHEETS', '', new Date(2026, 10, d), registry));
    W.env.props.set('BACKUP_STATE', JSON.stringify({ snapshotName: 'SNAPSHOT_DAILY_' + stampOf(1, 3) }));
    W.ctx.applyRetention_('DAILY', f4);
    ok('이어하기 중인 스냅샷은 오래돼도 보호한다', f4.files.filter((f) => f.trashed).length === 1 && !f4.files.find((f) => f.name.indexOf(stampOf(1, 3)) > 0).trashed);
    ok('모르는 tier 는 아무것도 안 한다', W.ctx.applyRetention_('YEARLY', f4).trashed.length === 0);
  }

  /* ── 버그 1: 시트 사본에 바인딩 스크립트가 딸려 오지 않는다 ── */
  {
    const { W, registry, root } = makeWorld();
    let created = null;
    const mkSS = () => new BSS('원본', [
      new BSheet('Contents', 120, 37, { formulas: 5 }), new BSheet('Config', 9, 4), new BSheet('Brand_Config', 6, 5, { hidden: true }), new BSheet('Channel_Logs', 5000, 16)
    ], registry);
    const src = mkSS();
    let makeCopyCalls = 0;
    src.file.makeCopy = () => { makeCopyCalls++; throw new Error('makeCopy 를 쓰면 안 된다'); };
    W.ctx.SpreadsheetApp = Object.assign({}, W.ctx.SpreadsheetApp, {
      create: (name) => { created = new BSS(name, [new BSheet('시트1', 1000, 26)], registry); root.adopt(created.file); return created; },
      getActiveSpreadsheet: () => src
    });
    const backup = new BFolder('daily', registry);
    const r = W.ctx.copySpreadsheetWithoutScript_(src, 'SNAPSHOT_DAILY_X_SHEETS', backup);
    ok('makeCopy 를 부르지 않는다(바인딩 스크립트 복제 원인)', makeCopyCalls === 0);
    ok('시트 4개가 같은 이름·같은 순서로 복사된다(임시·기본 시트는 지운다)', created.sheets.map((s) => s.name).join(',') === 'Contents,Config,Brand_Config,Channel_Logs', created.sheets.map((s) => s.name));
    ok('시트마다 copyTo 로 복사한다(값 루프가 아님 — 수식·서식 유지)', created.copyCount === 4 && r.report.sheets === 4);
    ok('숨긴 시트는 숨긴 채로', created.sheets[2].hidden === true && created.sheets[0].hidden === false);
    ok('행·열 수가 같다(불일치 0건)', r.report.mismatches.length === 0 && created.sheets[3].rows === 5000);
    ok('사본 파일은 백업 폴더로 옮겨지고 루트에는 안 남는다', backup.files.includes(r.file) && !root.files.includes(r.file) && r.file.name === 'SNAPSHOT_DAILY_X_SHEETS');

    // 실패하면 반쪽 사본을 지운다
    const src2 = mkSS(); src2.failAt = 2;
    const before = backup.live().length;
    let msg = '';
    try { W.ctx.copySpreadsheetWithoutScript_(src2, 'SNAPSHOT_DAILY_Y_SHEETS', backup); } catch (e) { msg = e.message; }
    ok('중간에 실패하면 오류를 올리고 반쪽 사본은 휴지통으로', /copyTo 실패/.test(msg) && created.file.trashed === true && backup.live().length === before, msg);

    // 행·열이 다르면 알린다
    const src3 = mkSS(); const orig = src3.sheets[1].copyTo.bind(src3.sheets[1]);
    src3.sheets[1].copyTo = (t) => { const c = orig(t); c.rows = 3; return c; };
    const r3 = W.ctx.copySpreadsheetWithoutScript_(src3, 'SNAPSHOT_DAILY_Z_SHEETS', backup);
    ok('복사본의 행 수가 다르면 report.mismatches 에 이름이 남는다', r3.report.mismatches.join(',') === 'Config', r3.report);

    // 파이프라인 전체: SHEETS 사본·매니페스트가 생기고 makeCopy 는 시트 파일에 안 쓴다
    const src4 = mkSS(); let mc = 0; src4.file.makeCopy = () => { mc++; throw new Error('x'); };
    W.ctx.SpreadsheetApp.getActiveSpreadsheet = () => src4;
    W.env.props.set('BACKUP_ROOT_FOLDER_ID', '');
    const res = W.ctx.runBackupPipeline_('DAILY', 'test');
    const dailyFolder = root.folders.find((f) => f.name === 'ContentHubOS_Backups').folders.find((f) => f.name === 'daily');
    const names = dailyFolder.live().map((f) => f.name);
    ok('백업 파이프라인: 성공·시트 사본·매니페스트·설정 프리셋이 daily 폴더에 생긴다', res.ok && res.partial === false && names.some((n) => /_SHEETS$/.test(n)) && names.some((n) => /_backup_manifest\.json$/.test(n)) && names.some((n) => /_config_presets\.json$/.test(n)), names);
    ok('백업 파이프라인이 시트 파일을 makeCopy 하지 않는다', mc === 0);
    const manifest = JSON.parse(dailyFolder.live().find((f) => /_backup_manifest\.json$/.test(f.name)).content);
    ok('매니페스트에 시트 복사 점검 결과(sheet_copy_check)가 남는다', manifest.sheet_copy_check && manifest.sheet_copy_check.sheets === 4 && manifest.sheet_copy_check.mismatches.length === 0, manifest.sheet_copy_check);
    ok('복구용 시트 찾기(_SHEETS$)가 새 사본 이름과 맞는다', names.filter((n) => /_SHEETS$/.test(n)).length === 1);
  }

  /* ── 버그 2: 무결성 점검 분리 · 시간 분할 · 이어하기 ── */
  {
    // 트리거 구성
    const { W, triggers } = makeWorld();
    W.ctx.installSystemTriggers_();
    const find = (fn) => triggers.find((t) => t.fn === fn);
    const call = (t, name) => (t.calls.find((c) => c[0] === name) || [null, []])[1];
    ok('무결성 점검 트리거가 등록된다(매일 05:00 KST)', find('runIntegrityCheckTrigger') && call(find('runIntegrityCheckTrigger'), 'atHour')[0] === 5 && call(find('runIntegrityCheckTrigger'), 'inTimezone')[0] === 'Asia/Seoul' && call(find('runIntegrityCheckTrigger'), 'everyDays')[0] === 1);
    ok('백업(03:00)·주간(일 03:30)·월간(1일 04:00)과 30분 이상 떨어져 있다', call(find('runDailyBackupTrigger'), 'atHour')[0] === 3 && 5 - 3 >= 1 && 5 - 4 >= 1);
    ok('다시 설치해도 중복되지 않는다(멱등)', (() => { W.ctx.installSystemTriggers_(); return triggers.filter((t) => t.fn === 'runIntegrityCheckTrigger').length === 1 && triggers.filter((t) => t.fn === 'runDailyBackupTrigger').length === 1; })());

    // 일일 백업 트리거는 백업만 한다
    let backupCalls = 0, integrityCalls = 0;
    W.ctx.runBackupPipeline_ = () => { backupCalls++; return { ok: true }; };
    W.ctx.runIntegrityCheck_ = () => { integrityCalls++; return { ok: true }; };
    W.ctx.runDailyBackupTrigger();
    ok('runDailyBackupTrigger 는 백업만 돌리고 무결성 점검은 부르지 않는다', backupCalls === 1 && integrityCalls === 0, [backupCalls, integrityCalls]);
    W.ctx.runIntegrityCheckTrigger();
    ok('runIntegrityCheckTrigger 는 점검만 돌린다', backupCalls === 1 && integrityCalls === 1);
  }

  function integrityWorld(opts) {
    const w = makeWorld();
    const { W, registry, root } = w;
    let clock = 1000000;
    W.ctx.nowMs_ = () => clock;
    const header = vm.runInContext('SHEET_SCHEMAS', W.ctx).Contents;
    const col = (n) => header.indexOf(n);
    const values = [header];
    const files = new Map();
    const brokenRows = opts.broken || [];
    const calls = {};
    for (let i = 1; i <= opts.rows; i++) {
      const f = new BFile('payload_' + i + '.json', '{"a":1}', new Date(), registry);
      files.set(i, f);
      const row = Array(header.length).fill('');
      row[col('content_id')] = 'C-' + i; row[col('brand')] = 'daejeon_youth'; row[col('payload_file_id')] = brokenRows.indexOf(i) >= 0 ? 'missing_' + i : f.id; row[col('status')] = 'REVIEW'; row[col('updated_by')] = 'user';
      values.push(row);
    }
    const contents = new BSheet('Contents', values.length, header.length, { values });
    const logs = new BSheet('Integrity_Logs', 1, 9);
    // 스키마 점검이 '시트 없음'으로 가득 차지 않게 스키마에 있는 시트를 헤더만 갖춰 만들어 둔다(Contents·Integrity_Logs 는 위에서 만든 것)
    const schemas = vm.runInContext('SHEET_SCHEMAS', W.ctx);
    const extra = Object.keys(schemas).filter((n) => n !== 'Contents' && n !== 'Integrity_Logs').map((n) => new BSheet(n, 1, schemas[n].length, { values: [schemas[n]] }));
    logs.values = [schemas.Integrity_Logs]; logs.cols = schemas.Integrity_Logs.length;
    const ss = new BSS('원본', [contents, logs].concat(extra), registry);
    W.ctx.SpreadsheetApp = Object.assign({}, W.ctx.SpreadsheetApp, { getActiveSpreadsheet: () => ss });
    const realGet = W.ctx.DriveApp.getFileById;
    W.ctx.DriveApp.getFileById = (id) => { calls[id] = (calls[id] || 0) + 1; clock += opts.stepMs || 0; return realGet(id); };
    // payload 폴더(고아 파일 점검)
    const pf = new BFolder('daejeon_youth', registry);
    for (let i = 1; i <= opts.rows; i++) { files.get(i).parent = pf; pf.files.push(files.get(i)); }
    for (let i = 0; i < (opts.orphans || 0); i++) pf.adopt(new BFile('payload_orphan_' + i + '.json', '{}', new Date(), registry));
    W.env.props.set('FOLDER_DAEJEON_YOUTH', pf.id);
    // 고아 파일 점검은 파일마다 이름을 읽을 때 시간이 든다(건너뛰기용 next() 는 공짜) — 이어하기 비용을 현실적으로 흉내 낸다
    if (opts.orphanStepMs) pf.files.forEach((f) => { const gn = f.getName.bind(f); f.getName = () => { clock += opts.orphanStepMs; return gn(); }; });
    return Object.assign(w, { logs, calls, advance: (ms) => { clock += ms; }, getClock: () => clock });
  }
  const logRows = (w) => (w.logs.appended || []);

  {
    const w = integrityWorld({ rows: 5, stepMs: 10 });
    const r = w.W.ctx.runIntegrityCheck_('test');
    ok('작으면 한 번에 끝난다(partial=false) · 문제 없음 한 줄', r.ok && r.partial === false && r.total_issues === 0 && logRows(w).length === 1 && logRows(w)[0][2] === 'INFO', JSON.stringify(r));
    ok('끝나면 상태·실행 중 표시를 지운다', !w.W.env.props.has('INTEGRITY_STATE') && !w.W.env.props.has('INTEGRITY_RUNNING_AT') && w.triggers.length === 0);
  }

  {
    // 행 100개, 드라이브 호출 1번마다 3초 → 4분 30초(270초)에 90행쯤 처리하고 멈춰야 한다
    const w = integrityWorld({ rows: 100, stepMs: 3000, broken: [10, 95] });
    const r1 = w.W.ctx.runIntegrityCheck_('trigger');
    const st1 = JSON.parse(w.W.env.props.get('INTEGRITY_STATE'));
    ok('1회차: 4분 30초에서 멈추고 partial=true', r1.partial === true && r1.phase === 'CONTENTS' && st1.row > 80 && st1.row < 100, JSON.stringify([r1, st1.row]));
    ok('멈춘 지점(행 번호)이 속성에 저장된다', st1.phase === 'CONTENTS' && st1.v === 1 && w.W.env.props.get('INTEGRITY_RESUME_SCHEDULED') === '1');
    ok('이어하기 1회성 트리거가 1개 예약된다(2분 뒤)', w.triggers.filter((t) => t.fn === 'runIntegrityResumeTrigger').length === 1 && w.triggers[0].calls.some((c) => c[0] === 'timeBased'));
    ok('1회차에 찾은 문제(10행)는 이미 시트에 적혔고, 아직 \'문제 없음\' 줄은 없다', logRows(w).length === 1 && logRows(w)[0][2] === 'CRITICAL' && logRows(w)[0][5] === 'C-10', JSON.stringify(logRows(w)));
    ok('1회차는 270초를 넘기지 않는다', w.getClock() - 1000000 <= 270000 + 3000 + 100, w.getClock() - 1000000);
    const r1b = w.W.ctx.runIntegrityCheck_('again-too-soon');
    ok('실행 중 표시가 없을 때만 새로 돈다(이전 실행이 끝났으므로 이어서 진행)', r1b.skipped !== true);
    // 상태를 되돌려 1회차 직후 상태에서 resume 을 시험한다
    const w2 = integrityWorld({ rows: 100, stepMs: 3000, broken: [10, 95] });
    w2.W.ctx.runIntegrityCheck_('trigger');
    w2.W.ctx.runIntegrityResumeTrigger();
    const doneState = w2.W.env.props.has('INTEGRITY_STATE');
    ok('2회차(이어하기)에서 끝까지 간다 — 상태 삭제·트리거 정리', doneState === false && w2.W.env.props.has('INTEGRITY_RESUME_SCHEDULED') === false);
    const broken2 = logRows(w2).filter((x) => x[3] === 'BROKEN_FILE_ID');
    ok('두 실행에 걸쳐 깨진 파일 2건(10행·95행)이 정확히 한 번씩 적힌다', broken2.length === 2 && broken2.map((x) => x[5]).sort().join(',') === 'C-10,C-95' && broken2.every((x) => x[2] === 'CRITICAL'), JSON.stringify(broken2));
    ok('문제가 있으면 문제 없음(INFO) 줄은 쓰지 않는다', !logRows(w2).some((x) => x[2] === 'INFO'));
    const ids = Object.keys(w2.calls).filter((k) => !/^ss_|^bd_/.test(k));
    ok('모든 행의 파일을 정확히 한 번씩만 확인한다(처음부터 다시 하지 않는다)', ids.filter((k) => !/^missing_/.test(k)).every((k) => w2.calls[k] === 1) && Object.keys(w2.calls).filter((k) => /^missing_/.test(k)).every((k) => w2.calls[k] === 1), JSON.stringify(w2.calls).slice(0, 200));
    ok('이어하기 트리거 핸들러가 이미 지나간 1회성 트리거를 지운다', w2.triggers.filter((t) => t.fn === 'runIntegrityResumeTrigger').length === 0);
  }

  {
    // 고아 파일 단계에서 멈췄다가 이어하기 — 찾은 고아가 중복·누락 없이 적힌다
    const w = integrityWorld({ rows: 3, stepMs: 0, orphans: 120, orphanStepMs: 1500 });
    const r1 = w.W.ctx.runIntegrityCheck_('trigger');
    const st = JSON.parse(w.W.env.props.get('INTEGRITY_STATE') || 'null');
    ok('고아 파일 단계에서도 4분 30초에 멈추고 이어하기를 예약한다', r1.partial === true && r1.phase === 'ORPHANS' && st && st.orphanSkip > 0 && w.triggers.length === 1, JSON.stringify([r1, st]));
    w.W.ctx.runIntegrityResumeTrigger();
    const orphanRows = logRows(w).filter((x) => x[3] === 'ORPHAN_DRIVE_FILE');
    ok('고아 120개가 중복·누락 없이 한 번씩 적힌다', orphanRows.length === 120 && new Set(orphanRows.map((x) => x[5])).size === 120 && !w.W.env.props.has('INTEGRITY_STATE'), [orphanRows.length, new Set(orphanRows.map((x) => x[5])).size]);
  }

  {
    // 동시 실행 방지 · 오래된 상태 버리기
    const w = integrityWorld({ rows: 3, stepMs: 0 });
    w.W.env.props.set('INTEGRITY_RUNNING_AT', String(w.getClock() - 60000));
    const r = w.W.ctx.runIntegrityCheck_('x');
    ok('1분 전부터 실행 중이면 새로 돌지 않는다(skipped)', r.skipped === true && r.reason === 'already_running' && logRows(w).length === 0);
    w.W.env.props.set('INTEGRITY_RUNNING_AT', String(w.getClock() - 20 * 60 * 1000));
    ok('20분 넘게 남은 실행 표시는 죽은 것으로 보고 새로 돈다', w.W.ctx.runIntegrityCheck_('x').skipped !== true);
    w.W.env.props.set('INTEGRITY_STATE', JSON.stringify({ v: 1, phase: 'ORPHANS', row: 1, total: 9, critical: 9, warn: 0, written: 9, startedAt: w.getClock() - 20 * 3600 * 1000, actor: 'old' }));
    const r2 = w.W.ctx.runIntegrityCheck_('x');
    ok('12시간 넘은 저장 상태는 버리고 처음부터(옛 문제 수가 섞이지 않는다)', r2.total_issues === 0 && r2.critical === 0, JSON.stringify(r2));
    ok('백업 상태 요약에 점검 대기 여부가 나온다', typeof w.W.ctx.getBackupStatus_().pending_integrity === 'boolean');
  }
}

console.log('\n[13] 네이버 데이터랩 (gas/Insight.gs) — 천장·캐시·파싱');
{
  /* ── 키가 없으면 부르지 않고 안내한다 ── */
  {
    const N = loadGas();
    const r = callHandler(N.ctx, 'handleInsightTrend_', null, { groups: [{ name: '대전 맛집', keywords: ['대전 맛집'] }] });
    eq('키가 없으면 ERR_NO_NAVER_KEY', r.code, 'ERR_NO_NAVER_KEY');
    eq('키가 없으면 밖으로 나가지 않는다', N.env.fetched.length, 0);
  }

  /* ── 정상 호출 · 파싱 · 캐시 ── */
  {
    const N = loadGas();
    N.env.props.set('NAVER_CLIENT_ID', 'test-id');
    N.env.props.set('NAVER_CLIENT_SECRET', 'test-secret');
    N.env.props.set('NAVER_API_MODE', 'hub');
    const ratios = [20, 20, 20, 20, 20, 20, 20, 20, 40, 40, 40, 40];
    N.env.setFetchReply({
      code: 200,
      body: JSON.stringify({
        startDate: '2025-11-01', endDate: '2026-11-20', timeUnit: 'week',
        results: [{
          title: '대전 맛집', keywords: ['대전 맛집'],
          data: ratios.map((r, i) => ({ period: '2026-0' + (i < 9 ? 1 : 2) + '-' + pad(i + 1), ratio: r }))
        }]
      })
    });
    const r = callHandler(N.ctx, 'handleInsightTrend_', null, {
      brand: 'daejeon_youth', months: 12, unit: 'week',
      groups: [{ name: '대전 맛집', keywords: ['대전 맛집'] }]
    });
    ok('트렌드를 읽는다', r.ok, r);
    const g = r.ok ? r.data.groups[0] : {};
    eq('주제어 이름', g.title, '대전 맛집');
    eq('최근 4구간 평균', g.recent4, 40);
    eq('직전 4구간 평균', g.prev4, 20);
    eq('증감률 +100%', g.delta_pct, 100);
    eq('판정은 오르는 중', g.trend, '오르는 중');
    eq('기간 최고 100 기준값', g.peak, 40);
    eq('성수기 뱀지', g.season, '성수기');
    ok('열두 구간을 모두 돌려준다', g.series.length === 12, g.series && g.series.length);
    ok('HUB 주소로 부른다', N.env.fetched[0].url.indexOf('naverapihub.apigw.ntruss.com/search-trend/v1/search') > 0, N.env.fetched[0].url);
    ok('키는 헤더로만(주소에 없음)', !/test-secret/.test(N.env.fetched[0].url) && N.env.fetched[0].opts.headers['X-NCP-APIGW-API-KEY'] === 'test-secret');
    ok('없는 값은 0으로 세지 않고 센다 — 첫 호출은 캐시 아님', r.ok && r.data.cached === false);
    ok('사용량을 함께 돌려준다', r.ok && r.data.budget && r.data.budget.used_day === 1 && r.data.budget.cap_day === 200, r.data && r.data.budget);

    const before = N.env.fetched.length;
    const r2 = callHandler(N.ctx, 'handleInsightTrend_', null, {
      brand: 'daejeon_youth', months: 12, unit: 'week',
      groups: [{ name: '대전 맛집', keywords: ['대전 맛집'] }]
    });
    ok('같은 요청은 캐시로 돌려준다', r2.ok && r2.data.cached === true);
    eq('캐시면 밖으로 다시 나가지 않는다', N.env.fetched.length, before);
    eq('캐시면 사용량도 안 늘린다', r2.ok && r2.data.budget.used_day, 1);

    const b = callHandler(N.ctx, 'handleInsightBudget_', null, {});
    ok('사용량 액션은 API 를 부르지 않는다', b.ok && N.env.fetched.length === before && b.data.trend.cap_day === 200 && b.data.trend.cap_month === 2000, b.data && b.data.trend);
  }

  /* ── 일·월 천장: 넘으면 호출 0회 ── */
  {
    const N = loadGas();
    N.env.props.set('NAVER_CLIENT_ID', 'test-id');
    N.env.props.set('NAVER_CLIENT_SECRET', 'test-secret');
    const day = N.ctx.insightDayKey_(new N.env.Date());
    N.env.props.set('INSIGHT_TREND_D_' + day, '200');
    const r = callHandler(N.ctx, 'handleInsightTrend_', null, { groups: [{ name: 'a', keywords: ['a'] }] });
    eq('일 천장에 닿으면 ERR_INSIGHT_BUDGET', r.code, 'ERR_INSIGHT_BUDGET');
    ok('천장 메시지에 숫자가 있다', r.ok === false && /200/.test(String(r.message)), r.message);
    eq('천장이면 네이버를 부르지 않는다', N.env.fetched.length, 0);

    const N2 = loadGas();
    N2.env.props.set('NAVER_CLIENT_ID', 'test-id');
    N2.env.props.set('NAVER_CLIENT_SECRET', 'test-secret');
    const day2 = N2.ctx.insightDayKey_(new N2.env.Date());
    const month2 = N2.ctx.insightMonthKey_(new N2.env.Date());
    N2.env.props.set('INSIGHT_TREND_M_' + month2, '2000');
    N2.env.props.set('INSIGHT_TREND_D_' + day2, '3');
    const r2 = callHandler(N2.ctx, 'handleInsightTrend_', null, { groups: [{ name: 'a', keywords: ['a'] }] });
    eq('월 천장에 닿아도 ERR_INSIGHT_BUDGET', r2.code, 'ERR_INSIGHT_BUDGET');
    eq('월 천장이면 호출 0회', N2.env.fetched.length, 0);
  }

  /* ── 401/403 은 키 문제로 알린다(창구 두 곳을 다 본다) ── */
  {
    const N = loadGas();
    N.env.props.set('NAVER_CLIENT_ID', 'bad-id');
    N.env.props.set('NAVER_CLIENT_SECRET', 'bad-secret');
    N.env.setFetchReply({ code: 401, body: JSON.stringify({ error: { errorCode: '401', message: 'Authentication Failed' } }) });
    const r = callHandler(N.ctx, 'handleInsightTrend_', null, { groups: [{ name: 'a', keywords: ['a'] }] });
    eq('401 이면 ERR_NO_NAVER_KEY', r.code, 'ERR_NO_NAVER_KEY');
    eq('자동 모드는 두 창구를 다 시도한다', N.env.fetched.length, 2);
    ok('legacy 는 옛 주소로 간다', /openapi\.naver\.com\/v1\/datalab\/search/.test(N.env.fetched[1].url), N.env.fetched[1].url);
  }

  /* ── 작은 숫자는 판단하지 않는다(상대지수 10 미만) ── */
  {
    const N = loadGas();
    const small = N.ctx.trendSummary_([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map((r, i) => ({ period: 'p' + i, ratio: r })));
    eq('최고점이 한 자리 수면 판단 보류', small.trend, '표본 적음');
    eq('그때는 계절 뱀지도 안 단다', small.season, '');
    const big = N.ctx.trendSummary_([20, 20, 20, 20, 20, 20, 20, 20, 40, 40, 40, 40].map((r, i) => ({ period: 'p' + i, ratio: r })));
    eq('충분히 큰 말은 그대로 판정', big.trend, '오르는 중');
    eq('벼랑 끝 상승이면 성수기', big.season, '성수기');
  }

  /* ── 입력 다듬기: 5묶음·5검색어 ── */
  {
    const N = loadGas();
    const many = [];
    for (let i = 0; i < 8; i++) many.push({ name: 'g' + i, keywords: ['k' + i + 'a', 'k' + i + 'b', 'k' + i + 'c', 'k' + i + 'd', 'k' + i + 'e', 'k' + i + 'f'] });
    const groups = N.ctx.normalizeTrendGroups_({ groups: many });
    eq('주제어는 5묶음까지만', groups.length, 5);
    eq('묶음당 검색어는 5개까지만', groups[0].keywords.length, 5);
    eq('빈 입력은 0묶음', N.ctx.normalizeTrendGroups_({ groups: [{ name: '', keywords: ['a'] }, { name: 'b', keywords: [] }] }).length, 0);
  }
}

console.log('\n[BS] 오늘의 블로그 제목 10 (gas/BlogSeo.gs)');
{
  /* 순수 점수 */
  const N = loadGas();
  eq('표본 적음(최고 10 미만)은 후보에서 빠진다', N.ctx.blogSeoTrendScore_({ peak: 6, delta_pct: 80 }).score, -100);
  eq('표본 없음도 빠진다', N.ctx.blogSeoTrendScore_(null).state, '표본 없음');
  eq('4주 +50% 면 30점', N.ctx.blogSeoTrendScore_({ peak: 100, delta_pct: 50 }).score, 30);
  eq('+20% 면 20점', N.ctx.blogSeoTrendScore_({ peak: 100, delta_pct: 20 }).score, 20);
  eq('−20% 면 −10점', N.ctx.blogSeoTrendScore_({ peak: 100, delta_pct: -20 }).score, -10);
  eq('성수기는 +10', N.ctx.blogSeoTrendScore_({ peak: 100, delta_pct: 20, season: '성수기' }).score, 30);
  eq('문서 4만이면 12점', N.ctx.blogSeoDocScore_(40000), 12);
  eq('문서 150만이면 −8점', N.ctx.blogSeoDocScore_(1500000), -8);
  eq('문서 값이 없으면 0점', N.ctx.blogSeoDocScore_(null), 0);

  /* 선별 */
  const axesAll = () => {
    const c = [];
    const AXES = ev(N.ctx, 'BLOG_SEO_AXES_');
    ['food', 'life', 'store', 'cat'].forEach(a => {
      AXES[a].keywords.slice(0, 4).forEach(k => c.push({ axis: a, keyword: k }));
    });
    return c;
  };
  const trend = {};
  axesAll().forEach((c, i) => { trend[c.keyword] = { peak: 100, delta_pct: (i % 5) * 10, season: i % 3 === 0 ? '성수기' : '' }; });
  const picked = N.ctx.blogSeoPick_({
    day: '2026-11-21', candidates: axesAll(), trend: trend, docs: {},
    mine: { ranks: {}, inflow: [], posts: [], recentTitles: [], pattern: null }
  });
  eq('하루 10개', picked.rows.length, 10);
  const cnt = {};
  picked.rows.forEach(r => { cnt[r.axis] = (cnt[r.axis] || 0) + 1; });
  eq('축 배분 3/3/2/2', JSON.stringify([cnt.food, cnt.life, cnt.store, cnt.cat]), JSON.stringify([3, 3, 2, 2]));
  eq('순위는 1~10', picked.rows.map(r => r.rank).join(','), '1,2,3,4,5,6,7,8,9,10');
  ok('제목은 45자 이내', picked.rows.every(r => r.title.length <= 45), picked.rows.map(r => r.title.length));
  ok('제목이 서로 다르다', new Set(picked.rows.map(r => r.title)).size === 10);
  ok('키워드가 제목에 들어 있다', picked.rows.every(r => r.title.indexOf(r.keyword) >= 0));
  ok('근거 줄에 내 순위/문서 이야기', picked.rows.every(r => /내 |문서 |최근 4주|표본|유입/.test(r.reason)));

  const nextDay = N.ctx.blogSeoPick_({
    day: '2026-11-22', candidates: axesAll(), trend: trend, docs: {},
    mine: { ranks: {}, inflow: [], posts: [], recentTitles: [], pattern: null }
  });
  const sameTitle = picked.rows.filter(r => nextDay.rows.some(x => x.title === r.title && x.keyword === r.keyword)).length;
  ok('날이 바뀌면 제목 각도가 바뀐다', sameTitle <= 5, sameTitle);

  /* 이미 쓴 말 제외 · 순위 방어 예외 */
  const dup = N.ctx.blogSeoPick_({
    day: '2026-11-21',
    candidates: [{ axis: 'food', keyword: '대전 맛집' }, { axis: 'food', keyword: '유성 맛집' }],
    trend: { '대전 맛집': { peak: 100, delta_pct: 60 }, '유성 맛집': { peak: 100, delta_pct: 10 } },
    docs: {},
    mine: { ranks: {}, inflow: [], posts: [], recentTitles: ['[대전 봉명동 맛집] 시험 대전 맛집 후기'], pattern: null }
  });
  ok('이미 쓴 말은 빠진다', dup.rows.every(r => r.keyword !== '대전 맛집'), dup.rows.map(r => r.keyword));
  const defend = N.ctx.blogSeoPick_({
    day: '2026-11-21',
    candidates: [{ axis: 'food', keyword: '대전 맛집' }],
    trend: { '대전 맛집': { peak: 100, delta_pct: 60 } }, docs: {},
    mine: { ranks: { '대전 맛집': 14 }, inflow: [], posts: [], recentTitles: ['대전 맛집 3곳 비교'], pattern: null }
  });
  ok('11~50위 키워드는 리뉴얼 목적으로 남긴다', defend.rows.length === 1 && defend.rows[0].my_rank === 14, defend.rows);

  /* 후보 돌리기 */
  const cand = N.ctx.blogSeoCandidates_('2026-11-21');
  eq('후보는 축 배분+2씩(18)', cand.length, 18);
  const cand2 = N.ctx.blogSeoCandidates_('2026-11-22');
  ok('다음 날은 다른 키워드부터 본다', cand[0].keyword !== cand2[0].keyword, cand[0].keyword + ' / ' + cand2[0].keyword);

  /* 액션 끝까지 — 가짜 시트·가짜 네트워크 */
  const P = loadGas();
  const ss = new FakeSS();
  const calls = [];
  P.ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ss };
  P.ctx.UrlFetchApp = { fetch: (url, opts) => {
    calls.push({ url, opts });
    if (String(url).indexOf('search-trend') >= 0 || String(url).indexOf('datalab/search') >= 0) {
      const body = JSON.parse(opts.payload);
      const results = body.keywordGroups.map((g, i) => ({
        title: g.groupName, keywords: g.keywords,
        data: [20, 24, 30, 38, 10, 12, 14, 16, 40, 44, 48, 52].map((r, n) => ({ period: 'p' + n, ratio: r + i }))
      }));
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ results: results }) };
    }
    if (String(url).indexOf('search') >= 0) {
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ total: 120000, items: [] }) };
    }
    return { getResponseCode: () => 404, getContentText: () => '' };
  } };
  P.env.props.set('NAVER_CLIENT_ID', 'test-id');
  P.env.props.set('NAVER_CLIENT_SECRET', 'test-secret');
  P.env.props.set('NAVER_API_MODE', 'hub');

  const run1 = callHandler(P.ctx, 'handleBlogSeoTitles_', ss, { brand: 'daejeon_youth' }, { brand: 'daejeon_youth' });
  ok('액션은 10줄을 준다', run1.ok && run1.data.count === 10, run1.code || (run1.data && run1.data.count));
  eq('처음에는 cached=false', run1.ok && run1.data.cached, false);
  ok('응답에 축별 뼈대가 있다', run1.ok && run1.data.axes && run1.data.axes.food.skeleton.length >= 3);
  ok('절대 검색량이 아니라는 문구', run1.ok && /상대지수/.test(run1.data.note));
  ok('시트에 10줄을 쌓는다(헤더 포함)', ss.getSheetByName('Blog_Seo_Titles') && ss.getSheetByName('Blog_Seo_Titles').getLastRow() === 11, ss.getSheetByName('Blog_Seo_Titles') && ss.getSheetByName('Blog_Seo_Titles').getLastRow());
  const trendCalls = calls.filter(c => String(c.url).indexOf('search-trend') >= 0 || String(c.url).indexOf('datalab/search') >= 0).length;
  eq('데이터랩은 5개씩 묶어 4회만 부른다', trendCalls, 4);
  const calledBefore = calls.length;
  const run2 = callHandler(P.ctx, 'handleBlogSeoTitles_', ss, { brand: 'daejeon_youth' }, { brand: 'daejeon_youth' });
  ok('같은 날 두 번째는 저장된 줄(cached=true)', run2.ok && run2.data.cached === true, run2.data && run2.data.cached);
  eq('두 번째는 네트워크를 부르지 않는다', calls.length, calledBefore);
  ok('저장된 줄과 같은 제목', run2.ok && run2.data.rows[0].title === run1.data.rows[0].title);
  eq('같은 날을 다시 만들어도 10줄(중복 없음)', (function () {
    callHandler(P.ctx, 'handleBlogSeoTitles_', ss, { brand: 'daejeon_youth', refresh: true }, { brand: 'daejeon_youth' });
    return ss.getSheetByName('Blog_Seo_Titles').getLastRow();
  })(), 11);

  /* 표본 적음은 뒤로 · 같은 축은 각도를 바꾼다 */
  {
    const cands = [
      { axis: 'food', keyword: '대전 맛집' }, { axis: 'food', keyword: '유성 맛집' },
      { axis: 'life', keyword: '대전 청년 정책' }, { axis: 'store', keyword: '무재고 부업' },
      { axis: 'cat', keyword: '고양이 모래' }
    ];
    const tr = {
      '대전 맛집': { peak: 100, delta_pct: 30 }, '유성 맛집': { peak: 100, delta_pct: 25 },
      '대전 청년 정책': { peak: 100, delta_pct: 20 }, '무재고 부업': { peak: 4, delta_pct: 90 },
      '고양이 모래': { peak: 100, delta_pct: 10 }
    };
    const out = N.ctx.blogSeoPick_({ day: '2026-11-21', candidates: cands, trend: tr, docs: {}, mine: { ranks: {}, inflow: [], posts: [], recentTitles: [], pattern: null } });
    ok('표본 적음 후보는 뒤로 밀린다', out.rows.every((r, n) => r.trend_state !== '표본 적음' || n === out.rows.length - 1), out.rows.map(r => r.trend_state));
    const food = out.rows.filter(r => r.axis === 'food');
    ok('같은 축 두 줄은 각도가 다르다', food.length === 2 && food[0].title !== food[1].title, food.map(r => r.title));
    const catSix = N.ctx.blogSeoPick_({
      day: '2026-11-21',
      candidates: ev(N.ctx, 'BLOG_SEO_AXES_').cat.keywords.slice(0, 4).map(k => ({ axis: 'cat', keyword: k })),
      trend: ev(N.ctx, 'BLOG_SEO_AXES_').cat.keywords.slice(0, 4).reduce((o, k, n) => { o[k] = { peak: 100, delta_pct: 40 - n * 5 }; return o; }, {}),
      docs: {}, mine: { ranks: {}, inflow: [], posts: [], recentTitles: [], pattern: null }
    });
    const catTitles = catSix.rows.map(r => r.title.replace(r.keyword, '{kw}'));
    ok('한 축에서 각도가 겹치지 않는다', new Set(catTitles).size === catTitles.length, catTitles);
    ok('순위가 없으면 "내 글 없음"을 쓰지 않는다', out.rows.every(r => r.reason.indexOf('내 글 없음') < 0), out.rows[0].reason);
  }

  /* 시트가 날짜를 Date 로 돌려줘도 '오늘 줄'을 찾는다(두 번째 호출이 계산을 다시 하지 않게) */
  {
    const sh = ss.getSheetByName('Blog_Seo_Titles');
    if (sh) sh.rows[1][0] = new Date('2026-11-21T00:00:00+09:00');
    const before = calls.length;
    const again = callHandler(P.ctx, 'handleBlogSeoTitles_', ss, { brand: 'daejeon_youth' }, { brand: 'daejeon_youth' });
    ok('날짜 칸이 Date 여도 저장된 줄을 쓴다', again.ok && again.data.cached === true, again.data && again.data.cached);
    eq('그때는 네트워크를 부르지 않는다', calls.length, before);
  }

  /* 시트에 같은 줄이 겹쳐 쌓여도 화면은 10줄 */
  {
    const sh = ss.getSheetByName('Blog_Seo_Titles');
    const first = sh.rows[1].slice();
    sh.rows.push(first.slice(), first.slice());
    const dup = callHandler(P.ctx, 'handleBlogSeoTitles_', ss, { brand: 'daejeon_youth' }, { brand: 'daejeon_youth' });
    ok('겹쳐 쌓인 줄은 한 번만 돌려준다(최대 10)', dup.ok && dup.data.count <= 10, dup.data && dup.data.count);
    const titles = (dup.data.rows || []).map(r => r.title + '|' + r.keyword);
    ok('같은 제목이 두 번 나오지 않는다', new Set(titles).size === titles.length, titles);
  }

  const meli = callHandler(P.ctx, 'handleBlogSeoTitles_', ss, { brand: 'ppiyak_kimmary' }, { brand: 'ppiyak_kimmary' });
  ok('메리 트랙은 블로그를 쓰지 않는다고 알린다', meli.ok && meli.data.count === 0 && /블로그를 쓰지/.test(meli.data.fallback), meli.data && meli.data.fallback);
}

console.log('\n' + (failed ? '❌ 실패 ' + failed + '건 / 통과 ' + passed + '건' : '✅ 전부 통과 ' + passed + '건'));
process.exit(failed ? 1 : 0);
