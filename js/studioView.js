/**
 * js/studioView.js — 숏폼 공방 (연재 탭 하위 화면)
 *
 * 무료 MIT 스킬(Jakeschincariol/youtube-agent-skill)의 도구를 브라우저에서 그대로 돌린다.
 *   ① 훅 채점(21공식·5속성) ② 당근 스타일 대본 뼈대(타임코드+ON SCREEN) ③ 제목·썸네일 한 쌍 린터
 *   ④ 컷편집 리스트(DEAD·FILLER·REPEAT) ⑤ 댓글 4분류+답장 초안 ⑥ 채널 중위수 대비 바이럴 배수
 * 전부 이 브라우저에서 계산한다. 서버·API 키·토큰이 필요 없다.
 *
 * 원칙: 값은 지어내지 않는다. 확인 못 한 숫자는 [채우기]로 남기고, 화면에도 그렇게 적는다.
 * 렌더링은 textContent/createElement만(내부 원칙 동일).
 */

import { loadFormulas, rankHooks, band } from './yt/hookscore.js';
import { lintPackage } from './yt/titlelint.js';
import { buildEDL, edlToText } from './yt/edl.js?v=20261126c';
import { analyze, parseRows } from './yt/viral.js';
import { loadPreset, pickPreset, buildScript, scriptToText } from './yt/preset.js';
import { api } from './api.js';
import { loadTriage, classifyComments, draftReply, pickPin } from './yt/comments.js';
import { copyText } from './clipboard.js?v=20261126a';

const mem = {
  hooks: [],
  script: null,
  edl: null,
  pkg: null,
  comment: null,
  viral: null,
  openPreset: false
};

function panel(h, title, sub) {
  return h('div', { class: 'panel' }, h('h3', null, title), sub ? h('p', { class: 'hint', text: sub }) : null);
}

function meter(h, value, label) {
  const wrap = h('div', { class: 'meter', title: `${label} ${value}` },
    h('div', { class: 'meter-fill', style: `width:${Math.max(2, value)}%`, 'data-band': band(value) }));
  return wrap;
}

export function renderStudio(host, ctx) {
  const { h, toast, state } = ctx;
  const brand = state.brand;
  const brandNote = brand === 'ppiyak_kimmary'
    ? '메리 트랙: 무내레이션 15초 프리셋 · 나눔스퀘어라운드 64px(1080폭 기준) · 상단 배지 없이 하단 안전영역만.'
    : '대전 청년: 25초 정보형 프리셋 · Pretendard 68px(1080폭 기준) · 상단 훅 뱃지 + 하단 안전선(높이의 73.9%).';

  host.replaceChildren();
  host.appendChild(h('div', { class: 'panel' },
    h('h3', null, '🎬 숏폼 작업실'),
    h('p', { class: 'hint', text: '유료 툴 없이, 무료 공개 스킬(MIT)의 채점·점검 로직을 이 화면에서 바로 돌립니다. 여기서 나온 대본·컷 리스트·제목·댓글 답장은 복사해서 그대로 쓰고, 발행은 직접 합니다.' }),
    h('p', { class: 'hint', text: brandNote })));

  const presetSlot = h('div', { class: 'studio-slot' });
  const hookSlot = h('div', { class: 'studio-slot' });
  const scriptSlot = h('div', { class: 'studio-slot' });
  const pkgSlot = h('div', { class: 'studio-slot' });
  const edlSlot = h('div', { class: 'studio-slot' });
  const commentSlot = h('div', { class: 'studio-slot' });
  const viralSlot = h('div', { class: 'studio-slot' });
  [presetSlot, hookSlot, scriptSlot, pkgSlot, edlSlot, commentSlot, viralSlot].forEach((el) => host.appendChild(el));
  host.appendChild(h('p', { class: 'hint studio-foot', text: '출처: Jakeschincariol/youtube-agent-skill (MIT, 무료·가입 없음) 11개 스킬 · 당근 스토리 숏폼 관찰(2026-11-18) · 이 저장소 seeds/skills/. 규칙은 seeds/skills/*.json 에 있고 화면은 그것을 읽기만 합니다.' }));

  // ── 공통 데이터 로드
  Promise.all([loadFormulas(), loadPreset(), loadTriage()]).then(([formulas, presetRaw, triage]) => {
    const preset = pickPreset(presetRaw, brand);
    ctx._formulas = formulas;
    ctx._preset = preset;
    ctx._presetRaw = presetRaw;
    ctx._triage = triage;
    paintPreset(presetSlot, preset, h, brand, triage);
    paintHooks(hookSlot, formulas, ctx);
    paintScript(scriptSlot, presetRaw, ctx);
    paintPackage(pkgSlot, ctx);
    paintEDL(edlSlot, preset, ctx);
    paintComments(commentSlot, triage, ctx);
    paintViral(viralSlot, ctx);
  }).catch((err) => {
    presetSlot.appendChild(h('div', { class: 'panel' },
      h('h3', null, '공방 데이터를 불러오지 못했습니다'),
      h('p', { class: 'hint', text: String(err && err.message ? err.message : err) }),
      h('p', { class: 'hint', text: 'seeds/skills/ 폴더(hook_formulas_ko.json · shorts_preset.json · comment_triage.json)가 함께 배포됐는지 확인하세요.' })));
  });
}

/* ────────────────────────── 프리셋 ────────────────────────── */

function paintPreset(slot, preset, h, brand) {
  slot.replaceChildren();
  const cap = preset.caption || {};
  const head = panel(h, `기본 숏폼 프리셋 — ${preset.name}`,
    preset.is_variant
      ? (preset.why || '이 트랙 전용 변형 프리셋입니다.')
      : '모든 대본은 이 뼈대로 시작합니다. 당근 스토리 숏폼 관찰 + 대전 청년 자막 규격을 합친 기본값입니다.');
  if (preset.is_variant) head.insertBefore(h('span', { class: 'tag', text: '트랙 전용 변형' }), head.firstChild.nextSibling);
  head.appendChild(h('div', { class: 'kv-grid' },
    h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '비트' }), h('span', { class: 'kv-v', text: preset.beats.map((b) => b.label).join(' → ') })),
    h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '길이' }), h('span', { class: 'kv-v', text: `${preset.slot_seconds || preset.beats[preset.beats.length - 1].end}초 · 평균 컷 ${preset.cut_rhythm.avg_cut_seconds.join('~')}초 · 한 샷 ${preset.cut_rhythm.max_shot_seconds}초 이내` })),
    h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '자막' }), h('span', { class: 'kv-v', text: `${cap.font_family} ${cap.font_px_at_1080w || cap.font_px}px(1080폭 기준) = 폭의 ${Math.round((cap.font_size_ratio_of_width || 0) * 1000) / 10}% · 한 줄 ${cap.line_max_chars_ko}자 · ${cap.lines_max}줄 · 하단 안전선 높이의 ${Math.round((cap.safe_bottom_y_ratio || 0.74) * 1000) / 10}%` })),
    h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '음량' }), h('span', { class: 'kv-v', text: `${preset.audio.lufs} LUFS / TP ${preset.audio.true_peak_dbtp} dBTP · ${preset.silent ? '무내레이션 고정' : '무내레이션 우선'}` })),
    h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '금지' }), h('span', { class: 'kv-v', text: preset.banned.slice(0, 4).join(' · ') }))));
  if (cap.note) head.appendChild(h('p', { class: 'hint', text: cap.note }));

  const toggle = h('button', {
    class: 'ghost-btn sm', type: 'button',
    text: mem.openPreset ? '비트 표 접기' : '비트별 지시 펼치기',
    onclick: () => { mem.openPreset = !mem.openPreset; paintPreset(slot, preset, h, brand); }
  });
  head.appendChild(h('div', { class: 'row', style: 'margin-top:8px' }, toggle));

  if (mem.openPreset) {
    head.appendChild(h('table', { class: 'seed-table' },
      h('thead', null, h('tr', null,
        h('th', { text: '구간' }), h('th', { text: '할 일' }), h('th', { text: '화면' }), h('th', { text: '자막·소리' }))),
      h('tbody', null, preset.beats.map((b) => h('tr', null,
        h('td', { class: 'mono', text: `${b.start.toFixed(1)}–${b.end.toFixed(1)}s` }),
        h('td', null, h('strong', { text: b.label }), h('div', { class: 'dim', text: b.speech.replace(/\{훅\}/, '훅') })),
        h('td', { text: b.screen }),
        h('td', null, h('div', { text: b.caption }), h('div', { class: 'dim', text: b.sound })))))));
  }
  slot.appendChild(head);

  if (preset.channels) {
    const ch = panel(h, '채널별로 다른 것 — 안전영역 · 지표 · 요청',
      '같은 영상을 세 곳에 올려도 하단 UI 높이와 유도하는 행동이 다릅니다. 한 파일로 올리지 말고, 올리는 곳에 맞춰 확인하세요.');
    ch.appendChild(h('table', { class: 'seed-table' },
      h('thead', null, h('tr', null, h('th', { text: '채널' }), h('th', { text: '보는 지표' }), h('th', { text: '피할 영역' }), h('th', { text: '요청' }))),
      h('tbody', null, ['shorts', 'reels', 'clip'].filter((k) => preset.channels[k]).map((k) => {
        const c = preset.channels[k];
        return h('tr', null,
          h('td', null, h('strong', { text: c.label }), h('div', { class: 'dim', text: c.note })),
          h('td', { text: c.metric }),
          h('td', { text: c.safe_area }),
          h('td', { text: c.cta }));
      }))));
    slot.appendChild(ch);
  }
}

/* ────────────────────────── ① 훅 ────────────────────────── */

function paintHooks(slot, formulas, ctx) {
  const { h, toast } = ctx;
  const seedHooks = (ctx._seedHooks || []).slice(0, 2);
  const starter = [
    ...seedHooks,
    '',
    ''
  ].join('\n');
  const input = h('textarea', {
    class: 'textarea mono', rows: '5', spellcheck: 'false',
    placeholder: '훅 후보를 한 줄에 하나씩. 5개를 쓰고 제일 센 것 두 개만 남기세요.'
  });
  input.value = starter;

  const out = h('div', { class: 'studio-out' });
  const p = panel(h, '① 첫 문장 채점 — 21개 공식 · 5속성',
    '영어 원본은 74개 실제 훅으로 보정됐고, 일부러 나쁜 훅과 진짜 훅은 잘 갈랐지만 한 크리에이터의 성공/실패는 거의 못 갈랐습니다. 낮은 점수는 다시 보라는 신호, 높은 점수는 약속이 아닙니다.');
  const run = () => {
    const lines = input.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { toast('훅을 한 줄 이상 넣으세요', 'err'); return; }
    const ranked = rankHooks(lines, formulas);
    mem.hooks = ranked;
    ctx._hooks = ranked;
    out.replaceChildren();
    ranked.forEach((r, i) => {
      const card = h('div', { class: 'hook-card' + (i === 0 ? ' top' : '') },
        h('div', { class: 'hook-head' },
          h('span', { class: 'hook-rank', text: i === 0 ? '후보 1' : `후보 ${i + 1}` }),
          h('strong', { class: 'hook-text', text: r.hook }),
          h('span', { class: 'badge ' + (r.verdict >= 65 ? 'LINKED' : r.verdict >= 50 ? 'READY' : 'DRAFT'), text: `${r.verdict} · ${r.band}` })),
        h('div', { class: 'prop-grid' }, Object.keys(r.properties).map((k) => h('div', { class: 'prop' },
          h('span', { class: 'prop-k', text: r.labels[k] }), meter(h, r.properties[k], r.labels[k]), h('b', { text: String(r.properties[k]) })))),
        h('p', { class: 'hint', text: `공식: ${r.formula}${r.matched ? ` (${r.matched}개 패턴 일치)` : ' — 요약문일 가능성이 큽니다'} · ${r.words}어절` }),
        h('p', { class: 'hint warn', text: `가장 약한 곳: ${r.weakest_label} — ${r.fix}` }));
      out.appendChild(card);
    });
    out.appendChild(h('p', { class: 'hint', text: '점수는 단어가 들어 있으면 올라갑니다 — 숫자·이름이 실제로 확인한 값인지, 문장이 자연스러운지는 사람이 봅니다. 후보 1을 ②에서 쓰려면 "채점 1위 넣기"를 누르세요.' }));
  };

  p.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '훅 후보 (한 줄에 하나)' }), input));
  p.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn primary sm', type: 'button', text: '5개 채점하기', onclick: run })));
  p.appendChild(out);
  slot.appendChild(p);
}

/* ────────────────────────── ② 대본 뼈대 ────────────────────────── */

function paintScript(slot, presetRaw, ctx) {
  const { h, toast, friendlyError, state } = ctx;
  const preset = pickPreset(presetRaw, state.brand);
  slot.replaceChildren();
  const p = panel(h, '② 대본 뼈대 — 타임코드 · 화면 지시 · 자막 배치',
    preset.is_variant
      ? `${preset.name} — ${preset.why || ''}`
      : '프리셋 비트에 확인한 값만 채웁니다. 확인 못 한 값은 [채우기]로 남고, 그대로 자막에 넣지 않습니다.');

  const f = {};
  const field = (key, label, ph, tag) => {
    const input = h(tag === 'area' ? 'textarea' : 'input', { class: 'input', rows: '2', placeholder: ph });
    f[key] = input;
    return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input);
  };
  const grid = h('div', { class: 'studio-form' },
    field('place', '가게·등장 대상', preset.silent ? '예: 메리 (브리티쉬 숏헤어)' : '예: 미미삼겹 (봉명동)', 'input'),
    field('hook', preset.silent ? '첫 자막(훅)' : '첫 문장(훅)', '①의 채점 1위를 넣거나 직접 씁니다', 'area'),
    field('point', '이 영상에서 알게 되는 것 한 가지', '예: 이 영상에서 알게 되는 것 1개', 'input'),
    field('price', '확인한 가격', '예: 14,000원 (확인한 값)', 'input'),
    field('wait', '확인한 대기', '예: 16팀, 30분 (확인한 값)', 'input'),
    field('con', '실제로 겪은 단점', '예: 실제로 겪은 불편 1개', 'input'),
    field('total', '총액·1인 금액', '예: 3명 42,000원', 'input'),
    field('when', '저장해 둘 상황', '예: 금요일 저녁, 고기 당길 때', 'input'));
  p.appendChild(grid);

  const out = h('div', { class: 'studio-out' });
  const build = () => {
    const vals = {};
    Object.keys(f).forEach((k) => { vals[k] = f[k].value.trim(); });
    const result = buildScript(preset, vals);
    mem.script = result;
    ctx._scriptResult = result;
    out.replaceChildren();
    out.appendChild(h('div', { class: 'kv-grid' },
      h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: preset.silent ? '자막' : '말' }), h('span', { class: 'kv-v', text: preset.silent ? `${result.eojeol}어절 · 무내레이션` : `${result.eojeol}어절 · ${result.speech_seconds}초 (분당 ${result.rate}어절)` })),
      h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '슬롯' }), h('span', { class: 'kv-v', text: `${result.slot_seconds}초 · 예상 컷 ${result.cuts_expected}개` })),
      result.over ? h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '주의' }), h('span', { class: 'kv-v warn', text: '말이 슬롯보다 깁니다 — 비트 하나를 줄이거나 문장을 자르세요' })) : null));

    out.appendChild(h('table', { class: 'seed-table' },
      h('thead', null, h('tr', null,
        h('th', { text: '구간' }), h('th', { text: preset.silent ? '자막' : '말' }), h('th', { text: '화면(ON SCREEN)' }), h('th', { text: '자막·소리' }))),
      h('tbody', null, result.beats.map((b) => h('tr', null,
        h('td', { class: 'mono' }, h('div', { text: b.timecode }), h('div', { class: 'dim', text: b.label })),
        h('td', null, h('div', { text: b.speech }), b.guide ? h('div', { class: 'dim', text: b.guide }) : null),
        h('td', { text: b.screen }),
        h('td', null, h('div', { text: b.caption }), h('div', { class: 'dim', text: b.sound })))))));

    const saveBtn = h('button', {
      class: 'btn sm', type: 'button', title: '현황 보드에 초안 카드를 만들고 대본을 카드 파일에 저장합니다',
      text: '＋ 현황 보드에 초안 카드로 저장',
      onclick: async () => {
        const place = f.place.value.trim();
        if (!place) { toast('가게·등장 대상을 먼저 넣으세요', 'err'); return; }
        saveBtn.disabled = true;
        const label = saveBtn.textContent;
        saveBtn.textContent = '저장 중…';
        try {
          const res = await api.createContent({
            brand: state.brand,
            place_name: place,
            cluster_id: '숏폼 작업실',
            category: preset.silent ? '숏폼' : '쇼츠',
            target_keywords: (f.point.value.trim() || place).slice(0, 60),
            hook_variant: result.beats[0].speech.slice(0, 120),
            allow_partial_shortform: true
          });
          const d = (res && res.data) || {};
          let patched = false;
          if (d.content_id) {
            try {
              await api.updateContent({
                content_id: d.content_id,
                expected_version: d.version,
                patch: {
                  shorts: {
                    preset_id: result.preset_id,
                    preset_name: result.preset_name,
                    hook: f.hook.value.trim(),
                    beats: result.beats,
                    created_by: 'content-hub 공방',
                    saved_at: new Date().toISOString()
                  }
                }
              });
              patched = true;
            } catch (e2) { patched = false; }
          }
          toast(patched
            ? `초안 카드 ${d.content_id} 로 저장했어요 (대본 포함)`
            : `초안 카드 ${d.content_id || ''} 를 만들었어요 — 대본 저장은 서버 재배포 후 동작합니다. 지금은 복사해서 쓰세요.`,
          patched ? 'ok' : '');
        } catch (err) {
          toast(friendlyError(err) || String(err), 'err');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = label;
        }
      }
    });

    out.appendChild(h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'ghost-btn sm', type: 'button', text: '⧉ 대본 전체 복사', onclick: () => copyText(scriptToText(result), toast, '대본 복사') }),
      saveBtn));
  };

  p.appendChild(h('div', { class: 'row' },
    h('button', { class: 'btn primary sm', type: 'button', text: '대본 뼈대 만들기', onclick: build }),
    h('button', {
      class: 'ghost-btn sm', type: 'button', text: '채점 1위 훅 넣기',
      onclick: () => {
        if (!mem.hooks.length) { toast('먼저 ①에서 훅을 채점하세요', 'err'); return; }
        f.hook.value = mem.hooks[0].hook;
        toast('채점 1위를 넣었습니다', 'ok');
      }
    }),
    h('button', {
      class: 'ghost-btn sm', type: 'button', text: '연재 시드 훅 넣기',
      onclick: () => {
        const seed = (ctx._seedHooks || [])[0];
        if (!seed) { toast('이 브랜드의 시드 훅이 없습니다', 'err'); return; }
        f.hook.value = seed;
        toast('시드 편의 첫 2초 훅을 넣었습니다', 'ok');
      }
    })));
  p.appendChild(out);
  slot.appendChild(p);
  ctx._scriptBuild = build;
}

/* ────────────────────────── ③ 패키지 ────────────────────────── */

function paintPackage(slot, ctx) {
  const { h } = ctx;
  const p = panel(h, '③ 제목 + 썸네일 한 쌍 점검',
    '제목과 썸네일은 한 덩어리입니다. 썸네일이 제목을 반복하면 클릭 면적의 절반이 같은 말을 두 번 합니다. 길이는 글자 수가 아니라 폭으로 잽니다(한글 1자 = 폭 2).');
  const title = h('input', { class: 'input', placeholder: '예: [대전 봉명동] 미미삼겹 냉삼 솔직후기 : 웨이팅 16팀 뚫은 이유' });
  const thumb = h('input', { class: 'input', placeholder: '썸네일 3단어 — 제목에 없는 말로 (예: 1인 14,000원)' });
  const out = h('div', { class: 'studio-out' });
  const run = () => {
    const r = lintPackage({ title: title.value, thumb: thumb.value });
    mem.pkg = r;
    out.replaceChildren();
    out.appendChild(h('div', { class: 'row', style: 'margin-bottom:8px' },
      h('span', { class: 'badge ' + (r.score >= 72 ? 'LINKED' : r.score >= 55 ? 'READY' : 'DRAFT'), text: `${r.score}점` }),
      h('span', { class: 'hint', text: `글자 ${r.chars}자 · 폭 ${r.width} (데스크톱 60 / 모바일 40 기준)` })));
    const list = h('div', { class: 'lint-list' });
    r.issues.forEach(([code, msg]) => list.appendChild(h('div', { class: 'lint-row issue' },
      h('span', { class: 'lint-code', text: code }), h('span', { text: msg }))));
    r.good.forEach((msg) => list.appendChild(h('div', { class: 'lint-row good' },
      h('span', { class: 'lint-code', text: 'ok' }), h('span', { text: msg }))));
    out.appendChild(list);
  };
  p.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '제목' }), title));
  p.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '썸네일 문구' }), thumb));
  p.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn primary sm', type: 'button', text: '한 쌍으로 채점', onclick: run })));
  p.appendChild(out);
  slot.appendChild(p);
}

/* ────────────────────────── ④ 컷편집 ────────────────────────── */

const SRT_SAMPLE = `1
00:00:00,000 --> 00:00:01,800
음 여기가 봉명동에서 제일 줄 긴 집인데요

2
00:00:01,800 --> 00:00:02,400
어

3
00:00:04,200 --> 00:00:07,000
금요일 저녁 7시에 왔더니 대기가 16팀이었습니다

4
00:00:07,000 --> 00:00:09,400
30분 딱 기다리니까 들어갔어요

5
00:00:09,400 --> 00:00:10,100
그

6
00:00:10,100 --> 00:00:12,600
30분 딱 기다리니까 들어갔어요`;

function paintEDL(slot, preset, ctx) {
  const { h, toast } = ctx;
  const p = panel(h, '④ 컷편집 리스트 — DEAD · FILLER · REPEAT',
    '타임코드가 있는 대본을 붙여넣으면 자를 곳만 알려줍니다. DEAD는 가운데를 잘라 양쪽에 숨 쉴 틈을 남기고, REPEAT은 "음"을 건너뛰고 마지막 실제 발화와 비교합니다. 영상은 건드리지 않습니다.');
  const ta = h('textarea', { class: 'textarea mono', rows: '9', spellcheck: 'false', placeholder: 'SRT / VTT / "00:12 말" 형식' });
  ta.value = SRT_SAMPLE;
  const floor = h('input', { class: 'input short', type: 'number', step: '0.1', min: '0.2', max: '3', value: '0.6' });
  const out = h('div', { class: 'studio-out' });
  const run = () => {
    const result = buildEDL(ta.value, { floor: Number(floor.value) || 0.6 });
    mem.edl = result;
    out.replaceChildren();
    if (!result.ok) { out.appendChild(h('div', { class: 'result err', text: result.error })); return; }
    out.appendChild(h('div', { class: 'kv-grid' },
      h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '말한 시간' }), h('span', { class: 'kv-v', text: `${result.stats.speech_seconds}초` })),
      h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '자르는 시간' }), h('span', { class: 'kv-v', text: `${result.stats.cut_seconds}초 (${result.stats.removed_pct}%)` })),
      h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '남는 길이' }), h('span', { class: 'kv-v', text: `${result.stats.result_seconds}초` })),
      h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '종류' }), h('span', { class: 'kv-v', text: `무음 ${result.stats.by_type.DEAD} · 추임새 ${result.stats.by_type.FILLER} · 재시도 ${result.stats.by_type.REPEAT}` })),
      h('div', { class: 'kv' }, h('span', { class: 'kv-k', text: '프리셋 목표' }), h('span', { class: 'kv-v', text: `${preset.slot_seconds}초 · 25초에 ${preset.cut_rhythm.cuts_per_25s.join('~')}컷` }))));

    out.appendChild(h('table', { class: 'seed-table' },
      h('thead', null, h('tr', null, h('th', { text: '자르기' }), h('th', { text: '구간' }), h('th', { text: '초' }), h('th', { text: '이유' }))),
      h('tbody', null, result.cuts.map((c) => h('tr', null,
        h('td', null, h('span', { class: 'badge DRAFT', text: c.type })),
        h('td', { class: 'mono', text: `${c.from} → ${c.to}` }),
        h('td', { text: String(c.seconds) }),
        h('td', null, h('div', { text: c.text }), h('div', { class: 'dim', text: c.why })))))));

    out.appendChild(h('h4', { text: '살릴 곳 — 화면에 무엇을 띄울지' }));
    out.appendChild(h('table', { class: 'seed-table' },
      h('thead', null, h('tr', null, h('th', { text: '구간' }), h('th', { text: '말' }), h('th', { text: 'ON SCREEN' }))),
      h('tbody', null, result.kept.map((k) => h('tr', null,
        h('td', { class: 'mono', text: `${k.start} → ${k.end}` }),
        h('td', { text: k.text }),
        h('td', { text: k.on_screen }))))));
    out.appendChild(h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'ghost-btn sm', type: 'button', text: '⧉ 컷 리스트 복사', onclick: () => copyText(edlToText(result, preset), toast, '컷 리스트 복사') })));
  };
  p.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '타임코드 대본' }), ta));
  p.appendChild(h('div', { class: 'row' }, h('label', { class: 'inline-field' },
    h('span', { class: 'hint', text: '무음 기준(초)' }), floor),
  h('button', { class: 'btn primary sm', type: 'button', text: '컷 리스트 만들기', onclick: run })));
  p.appendChild(out);
  slot.appendChild(p);
}

/* ────────────────────────── ⑤ 댓글 ────────────────────────── */

function paintComments(slot, triage, ctx) {
  const { h, toast } = ctx;
  const p = panel(h, '⑤ 댓글 4분류 + 답장 초안',
    '물어봄·칭찬·정보 정정·도배로 나눕니다. 초안은 말투 파일(담백한 해요체, 인사 한 줄 + 실제 답 한 줄)로 쓰고, 그대로 붙이지 말고 다듬어 씁니다. 분류는 규칙 기반이라 틀릴 수 있습니다.');
  const ta = h('textarea', { class: 'textarea', rows: '6', spellcheck: 'false', placeholder: '댓글을 한 줄에 하나씩 붙여넣으세요' });
  const out = h('div', { class: 'studio-out' });
  const run = () => {
    const cls = classifyComments(ta.value, triage);
    if (!cls.rows.length) { toast('댓글을 한 줄 이상 넣으세요', 'err'); return; }
    mem.comment = cls;
    out.replaceChildren();
    out.appendChild(h('div', { class: 'row', style: 'margin-bottom:8px' },
      triage.piles.map((pl) => h('span', { class: 'tag', text: `${pl.label} ${cls.counts[pl.id] || 0}` }))));
    const table = h('table', { class: 'seed-table' },
      h('thead', null, h('tr', null, h('th', { text: '무더기' }), h('th', { text: '댓글' }), h('th', { text: '답장 초안(다듬어 쓰기)' }))),
      h('tbody', null, cls.rows.map((r) => h('tr', null,
        h('td', null, h('span', { class: 'badge ' + (r.pile === 'question' ? 'READY' : r.pile === 'info' ? 'REVIEW' : r.pile === 'noise' ? 'DRAFT' : 'LINKED'), text: r.pile_label })),
        h('td', { text: r.text }),
        h('td', null, r.pile === 'noise'
          ? h('span', { class: 'dim', text: '답하지 않습니다(삭제도 하지 않음)' })
          : h('span', { text: draftReply(r, triage) }))))));
    out.appendChild(table);
    const pin = pickPin(cls, triage);
    out.appendChild(h('div', { class: 'panel inner' },
      h('h4', null, '고정할 댓글 1개'),
      pin
        ? h('div', null,
          h('p', { class: 'hint', text: `고른 댓글: "${pin.comment}" (${pin.pile})` }),
          pin.template ? h('p', { class: 'mono', text: pin.template }) : null,
          h('p', { class: 'hint', text: pin.why || '' }))
        : h('p', { class: 'hint', text: '고정할 만한 질문이 없습니다. 다음 영상에서 반복될 질문을 하나 골라 고정하세요.' })));
    out.appendChild(h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'ghost-btn sm', type: 'button', text: '⧉ 답장 초안 복사', onclick: () => copyText(cls.rows.filter((r) => r.pile !== 'noise').map((r) => `[${r.pile_label}] ${r.text}\n→ ${draftReply(r, triage)}`).join('\n\n'), toast, '답장 초안 복사') })));
  };
  p.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '댓글' }), ta));
  p.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn primary sm', type: 'button', text: '나누고 답장 초안 쓰기', onclick: run })));
  p.appendChild(out);
  slot.appendChild(p);
}

/* ────────────────────────── ⑥ 바이럴 ────────────────────────── */

const VIRAL_SAMPLE = `대전청년\t봉명동 냉삼 3곳 비교\t182000
대전청년\t유성 혼술바 1잔씩 3곳\t96000
대전청년\t봉명동 1차 코스 4만원\t54000
삐약 김메리\t메리 세탁소 침투\t240000
삐약 김메리\t킹꿍이 릴스\t88000
삐약 김메리\t겨울 집사 하루\t41000`;

function paintViral(slot, ctx) {
  const { h, toast } = ctx;
  const p = panel(h, '⑥ 바이럴 아웃라이어 — 채널 평소 중위수 대비 배수',
    '"채널, 제목, 조회수"를 한 줄에 하나. 고정된 영상은 채널의 평소 대비 몇 배인지로만 줄 세웁니다. 큰 채널의 평범한 영상이 위에 오면 배울 게 없기 때문입니다.');
  const ta = h('textarea', { class: 'textarea mono', rows: '7', spellcheck: 'false' });
  ta.value = VIRAL_SAMPLE;
  const out = h('div', { class: 'studio-out' });
  const run = () => {
    const parsed = parseRows(ta.value);
    if (!parsed.rows.length) { toast('"채널, 제목, 조회수" 형식으로 넣어 주세요', 'err'); return; }
    const res = analyze(parsed.rows, { min: 2.0 });
    mem.viral = res;
    out.replaceChildren();
    out.appendChild(h('p', { class: 'hint', text: res.note }));
    out.appendChild(h('div', { class: 'row', style: 'margin-bottom:6px' },
      Object.keys(res.medians).map((ch) => h('span', { class: 'tag', text: `${ch} 중위수 ${Math.round(res.medians[ch]).toLocaleString('ko-KR')}` }))));
    out.appendChild(h('table', { class: 'seed-table' },
      h('thead', null, h('tr', null, h('th', { text: '배수' }), h('th', { text: '채널' }), h('th', { text: '제목' }), h('th', { text: '조회수' }))),
      h('tbody', null, res.rows.map((r) => h('tr', { class: r.multiple >= 2 ? 'outlier' : null },
        h('td', null, h('span', { class: 'badge ' + (r.multiple >= 2 ? 'LINKED' : 'DRAFT'), text: `${r.multiple}×` })),
        h('td', null, h('span', { text: r.channel }), r.sample_short ? h('span', { class: 'dim', text: ' (표본 적음)' }) : null),
        h('td', { text: r.title }),
        h('td', { class: 'mono', text: r.views.toLocaleString('ko-KR') }))))));
    out.appendChild(h('p', { class: 'hint', text: res.caveat }));
    if (parsed.bad.length) out.appendChild(h('p', { class: 'hint warn', text: `읽지 못한 줄 ${parsed.bad.length}개 — ${parsed.bad.slice(0, 3).map((b) => b.line + '번째').join(', ')}` }));
  };
  p.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: '영상 목록' }), ta));
  p.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn primary sm', type: 'button', text: '배수 계산', onclick: run })));
  p.appendChild(out);
  slot.appendChild(p);
}
