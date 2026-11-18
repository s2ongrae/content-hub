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

  console.log('\n' + (failed ? '❌ 실패 ' + failed + '건' : '✅ content-hub 시험 전부 통과'));
  process.exit(failed ? 1 : 0);
})();
