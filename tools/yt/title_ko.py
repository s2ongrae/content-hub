#!/usr/bin/env python3
"""title_ko.py — 제목 + 썸네일 한 쌍 린터. 한국어판.

원본: Jakeschincariol/youtube-agent-skill (MIT) skills/yt-package/title.py
핵심은 '제목과 썸네일은 한 덩어리'라는 것. 따로 쓰면 썸네일이 제목을 반복하고
클릭 면적의 절반이 같은 말을 두 번 한다.

길이 보정: 원본의 60자(데스크톱)/40자(모바일)는 라틴 문자 폭 기준이다. 한글은 약 2배 폭이라
글자 수 대신 '폭'으로 잰다(한글 1자 = 2). 한글 제목 대략 30자가 같은 기준선이 된다.

    python3 tools/yt/title_ko.py --title "..." --thumb "1인 14,000원"
    python3 tools/yt/title_ko.py titles.txt --thumb "..."
    python3 tools/yt/title_ko.py --title "..." --json
"""
import argparse
import json
import re
import sys

W_DESKTOP, W_MOBILE, W_HARD = 60, 40, 100
VAGUE = {"최고", "최강", "완벽", "미친", "대박", "역대급", "엄청", "굉장", "모든", "유일", "혁명",
         "갓", "꿀", "레전드", "찐", "사기급", "압도적"}
STOP = {"그", "이", "저", "그리고", "진짜", "너무", "정말", "오늘", "여기", "거기", "것", "수", "때",
        "좀", "더", "잘", "안", "못", "좋은", "있는", "하는", "위한", "대한", "the", "a", "an",
        "of", "for", "to", "in", "on", "and"}
EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF\u2600-\u27BF]")


def width(s):
    w = 0
    for ch in str(s or ""):
        c = ord(ch)
        if 0x1100 <= c <= 0x11FF or 0x2E80 <= c <= 0xA4CF or 0xAC00 <= c <= 0xD7A3 or 0xFF00 <= c <= 0xFF60:
            w += 2
        elif EMOJI_RE.match(ch):
            w += 3
        else:
            w += 1
    return w


def words(t):
    return [w for w in re.split(r"\s+", str(t or "").strip()) if w]


def strip(w):
    return re.sub(r"[.,!?\"'“”‘’·:;()\[\]]", "", w)


def content(t):
    return {strip(w) for w in words(t) if strip(w) and strip(w) not in STOP}


def lint(title, thumb=None):
    t = str(title).strip()
    th = str(thumb or "").strip()
    n, w = len(t), width(t)
    issues, good = [], []

    if w > W_HARD:
        issues.append(("length", f"폭 {w} — 유튜브 상한(폭 {W_HARD})을 넘습니다"))
    elif w > W_DESKTOP:
        issues.append(("length", f"폭 {w} — 데스크톱 검색에서 폭 {W_DESKTOP} 근처가 잘립니다(한글 약 30자)"))
    else:
        good.append(f"폭 {w} — 데스크톱 기준(폭 {W_DESKTOP}) 안")

    if w > W_MOBILE:
        acc, cut = 0, t
        for i, ch in enumerate(t):
            acc += width(ch)
            if acc > W_MOBILE:
                cut = t[:i]
                break
        issues.append(("mobile", f'모바일 피드는 "{cut}…" 까지 — 주어가 살아남는지 확인하세요'))

    caps = [x for x in words(t) if re.search(r"[A-Z]{2,}", x)]
    if len(caps) > 2:
        issues.append(("shouting", f"대문자 강조 {len(caps)}개 — 2개가 상한입니다"))
    elif caps:
        good.append("대문자 강조 1~2개")

    vague = [strip(x) for x in words(t) if strip(x) in VAGUE]
    if vague:
        issues.append(("vague", f"{', '.join(sorted(set(vague)))} — 숫자·이름·날짜로 바꾸세요"))

    nums = re.findall(r"\d[\d,.]*\s?(?:원|만원|천원|%|명|곳|개|번|분|초|잔|인분|kg|g|배|일|주|개월|년)?", t)
    if nums:
        good.append(f"구체 숫자({', '.join(nums[:3])})")
    else:
        issues.append(("no-number", "숫자·날짜·이름이 없습니다 — 가장 확실한 한 가지 수정"))

    if t.endswith("?"):
        good.append("질문형 제목")
    if not [x for x in [strip(x) for x in words(t)[:3]] if x and x not in STOP]:
        issues.append(("front-load", "앞 세 어절이 전부 군더더기 — 주어를 앞으로"))

    emoji = len(EMOJI_RE.findall(t))
    if emoji > 2:
        issues.append(("emoji", f"이모지 {emoji}개 — 피드에서 산만합니다(2개 이하)"))

    if th:
        shared = sorted(content(th) & content(t))
        if shared:
            issues.append(("duplicate", f"썸네일이 제목과 같은 단어({', '.join(shared[:4])}) — 썸네일은 제목이 못 한 말을"))
        else:
            good.append("썸네일과 제목이 다른 단어를 씀")
        if len(words(th)) > 4:
            issues.append(("thumb-length", f"썸네일 {len(words(th))}단어 — 3단어가 상한"))
        if width(th) > 22:
            issues.append(("thumb-width", f"썸네일 폭 {width(th)} — 1080px에서 한 줄에 안 들어갑니다(폭 22 이하)"))
    else:
        issues.append(("no-thumb", "썸네일 문구를 같이 넣어야 한 쌍으로 채점됩니다"))

    score = max(0, min(100, 100 - 14 * len(issues) + 4 * len(good)))
    return {"title": t, "thumb": th, "chars": n, "width": w, "score": score,
            "issues": issues, "good": good}


def show(r):
    print(f'\n  "{r["title"]}"  ({r["chars"]}자 · 폭 {r["width"]} · {r["score"]}/100)')
    for code, msg in r["issues"]:
        print(f"    x  {code:<12} {msg}")
    for msg in r["good"]:
        print(f"    ok {msg}")


def main():
    ap = argparse.ArgumentParser(description="제목 + 썸네일 한 쌍 린터")
    ap.add_argument("file", nargs="?")
    ap.add_argument("--title")
    ap.add_argument("--thumb")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if a.title:
        titles = [a.title]
    elif a.file:
        with open(a.file, encoding="utf-8") as f:
            titles = [l for l in f.read().splitlines() if l.strip()]
    else:
        ap.print_help()
        return 1
    rows = sorted((lint(t, a.thumb) for t in titles), key=lambda r: -r["score"])
    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return 0
    for r in rows:
        show(r)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
