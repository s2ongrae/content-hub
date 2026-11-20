/**
 * js/yt/edl.js — 컷편집 리스트(EDL) 만들기 (한국어판)
 *
 * 원본: Jakeschincariol/youtube-agent-skill (MIT) skills/yt-edit/deadair.py
 *   타임코드가 있는 대본에서 DEAD(무음) · FILLER(추임새) · REPEAT(재시도)를 찾아
 *   "어디를 몇 초에서 몇 초까지 자르라"만 출력한다. 영상은 건드리지 않는다.
 *
 * DEAD는 가운데를 자른다(양쪽에 숨 쉴 틈을 남긴다). 말에 딱 붙여 자르면 숨가쁜 테이크가 된다.
 * REPEAT은 바로 앞 큐가 아니라 '마지막으로 실제 말이 있던 큐'와 비교한다. 재시도 사이에
 * "음"이 끼는 경우가 대부분이기 때문이다.
 *
 * 40% 컷은 '말'의 40%다. 무음 데모가 긴 영상이면 이 비율은 틀린다. 영상과 대조해 쓴다.
 */

const FILLERS = new Set(['음', '어', '아', '그', '저', '뭐', '약간', '진짜', '그냥', '막', '이제', '일단', '뭐지', '그니까', '그러니까', '어어', '음음', '아아', '네', '예', 'uh', 'um', 'er', 'ah']);

const norm = (s) => String(s || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/[.,!?~…"'“”‘’()\-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokens = (s) => norm(s).split(' ').filter(Boolean);

export function tcToSec(s) {
  const m = String(s).trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?[,.](\d{1,3})/);
  if (m) {
    const h = m[3] ? Number(m[1]) : 0;
    const mm = m[3] ? Number(m[2]) : Number(m[1]);
    const ss = m[3] ? Number(m[3]) : Number(m[2]);
    return h * 3600 + mm * 60 + ss + Number(m[4].padEnd(3, '0')) / 1000;
  }
  const m2 = String(s).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
  return null;
}

export function secToTc(sec, withMs = true) {
  const v = Math.max(0, sec);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = Math.floor(v % 60);
  const ms = Math.round((v - Math.floor(v)) * 1000);
  const base = `${h ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withMs ? `${base}.${String(ms).padStart(3, '0')}` : base;
}

export function parseCues(raw) {
  const text = String(raw || '').replace(/\r/g, '').trim();
  if (!text) return [];
  const cues = [];
  // SRT / VTT: 시간줄 다음 텍스트 블록
  const blocks = text.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() && !/^WEBVTT/i.test(l));
    const timeLine = lines.find((l) => /-->/.test(l));
    if (!timeLine) continue;
    const [a, b] = timeLine.split('-->').map((x) => x.trim().split(/\s+/)[0]);
    const start = tcToSec(a);
    const end = tcToSec(b);
    if (start == null || end == null) continue;
    const body = lines.slice(lines.indexOf(timeLine) + 1).join(' ').trim();
    cues.push({ start, end, text: body });
  }
  if (cues.length) return cues.sort((x, y) => x.start - y.start);

  // 타임코드가 줄 앞에 붙은 대본: "00:12 지글지글" / "[00:12] ..."
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\]?\s*(.+)$/);
    if (!m) continue;
    const start = tcToSec(m[1]);
    if (start == null) continue;
    cues.push({ start, end: start + 1.0, text: m[2].trim() });
  }
  return cues.sort((x, y) => x.start - y.start);
}

function onScreenHint(text) {
  const t = norm(text);
  if (!t) return '현장 컷(빈 화면 금지)';
  if (/(원|만원|가격|얼마|금액|계산|영수증)/.test(t)) return '영수증·메뉴판·가격표 클로즈업';
  if (/(웨이팅|줄|대기|기다)/.test(t)) return '줄 선 사람 / 번호표 클로즈업';
  if (/(동|구|역|골목|입구|간판|위치)/.test(t)) return '간판 → 입구 → 골목 원컷';
  if (/(맛|먹|한\s?점|씹|고기|반찬|국물)/.test(t)) return '한 점 먹는 손·입 클로즈업';
  if (/(주차|화장실|자리|테이블)/.test(t)) return '매장 구조·주차 입구 한 컷';
  return '말하는 대상 클로즈업(손/제품/화면)';
}

export function buildEDL(raw, opts = {}) {
  const floor = Number.isFinite(opts.floor) ? opts.floor : 0.6;
  const breathe = Number.isFinite(opts.breathe) ? opts.breathe : 0.12;
  const cues = parseCues(raw);
  if (!cues.length) {
    return { ok: false, error: '타임코드를 찾지 못했습니다. SRT(00:00:01,200 --> …)나 "00:12 말" 형식으로 붙여넣어 주세요.', cuts: [], kept: [], stats: null };
  }

  const cuts = [];
  const kept = [];
  let lastSpeech = null;
  let speechSec = 0;

  for (let i = 0; i < cues.length; i += 1) {
    const c = cues[i];
    const prev = cues[i - 1];
    const body = norm(c.text);
    const tk = tokens(c.text);
    const allFiller = tk.length > 0 && tk.every((x) => FILLERS.has(x));

    // DEAD: 앞 큐 끝과 이 큐 시작 사이의 침묵
    if (prev) {
      const gap = c.start - prev.end;
      if (gap > floor) {
        cuts.push({
          type: 'DEAD',
          from: secToTc(prev.end + breathe),
          to: secToTc(c.start - breathe),
          seconds: Number((gap - breathe * 2).toFixed(2)),
          text: `(무음 ${gap.toFixed(2)}초)`,
          why: '가운데만 자르고 양쪽에 숨 쉴 틈을 남깁니다'
        });
      }
    }

    if (tk.length && allFiller) {
      cuts.push({
        type: 'FILLER', from: secToTc(c.start), to: secToTc(c.end),
        seconds: Number((c.end - c.start).toFixed(2)), text: c.text, why: '추임새만 있는 큐'
      });
      continue;
    }

    if (lastSpeech && body) {
      const a = norm(lastSpeech.text).slice(0, 12);
      const b = body.slice(0, 12);
      if (a && b && (a === b || (a.length > 5 && b.startsWith(a.slice(0, 8))))) {
        cuts.push({
          type: 'REPEAT', from: secToTc(c.start), to: secToTc(c.end),
          seconds: Number((c.end - c.start).toFixed(2)), text: c.text, why: `앞 테이크와 같은 문장("${lastSpeech.text.slice(0, 20)}…")`
        });
        continue;
      }
    }

    if (tk.length) {
      lastSpeech = c;
      speechSec += Math.max(0, c.end - c.start);
      kept.push({ start: secToTc(c.start), end: secToTc(c.end), text: c.text.trim(), on_screen: onScreenHint(c.text) });
    }
  }

  const cutSec = cuts.reduce((a, c) => a + (c.seconds || 0), 0);
  const span = cues[cues.length - 1].end - cues[0].start;
  const stats = {
    cues: cues.length,
    speech_seconds: Number(speechSec.toFixed(1)),
    cut_seconds: Number(cutSec.toFixed(1)),
    original_seconds: Number(span.toFixed(1)),
    result_seconds: Number(Math.max(0, span - cutSec).toFixed(1)),
    removed_pct: span > 0 ? Math.round((cutSec / span) * 100) : 0,
    by_type: {
      DEAD: cuts.filter((c) => c.type === 'DEAD').length,
      FILLER: cuts.filter((c) => c.type === 'FILLER').length,
      REPEAT: cuts.filter((c) => c.type === 'REPEAT').length
    },
    floor
  };
  return { ok: true, cuts, kept, stats };
}

export function edlToText(result, preset) {
  if (!result.ok) return result.error;
  const lines = [];
  lines.push(`# 컷편집 리스트 (${preset ? preset.name : '기본'})`);
  lines.push(`자르는 곳 ${result.cuts.length}개 · 말한 시간 ${result.stats.speech_seconds}초 · 자른 시간 ${result.stats.cut_seconds}초 (${result.stats.removed_pct}%) · 남는 길이 ${result.stats.result_seconds}초`);
  lines.push('');
  lines.push('## 자를 곳');
  result.cuts.forEach((c) => lines.push(`${c.type}\t${c.from} → ${c.to}\t${c.seconds}초\t${c.text}`));
  lines.push('');
  lines.push('## 살릴 곳 (타임코드 / 말 / 화면)');
  result.kept.forEach((k) => lines.push(`${k.start} → ${k.end}\t${k.text}\t${k.on_screen}`));
  return lines.join('\n');
}
