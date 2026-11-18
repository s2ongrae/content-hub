#!/usr/bin/env python3
"""edl_ko.py — 컷편집 리스트(EDL) 만들기. 한국어판.

원본: Jakeschincariol/youtube-agent-skill (MIT) skills/yt-edit/deadair.py
DEAD(무음)·FILLER(추임새)·REPEAT(재시도)를 타임코드로 알려준다. 영상은 건드리지 않는다.
DEAD는 가운데를 자른다(양쪽에 숨 쉴 틈). REPEAT은 '음'을 건너뛰고 마지막 실제 발화와 비교한다.

    python3 tools/yt/edl_ko.py transcript.srt
    python3 tools/yt/edl_ko.py transcript.srt --floor 0.4 --json

40% 컷은 '말'의 40%다. 무음 데모가 긴 영상이면 이 비율은 틀린다. 영상과 대조해 쓴다.
"""
import argparse
import json
import re
import sys

FILLERS = {"음", "어", "아", "그", "저", "뭐", "약간", "진짜", "그냥", "막", "이제", "일단",
           "뭐지", "그니까", "그러니까", "어어", "음음", "아아", "네", "예",
           "uh", "um", "er", "ah"}


def norm(s):
    s = re.sub(r"<[^>]*>", " ", str(s or ""))
    s = re.sub(r"[.,!?~…\"'“”‘’()\-]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tc_to_sec(s):
    m = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?[,.](\d{1,3})", str(s))
    if m:
        h = int(m.group(1)) if m.group(3) else 0
        mm = int(m.group(2)) if m.group(3) else int(m.group(1))
        ss = int(m.group(3)) if m.group(3) else int(m.group(2))
        return h * 3600 + mm * 60 + ss + int(m.group(4).ljust(3, "0")) / 1000
    m2 = re.match(r"^(\d{1,2}):(\d{2})$", str(s).strip())
    if m2:
        return int(m2.group(1)) * 60 + int(m2.group(2))
    return None


def sec_to_tc(sec, ms=True):
    v = max(0.0, float(sec))
    h, m, s = int(v // 3600), int((v % 3600) // 60), int(v % 60)
    t = (f"{h:02d}:" if h else "") + f"{m:02d}:{s:02d}"
    return t + f".{int(round((v - int(v)) * 1000)):03d}" if ms else t


def parse_cues(raw):
    text = str(raw or "").replace("\r", "").strip()
    cues = []
    for block in re.split(r"\n{2,}", text):
        lines = [l for l in block.split("\n") if l.strip() and not re.match(r"^WEBVTT", l, re.I)]
        idx = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if idx is None:
            continue
        a, b = [x.strip().split()[0] for x in lines[idx].split("-->")[:2]]
        start, end = tc_to_sec(a), tc_to_sec(b)
        if start is None or end is None:
            continue
        cues.append({"start": start, "end": end, "text": " ".join(lines[idx + 1:]).strip()})
    if cues:
        return sorted(cues, key=lambda c: c["start"])
    for line in text.split("\n"):
        m = re.match(r"^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\]?\s*(.+)$", line)
        if not m:
            continue
        start = tc_to_sec(m.group(1))
        if start is None:
            continue
        cues.append({"start": start, "end": start + 1.0, "text": m.group(2).strip()})
    return sorted(cues, key=lambda c: c["start"])


def on_screen(text):
    t = norm(text)
    if not t:
        return "현장 컷(빈 화면 금지)"
    if re.search(r"(원|만원|가격|얼마|금액|계산|영수증)", t):
        return "영수증·메뉴판·가격표 클로즈업"
    if re.search(r"(웨이팅|줄|대기|기다)", t):
        return "줄 선 사람 / 번호표 클로즈업"
    if re.search(r"(동|구|역|골목|입구|간판|위치)", t):
        return "간판 → 입구 → 골목 원컷"
    if re.search(r"(맛|먹|한\s?점|씹|고기|반찬|국물)", t):
        return "한 점 먹는 손·입 클로즈업"
    if re.search(r"(주차|화장실|자리|테이블)", t):
        return "매장 구조·주차 입구 한 컷"
    return "말하는 대상 클로즈업(손/제품/화면)"


def build(raw, floor=0.6, breathe=0.12):
    cues = parse_cues(raw)
    if not cues:
        return {"ok": False, "error": "타임코드를 찾지 못했습니다. SRT(00:00:01,200 --> …)나 \"00:12 말\" 형식으로 넣어 주세요."}
    cuts, kept, last_speech, speech = [], [], None, 0.0
    for i, c in enumerate(cues):
        prev = cues[i - 1] if i else None
        body = norm(c["text"])
        tk = [t for t in body.split(" ") if t]
        all_filler = bool(tk) and all(t in FILLERS for t in tk)
        if prev:
            gap = c["start"] - prev["end"]
            if gap > floor:
                cuts.append({"type": "DEAD", "from": sec_to_tc(prev["end"] + breathe),
                             "to": sec_to_tc(c["start"] - breathe),
                             "seconds": round(gap - breathe * 2, 2),
                             "text": f"(무음 {gap:.2f}초)", "why": "가운데만 자르고 양쪽에 숨 쉴 틈"})
        if all_filler:
            cuts.append({"type": "FILLER", "from": sec_to_tc(c["start"]), "to": sec_to_tc(c["end"]),
                         "seconds": round(c["end"] - c["start"], 2), "text": c["text"], "why": "추임새만 있는 큐"})
            continue
        if last_speech and body:
            a = norm(last_speech["text"])[:12]
            b = body[:12]
            if a and b and (a == b or (len(a) > 5 and b.startswith(a[:8]))):
                cuts.append({"type": "REPEAT", "from": sec_to_tc(c["start"]), "to": sec_to_tc(c["end"]),
                             "seconds": round(c["end"] - c["start"], 2), "text": c["text"],
                             "why": f'앞 테이크와 같은 문장("{last_speech["text"][:20]}…")'})
                continue
        if tk:
            last_speech = c
            speech += max(0.0, c["end"] - c["start"])
            kept.append({"start": sec_to_tc(c["start"]), "end": sec_to_tc(c["end"]),
                         "text": c["text"].strip(), "on_screen": on_screen(c["text"])})
    cut_sec = sum(c["seconds"] for c in cuts)
    span = cues[-1]["end"] - cues[0]["start"]
    stats = {"cues": len(cues), "speech_seconds": round(speech, 1), "cut_seconds": round(cut_sec, 1),
             "original_seconds": round(span, 1), "result_seconds": round(max(0, span - cut_sec), 1),
             "removed_pct": round(cut_sec / span * 100) if span else 0,
             "by_type": {k: sum(1 for c in cuts if c["type"] == k) for k in ("DEAD", "FILLER", "REPEAT")},
             "floor": floor}
    return {"ok": True, "cuts": cuts, "kept": kept, "stats": stats}


def main():
    ap = argparse.ArgumentParser(description="SRT → 컷편집 리스트")
    ap.add_argument("file")
    ap.add_argument("--floor", type=float, default=0.6)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    with open(a.file, encoding="utf-8") as f:
        raw = f.read()
    r = build(raw, a.floor)
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=1))
        return 0 if r["ok"] else 1
    if not r["ok"]:
        print(r["error"])
        return 1
    s = r["stats"]
    print(f"\n  자르는 곳 {len(r['cuts'])}개 · 말한 시간 {s['speech_seconds']}초 · 자른 시간 {s['cut_seconds']}초 ({s['removed_pct']}%) · 남는 길이 {s['result_seconds']}초")
    print(f"  무음 {s['by_type']['DEAD']} · 추임새 {s['by_type']['FILLER']} · 재시도 {s['by_type']['REPEAT']}\n")
    for c in r["cuts"]:
        print(f"    {c['type']:<6} {c['from']} → {c['to']}  {c['seconds']}초  {c['text']}  ({c['why']})")
    print("\n  살릴 곳")
    for k in r["kept"]:
        print(f"    {k['start']} → {k['end']}  {k['on_screen']}  | {k['text'][:46]}")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
