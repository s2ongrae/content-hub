/**
 * tools/patch_v6.js — 2026-11-17 화면 개편(6단계 상태 + 작성본 미리보기) 적용 스크립트
 *
 * 하는 일 (모두 되돌리기 쉬운 문자열 치환, 두 번 돌려도 안전):
 *   1) js/app.js        — 상태 라벨·칸반 6단계·'사람 손 필요' 띠·'작성본' 탭 연결
 *   2) js/quickApprove  — 승인 카드에 본문 첫 3줄 미리보기
 *   3) js/api.js        — 반려(quickReject)는 '수정 중'으로 보낸다
 *   4) index.html       — 캐시 버전 올리기(app.js m2-18, style.css m2-12)
 * js/draftView.js 와 css/style.css 는 이 스크립트가 아니라 브랜치에서 받아 온다.
 *
 * 실행: node tools/patch_v6.js   → PATCHED <파일들> / ALREADY
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const report = [];
let anyChange = false;

function patch(rel, reps) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.log('NO_FILE: ' + rel);
    process.exit(2);
  }
  let s = fs.readFileSync(file, 'utf8');
  let changedHere = false;
  reps.forEach(([from, to]) => {
    if (s.indexOf(to) >= 0) return;                       // 이미 반영됨
    if (s.indexOf(from) < 0) {
      console.log('NO_MATCH in ' + rel + ': ' + from.split('\n')[0].slice(0, 80));
      process.exit(2);
    }
    s = s.replace(from, to);
    changedHere = true;
  });
  if (!changedHere) return false;
  fs.writeFileSync(file, s);
  report.push(rel);
  anyChange = true;
  return true;
}

/* ── 1) js/app.js ─────────────────────────────────────────── */
patch('js/app.js', [
  [`const STATUS_LABEL = {
  DRAFT: '초안', GENERATING: '작성 중', REVIEW: '확인 중', READY: '올릴 준비',
  PUBLISHING: '올리는 중', PUBLISHED: '일부 올라감', LINKED: '발행 끝',
  NEEDS_HUMAN: '확인 필요', PARTIAL_FAIL: '일부 실패',`,
`const STATUS_LABEL = {
  DRAFT: '초안', DRAFTING: '작성 중', GENERATING: '작성 중', REVIEW: '확인 대기',
  EDITING: '수정 중', READY: '발행 대기', PUBLISHING: '올리는 중', PUBLISHED: '발행 완료',
  LINKED: '최종', NEEDS_HUMAN: '막힘', PARTIAL_FAIL: '일부 실패',`],

  [`const COLUMNS = [
  { key: 'draft', title: '글감 · 초안', statuses: ['DRAFT', 'GENERATING'], hint: '메모만 적어 둔 단계' },
  { key: 'review', title: '내용 확인', statuses: ['REVIEW'], hint: '글·대본 읽어 보는 단계' },
  { key: 'ready', title: '올릴 준비', statuses: ['READY'], hint: '확인 끝, 곧 올라갈 차례' },
  { key: 'publishing', title: '일부만 올라감', statuses: ['PUBLISHING', 'PUBLISHED'], hint: '블로그↔숏폼 서로 연결 대기' },
  { key: 'linked', title: '발행 끝', statuses: ['LINKED'], hint: '업로드·연결 모두 완료' },
  { key: 'human', title: '내가 봐야 함', statuses: ['NEEDS_HUMAN', 'PARTIAL_FAIL'], hint: '로그인·인증·오류를 직접 풀어요', alert: true }
];`,
`const COLUMNS = [
  { key: 'draft', title: '초안', statuses: ['DRAFT'], hint: '글감만 적어 둔 칸' },
  { key: 'writing', title: '작성 중', statuses: ['DRAFTING', 'GENERATING'], hint: '본문·대본을 쓰는 중' },
  { key: 'review', title: '확인 대기', statuses: ['REVIEW'], hint: '다 써서 내가 읽고 승인할 차례' },
  { key: 'editing', title: '수정 중', statuses: ['EDITING'], hint: '고칠 점을 반영하는 중' },
  { key: 'publishing', title: '발행 완료', statuses: ['READY', 'PUBLISHING', 'PUBLISHED'], hint: '올라감 · 역링크(고정댓글)까지 달면 최종' },
  { key: 'linked', title: '최종', statuses: ['LINKED'], hint: '업로드·역링크까지 끝' }
];`],

  [`  const boardHost = h('div', { class: 'board', id: 'board' });
  main.appendChild(boardHost);
  paintBoard();`,
`  /* 사람 손 필요 — 단계가 아니라 '막힘'이라 칸에 넣지 않고 보드 위에 모은다 */
  const humanItems = () => state.contents.filter((c) => c.status === 'NEEDS_HUMAN' || c.status === 'PARTIAL_FAIL');
  const strip = h('div', { class: 'human-strip', hidden: !humanItems().length });
  const paintHuman = () => {
    const items = humanItems();
    strip.hidden = !items.length;
    clear(strip);
    if (!items.length) return;
    strip.appendChild(h('div', { class: 'hs-head' },
      h('span', { text: '🙋 사람 손 필요 ' + items.length + '건' }),
      h('span', { style: 'font-weight:400', text: '로그인·인증·오류로 막힌 카드 — 단계가 아니라 예외라서 칸 밖에 모았어요' })));
    const list = h('div', { class: 'hs-list' });
    items.forEach((item) => list.appendChild(contentCard(item)));
    strip.appendChild(list);
  };
  main.appendChild(strip);
  paintHuman();

  const boardHost = h('div', { class: 'board', id: 'board' });
  main.appendChild(boardHost);
  paintBoard();`],

  [`    host.appendChild(banner('danger', '🙋', \`사람 대기 \${state.contents.filter((c) => c.status === 'NEEDS_HUMAN').length}건\`,
      '캡차·2FA·로그인 만료는 자동으로 처리하지 않습니다. 직접 처리한 뒤 보드에서 상태를 바꾸세요.'));`,
`    host.appendChild(banner('danger', '🙋', \`사람 손 필요 \${state.contents.filter((c) => c.status === 'NEEDS_HUMAN').length}건\`,
      '캡차·2FA·로그인 만료는 자동으로 처리하지 않습니다. 카드를 열어 "막힘 풀기"를 누르면 원래 단계로 돌아갑니다.'));`],

  [`      { k: '내가 봐야 함', v: sh ? sh.needs_human.count`,
`      { k: '막힘 · 사람 손 필요', v: sh ? sh.needs_human.count`],

  [`import { renderSeriesView } from './seriesView.js';

/* ────────────────────────── 상수 ────────────────────────── */`,
`import { renderSeriesView } from './seriesView.js';
import { draftSection } from './draftView.js';

/* ────────────────────────── 상수 ────────────────────────── */`],

  [`    let tab = opts === 'src' ? 'src' : 'ana';`,
`    const openOnDraft = ['DRAFT', 'DRAFTING', 'GENERATING', 'REVIEW', 'EDITING'].indexOf(d.status) >= 0;
    let tab = opts === 'src' ? 'src' : (openOnDraft ? 'draft' : 'ana');`],

  [`      [['ana', '분석'], ['src', '원문·메타']].forEach((pair) => {`,
`      [['draft', '작성본'], ['ana', '분석'], ['src', '원문·메타']].forEach((pair) => {`],

  [`      body.appendChild(tab === 'ana'
        ? analysisSection(contentId, d, m, payload, dlg)
        : sourceSection(contentId, d, m, payload, dlg));`,
`      if (tab === 'draft') {
        body.appendChild(draftSection({ h, detail: d, meta: m, toast, onChanged: () => { refresh().then(renderRoute); } }));
      } else {
        body.appendChild(tab === 'ana'
          ? analysisSection(contentId, d, m, payload, dlg)
          : sourceSection(contentId, d, m, payload, dlg));
      }`]
]);

/* ── 2) js/quickApprove.js ────────────────────────────────── */
patch('js/quickApprove.js', [
  [`      this.items = (res.data && res.data.items) || [];
      this.index = 0;
      this.render();
    } catch (err) {`,
`      this.items = (res.data && res.data.items) || [];
      this.index = 0;
      this.render();
      this.prefetchPreview();
    } catch (err) {`],

  [`  current() {
    return this.items[this.index];
  }`,
`  current() {
    return this.items[this.index];
  }

  /* 첫 3장만 상세를 읽어 본문 첫 3줄·키워드를 카드에 붙인다(실패해도 승인은 그대로).
     카드 1장 = 호출 1회(30초 타임아웃), 승인 대기 1~3장에서는 체감 지연이 없다. */
  async prefetchPreview() {
    let changed = false;
    await Promise.all(this.items.slice(0, 3).map(async (item) => {
      try {
        const res = await api.getContentDetail(item.content_id);
        const p = (res.data && res.data.payload) || {};
        const d = p.blog || p.shorts || p.reels || p.clip || p.ig_feed;
        const body = d && d.body ? String(d.body) : '';
        if (!body) return;
        const lines = body.split(/\\n+/).map((t) => t.trim()).filter(Boolean);
        item.preview = {
          hook: lines.slice(0, 3).join(' ').slice(0, 180),
          facts: item.target_keywords ? [item.target_keywords] : []
        };
        changed = true;
      } catch (e) { /* 미리보기 없이도 승인은 된다 */ }
    }));
    if (changed && this.root.isConnected) this.render();
  }`]
]);

/* ── 3) js/api.js — 반려는 '수정 중'으로 ───────────────────── */
patch('js/api.js', [
  [`      status: 'REVIEW',
      patch: {
        reject_reason: reason || '대표님 반려',
        rejected_at: new Date().toISOString()
      }`,
`      status: 'EDITING',
      patch: {
        reject_reason: reason || '대표님 반려',
        rejected_at: new Date().toISOString(),
        prev_status: 'REVIEW'
      }`]
]);

/* ── 4) index.html — 캐시 버전 ─────────────────────────────── */
patch('index.html', [
  ['js/app.js?v=m2-17', 'js/app.js?v=m2-18'],
  ['css/style.css?v=m2-11', 'css/style.css?v=m2-12']
]);

/* ── 5) css/style.css — '작성본' 탭·'사람 손 필요' 띠 스타일 ─────────── */
const CSS_V6 = `
.badge.DRAFTING { background: rgba(87, 182, 255, .14); color: var(--info); border-color: rgba(87, 182, 255, .35); }
.badge.EDITING { background: rgba(255, 194, 71, .16); color: #ffd98a; border-color: rgba(255, 194, 71, .4); }

.human-strip { border: 1px solid rgba(255, 93, 108, .35); background: rgba(255, 93, 108, .07); border-radius: 12px; padding: 10px; margin: 0 0 12px; }
.human-strip .hs-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: var(--danger); margin-bottom: 8px; }
.human-strip .hs-list { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
.human-strip .ccard { min-width: 240px; max-width: 300px; flex: 0 0 auto; }

.draft-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.draft-chip { height: 26px; padding: 0 9px; border-radius: 999px; border: 1px solid var(--line-soft); background: var(--bg-soft); color: var(--tx-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.draft-chip.on { border-color: var(--info); color: var(--info); background: rgba(87, 182, 255, .12); }
.draft-chip.off { opacity: .55; }
.draft-view { border: 1px solid var(--line-soft); border-radius: 10px; padding: 12px; }
.draft-title { font-size: 15px; font-weight: 700; line-height: 1.4; color: var(--tx); }
.draft-meta { font-size: 11px; color: var(--tx-3); margin: 4px 0 10px; }
.draft-body { font-size: 13.5px; line-height: 1.75; color: var(--tx-2); }
.draft-body p { margin: 0 0 10px; white-space: pre-wrap; }
.draft-tags { font-size: 12px; color: var(--info); margin: 8px 0 0; }
.draft-empty { font-size: 13px; font-weight: 700; color: var(--tx-2); margin: 0 0 4px; }
.draft-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.draft-acts .btn { margin: 0; }
.draft-edit { margin-top: 10px; }
.draft-edit .field { margin: 0 0 8px; }
.draft-edit textarea { width: 100%; font-family: inherit; font-size: 13px; line-height: 1.6; }

`;
const cssPath = path.join(root, 'css/style.css');
let cssSrc = fs.readFileSync(cssPath, 'utf8');
if (cssSrc.indexOf('/* v6-draft */') < 0) {
  fs.writeFileSync(cssPath, cssSrc + '\n/* v6-draft */\n' + CSS_V6);
  report.push('css/style.css');
  anyChange = true;
}

/* ── 문법 검사 (수정한 JS 만) ──────────────────────────────── */
const jsFiles = report.filter((f) => f.endsWith('.js'));
jsFiles.forEach((rel) => {
  const src = path.join(root, rel);
  const tmp = path.join(root, '.syntax-check.mjs');
  fs.writeFileSync(tmp, fs.readFileSync(src));
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  if (r.status !== 0) {
    console.log('SYNTAX_FAIL: ' + rel + '\n' + (r.stderr || '').split('\n').slice(0, 4).join('\n'));
    process.exit(3);
  }
});

if (!anyChange) console.log('ALREADY');
else console.log('PATCHED ' + report.join(' '));
