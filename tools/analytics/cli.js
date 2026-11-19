#!/usr/bin/env node
'use strict';
/**
 * tools/analytics/cli.js — 유튜브·인스타 지표 수집 실행기
 *
 * 사용
 *   node tools/analytics/cli.js --config tools/analytics/config.json            # 계획만(dry-run 이 기본)
 *   node tools/analytics/cli.js --config … --live                               # 실제 수집 + 보고서 파일
 *   node tools/analytics/cli.js --config … --live --push                        # GAS ingest_analytics 로 적재
 *   node tools/analytics/cli.js --config … --live --push --source youtube
 *
 * 환경변수(시크릿은 여기로만 들어온다 — 파일·인자로 넘기지 않는다)
 *   YOUTUBE_API_KEY, YOUTUBE_OAUTH_TOKEN(선택), IG_ACCESS_TOKEN, IG_TOKEN_EXPIRES_AT(선택),
 *   GAS_WEBAPP_URL, GAS_API_TOKEN
 *   트랙별 인스타 토큰: config 의 tracks[].instagram.token_env 에 이름을 적으면 그 환경변수를 쓴다
 *   (예: track_b → IG_ACCESS_TOKEN_MERRY). 페이지 토큰은 자기 페이지·IG 만 읽기 때문.
 *
 * 종료코드: 0 성공 / 1 수집 자체가 실패 / 2 설정 오류
 */

const fs = require('fs');
const path = require('path');
const { runSync, toGasPayload, pushToGas } = require('./lib/sync');

function parseArgs(argv) {
  const out = { live: false, push: false, source: '', config: '', out: '', quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') out.config = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--source') out.source = argv[++i];
    else if (a === '--live') out.live = true;
    else if (a === '--push') out.push = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function loadConfig(file) {
  if (!file) return null;
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) throw new Error('설정 파일이 없습니다: ' + file);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function envOf() {
  const e = process.env;
  return {
    youtubeApiKey: e.YOUTUBE_API_KEY || '',
    youtubeOAuthToken: e.YOUTUBE_OAUTH_TOKEN || '',
    igAccessToken: e.IG_ACCESS_TOKEN || '',
    igTokens: { IG_ACCESS_TOKEN_MERRY: e.IG_ACCESS_TOKEN_MERRY || '' },
    igTokenExpiresAt: e.IG_TOKEN_EXPIRES_AT || '',
    gasUrl: e.GAS_WEBAPP_URL || '',
    gasToken: e.GAS_API_TOKEN || ''
  };
}

function summaryLines(report, pushed) {
  const L = [];
  L.push('# 유튜브·인스타 지표 수집 — ' + report.collected_date + ' (' + report.mode + ')');
  L.push('');
  L.push('- 행: ' + report.stats.rows + ' (유튜브 ' + report.stats.youtube + ' · 인스타 ' + report.stats.instagram + ' / 카드 미연결 ' + report.stats.unmapped + ')');
  report.notices.forEach((n) => L.push('- [' + n.level + '] ' + n.message));
  report.errors.forEach((e) => L.push('- [error] ' + e.source + ' · ' + e.code + ' · ' + e.message + (e.reason ? ' (' + e.reason + ')' : '')));
  if (pushed && pushed.length) {
    const okCount = pushed.filter((p) => p.ok).length;
    L.push('- GAS 적재: ' + okCount + '/' + pushed.length + ' 묶음 성공');
  }
  return L;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('node tools/analytics/cli.js --config <file> [--live] [--push] [--source youtube|instagram] [--out file]');
    return 0;
  }
  let config;
  try {
    config = loadConfig(args.config || 'tools/analytics/config.json');
  } catch (err) {
    console.error('✗ ' + err.message);
    return 2;
  }
  if (!config) { console.error('✗ --config 가 필요합니다.'); return 2; }

  const env = envOf();
  const sources = args.source ? [args.source] : ['youtube', 'instagram'];

  if (!args.live) {
    const dry = await runSync({ config, env: {}, sources, now: new Date() });
    console.log(summaryLines(dry).join('\n'));
    console.log('\n(계획 모드) 실제 수집은 --live 로 실행합니다. 키가 없으면 --live 도 계획만 냅니다.');
    return 0;
  }

  const report = await runSync({ config, env, sources, now: new Date() });
  let pushed = [];
  if (args.push && report.rows.length) {
    if (!env.gasUrl || !env.gasToken) {
      report.notices.push({ level: 'warn', code: 'GAS_SKIPPED', message: 'GAS 주소·토큰이 없어 적재를 건너뜁니다(보고서 파일만 남깁니다).' });
    } else {
      pushed = await pushToGas(toGasPayload(report.rows), { url: env.gasUrl, token: env.gasToken });
      const fail = pushed.filter((p) => !p.ok);
      fail.forEach((p) => report.errors.push({ source: 'gas', code: 'ERR_PUSH', message: '적재 실패: ' + p.key, reason: (p.error && p.error.code) || (p.body && p.body.error && p.body.error.code) || '' }));
    }
  }

  const outFile = args.out || path.join('tools', 'analytics', 'out', 'report-' + report.collected_date + '.json');
  const outPath = path.resolve(process.cwd(), outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(Object.assign({}, report, { pushed }), null, 2), 'utf8');

  const lines = summaryLines(report, pushed);
  console.log(lines.join('\n'));
  console.log('\n보고서: ' + outFile);

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    try { fs.appendFileSync(summaryFile, lines.join('\n') + '\n'); } catch (e) { /* 요약 실패는 결과를 바꾸지 않는다 */ }
  }

  const hardFail = report.errors.some((e) => e.source === 'youtube' || e.source === 'instagram');
  return hardFail && !report.rows.length ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('✗ ' + ((err && err.message) || err));
  process.exit(1);
});
