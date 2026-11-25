#!/usr/bin/env node
// tools/blog_style_cli.mjs — 성래 님 블로그 스타일 DNA CLI (2026-11-25, #50347)
//
// 웹앱(#/create/blog)과 **같은 모듈**(js/blogStyle.js)을 쓴다 — 규칙을 두 곳에 쓰지 않는다.
//
// 사용
//   node tools/blog_style_cli.mjs skeleton 재료.json            # 뼈대 → 붙여넣기 본문
//   node tools/blog_style_cli.mjs skeleton 재료.json --out 본문.md
//   node tools/blog_style_cli.mjs lint 본문.md --kind place --photo 7
//   node tools/blog_style_cli.mjs seed                          # seeds/blog_style_dna_2026w48.json 재생성
//   node tools/blog_style_cli.mjs sample                        # 내장 예시로 자체 점검
//
// 재료.json
//   { "place": {"name":"미미삼겹"}, "content": {"memo":"...","region_dong":"봉명동", ...},
//     "concept": {"kind":"review"}, "photos": [{"name":"a.jpg","role":"외관"}],
//     "links": [{"title":"석암 솔직후기","url":"https://..."}], "self": "Lv.2 빚 있는 청년 카푸어" }
//
// 종료 코드: 0 = 성공, 1 = 린터 경고 있음, 2 = 입력·파일 오류
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STYLE_DNA, buildStyleSkeleton, renderStyleSkeleton, lintVoice, stylePromptLines, slotsOf
} from '../js/blogStyle.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'seeds', 'blog_style_dna_2026w48.json');

const argv = process.argv.slice(2);
const cmd = argv[0] || '';
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const die = (msg) => { console.error('✗ ' + msg); process.exit(2); };

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { die('JSON 을 읽지 못했습니다: ' + p + ' — ' + e.message); }
}

if (cmd === 'seed') {
  fs.writeFileSync(SEED, JSON.stringify(STYLE_DNA, null, 2) + '\n', 'utf8');
  console.log('✓ ' + path.relative(ROOT, SEED) + ' — ' + Object.keys(STYLE_DNA).length + '키');
  process.exit(0);
}

if (cmd === 'skeleton') {
  const src = argv[1];
  if (!src) die('재료 JSON 경로가 필요합니다');
  const materials = readJson(src);
  const bp = buildStyleSkeleton({
    materials: materials,
    links: materials.links || [],
    kind: arg('kind', ''),
    self: arg('self', materials.self || ''),
    topic: arg('topic', materials.topic || '')
  });
  const text = renderStyleSkeleton(bp);
  const lint = lintVoice(text, { kind: bp.kind, photoCount: (bp.photos || []).length });
  const out = arg('out', '');
  if (out) fs.writeFileSync(out, text, 'utf8');
  if (argv.indexOf('--json') >= 0) {
    console.log(JSON.stringify({ kind: bp.kind, text: text, slots: bp.slots, lint: lint }, null, 2));
  } else {
    process.stdout.write(text);
    console.log('\n── 점수 ' + lint.score + ' · ' + lint.summary);
    if ((bp.slots || []).length) console.log('   채울 자리: ' + bp.slots.join(' / '));
    if (out) console.log('   저장: ' + out);
  }
  process.exit(lint.warns.length ? 1 : 0);
}

if (cmd === 'lint') {
  const p = argv[1];
  if (!p) die('본문 파일 경로가 필요합니다');
  const text = p === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(p, 'utf8');
  const lint = lintVoice(text, { kind: arg('kind', 'place'), photoCount: Number(arg('photo', '0')) || 0 });
  if (argv.indexOf('--json') >= 0) console.log(JSON.stringify(lint, null, 2));
  else {
    lint.items.forEach((it) => console.log((it.state === 'pass' ? '✓' : it.state === 'near' ? '·' : '✗') + ' ' + it.label + ' — ' + (it.value || '') + (it.state === 'pass' ? '' : '  → ' + it.fix)));
    console.log('\n점수 ' + lint.score + ' / 100 · ' + lint.summary);
  }
  process.exit(lint.warns.length ? 1 : 0);
}

if (cmd === 'prompt') {
  console.log(stylePromptLines(arg('kind', 'place')).join('\n'));
  process.exit(0);
}

if (cmd === 'sample') {
  const materials = {
    place: { name: '진미오겹살' },
    content: {
      memo: [
        '안녕하세요, 대전 청년입니다.',
        '이번엔 집게를 한 번도 안 들고 고기를 먹은 이야기입니다.',
        '괴정동에서 고기 먹을 데 찾다가 지인이 보내준 사진 한 장에 낚였습니다.',
        '📍 진미오겹살 본점',
        '고기를 다 구워준다고 해서 반신반의하고 갔습니다.',
        '사장님이 테이블마다 돌면서 구워주십니다.',
        '📍 폭탄 계란찜',
        '이건 밥이 아니라 술 안주입니다.',
        '불판 옆에서 부풀어 오르는 걸 보고 있으면 소주를 부르게 됩니다.',
        '고기가 얇지 않고 두툼해서 씹는 맛이 있습니다.',
        '지하 2시간 무료주차라 차 가져가도 됩니다.'
      ].join('\n\n'),
      region_dong: '괴정동', category: '고기집', hours: '매일 15:00~24:00',
      price_menu: '삼겹살 180g 16,000원 · 계란찜 2,000원', parking: '건물 지하 2시간 무료',
      tel: '042-000-0000', address: '대전 서구 용문로 41-80'
    },
    concept: { kind: 'review' },
    photos: [
      { name: 'A_외관.jpg', role: '외관' }, { name: 'B_메뉴판.jpg', role: '메뉴판' },
      { name: 'C_고기.jpg', role: '음식' }, { name: 'D_계란찜.jpg', role: '음식' },
      { name: 'E_한상.jpg', role: '분위기' }
    ],
    links: [{ title: '석암생소금구이 야장 솔직후기', url: 'https://blog.naver.com/youth-daejeon/224459297302' }]
  };
  const bp = buildStyleSkeleton({ materials: materials, links: materials.links || [] });
  const text = renderStyleSkeleton(bp);
  const lint = lintVoice(text, { kind: bp.kind, photoCount: bp.photos.length });
  process.stdout.write(text);
  console.log('── 점수 ' + lint.score + ' · ' + lint.summary);
  console.log('   남은 자리: ' + slotsOf(text).join(' / '));
  process.exit(0);
}

console.log('사용: node tools/blog_style_cli.mjs {skeleton|lint|prompt|seed|sample} ...');
process.exit(2);
