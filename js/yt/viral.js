/**
 * js/yt/viral.js — 바이럴 아웃라이어 분석 (한국어판)
 *
 * 원본: Jakeschincariol/youtube-agent-skill (MIT) skills/yt-viral/swipe.py
 *   잘 된 영상을 '조회수 절대값'이 아니라 '그 채널의 평소 중위수 대비 배수'로 줄 세운다.
 *   큰 채널의 평범한 영상이 작은 채널의 터진 영상보다 위에 오면 배울 게 없기 때문이다.
 *
 * 규칙: 채널별 중위수를 구하고 배수 = 조회수 ÷ 중위수. 기본 컷은 2.0배.
 *   중위수는 그 채널의 '평소'다. 한 영상만 넣으면 중위수가 그 영상이라 배수는 항상 1.0이다.
 */

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

const toNum = (v) => {
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** 붙여넣기 파서: "채널, 제목, 조회수" 또는 "채널<TAB>제목<TAB>조회수" 한 줄에 하나 */
export function parseRows(raw) {
  const rows = [];
  const bad = [];
  String(raw || '').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t || /^#/.test(t)) return;
    const parts = t.split(/\t|,|\s{2,}|\s\|\s/).map((x) => x.trim()).filter((x) => x !== '');
    if (parts.length < 3) { bad.push({ line: i + 1, text: t }); return; }
    const views = toNum(parts[parts.length - 1]);
    const channel = parts[0];
    const title = parts.slice(1, parts.length - 1).join(' ');
    if (!views) { bad.push({ line: i + 1, text: t }); return; }
    rows.push({ channel, title, views });
  });
  return { rows, bad };
}

export function analyze(rows, opts = {}) {
  const min = Number.isFinite(opts.min) ? opts.min : 2.0;
  const byChannel = new Map();
  rows.forEach((r) => {
    if (!byChannel.has(r.channel)) byChannel.set(r.channel, []);
    byChannel.get(r.channel).push(r);
  });
  const medians = {};
  const out = [];
  byChannel.forEach((list, channel) => {
    const m = median(list.map((r) => r.views));
    medians[channel] = m;
    list.forEach((r) => {
      out.push({
        channel,
        title: r.title,
        views: r.views,
        median: m,
        multiple: m ? Number((r.views / m).toFixed(2)) : 0,
        channel_n: list.length,
        sample_short: list.length < 3
      });
    });
  });
  out.sort((a, b) => b.multiple - a.multiple);
  const outliers = out.filter((r) => r.multiple >= min);
  return {
    rows: out,
    outliers,
    medians,
    min,
    note: outliers.length
      ? `${outliers.length}편이 평소의 ${min}배를 넘었습니다. 배수가 높은 순서대로 보세요.`
      : `${min}배를 넘은 영상이 없습니다. 기준을 낮추거나 채널별 영상을 3편 이상 넣으세요.`,
    caveat: '채널당 3편 미만이면 중위수가 그 채널의 평소를 대표하지 못합니다(표에 표시).'
  };
}
