#!/usr/bin/env python3
"""swipe_ko.py — 바이럴 아웃라이어: 채널 평소 중위수 대비 배수. 한국어판.

원본: Jakeschincariol/youtube-agent-skill (MIT) skills/yt-viral/swipe.py
조회수 절대값이 아니라 '그 채널의 중위수 대비 몇 배'로 줄 세운다. 큰 채널의 평범한 영상이
작은 채널의 터진 영상보다 위에 오면 배울 게 없기 때문이다.
채널당 3편 미만이면 중위수가 '평소'를 대표하지 못한다(표시해 준다).

    python3 tools/yt/swipe_ko.py collected.tsv            # 채널\t제목\t조회수
    python3 tools/yt/swipe_ko.py collected.tsv --min 1.5
    python3 tools/yt/swipe_ko.py collected.tsv --json
"""
import argparse
import json
import re
import statistics
import sys


def num(v):
    m = re.sub(r"[^\d.]", "", str(v))
    try:
        return float(m) if m else 0.0
    except ValueError:
        return 0.0


def parse_rows(raw):
    rows, bad = [], []
    for i, line in enumerate(str(raw or "").split("\n"), 1):
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        parts = [p.strip() for p in re.split(r"\t|,|\s{2,}|\s\|\s", t) if p.strip()]
        if len(parts) < 3:
            bad.append({"line": i, "text": t})
            continue
        views = num(parts[-1])
        if not views:
            bad.append({"line": i, "text": t})
            continue
        rows.append({"channel": parts[0], "title": " ".join(parts[1:-1]), "views": int(views)})
    return rows, bad


def analyze(rows, minimum=2.0):
    by = {}
    for r in rows:
        by.setdefault(r["channel"], []).append(r)
    medians, out = {}, []
    for ch, lst in by.items():
        m = statistics.median([r["views"] for r in lst])
        medians[ch] = m
        for r in lst:
            out.append({**r, "median": m, "multiple": round(r["views"] / m, 2) if m else 0,
                        "channel_n": len(lst), "sample_short": len(lst) < 3})
    out.sort(key=lambda r: -r["multiple"])
    outliers = [r for r in out if r["multiple"] >= minimum]
    return {"rows": out, "outliers": outliers, "medians": medians, "min": minimum,
            "caveat": "채널당 3편 미만이면 중위수가 그 채널의 평소를 대표하지 못합니다."}


def main():
    ap = argparse.ArgumentParser(description="채널 중위수 대비 바이럴 배수")
    ap.add_argument("file")
    ap.add_argument("--min", type=float, default=2.0)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    with open(a.file, encoding="utf-8") as f:
        rows, bad = parse_rows(f.read())
    if not rows:
        print('"채널\t제목\t조회수" 형식으로 3개 이상 넣어 주세요.')
        return 1
    res = analyze(rows, a.min)
    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=1))
        return 0
    print("\n  채널별 중위수: " + " · ".join(f"{k} {int(v):,}" for k, v in res["medians"].items()))
    print(f"  {len(res['outliers'])}편이 {a.min}배를 넘었습니다.\n")
    for r in res["rows"]:
        flag = "★" if r["multiple"] >= a.min else " "
        short = " (표본 적음)" if r["sample_short"] else ""
        print(f"   {flag} {r['multiple']:>5.2f}×  {r['channel']}{short}  {r['views']:,}회  {r['title']}")
    print(f"\n  {res['caveat']}\n")
    if bad:
        print(f"  읽지 못한 줄 {len(bad)}개: " + ", ".join(str(b['line']) for b in bad[:5]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
