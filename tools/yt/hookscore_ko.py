#!/usr/bin/env python3
"""hookscore_ko.py — 첫 문장(훅)을 재기 전에 채점한다. 한국어판.

원본: Jakeschincariol/youtube-agent-skill (MIT) skills/yt-script/hookscore.py
     5속성(0~100), 최종점수 = 평균 60% + 최약 40%. 최약 가중은 의도적이다 —
     넷이 세고 하나가 죽은 훅은 그 하나에서 새고, 평균은 그걸 숨긴다.

한국어 보정: 어절로 센다(7~20어절이 첫 2초~10초 대역). 공식 21개는
seeds/skills/hook_formulas_ko.json 에 있고 이 파일은 그 데이터를 읽기만 한다.

    python3 tools/yt/hookscore_ko.py --hook "봉명동 1인 14,000원 냉삼, 웨이팅 16팀 뚫은 이유"
    python3 tools/yt/hookscore_ko.py hooks.txt
    python3 tools/yt/hookscore_ko.py --json hooks.txt

말할 수 있는 것/없는 것: 영어 원본은 실제 훅 74개로 보정됐고 일부러 나쁜 훅과 진짜 훅은
잘 갈랐지만 한 크리에이터의 성공/실패는 거의 못 갈랐다. 한국어판은 그 보정을 물려받지
못했다. 낮은 점수는 '다시 보라'는 신호, 높은 점수는 약속이 아니다.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))


def _data(name):
    """규칙 파일 위치: ① CONTENT_HUB_SEEDS ② 저장소(seeds/skills) ③ 설치본(같은 폴더/data)."""
    for cand in (os.environ.get("CONTENT_HUB_SEEDS"),
                 os.path.join(REPO, "seeds", "skills"),
                 os.path.join(HERE, "data")):
        if cand and os.path.isfile(os.path.join(cand, name)):
            return os.path.join(cand, name)
    return os.path.join(REPO, "seeds", "skills", name)


FORMULAS_PATH = _data("hook_formulas_ko.json")

VAGUE = {"최고", "최강", "완벽", "미친", "대박", "역대급", "찐", "레전드", "엄청", "굉장",
         "엄청난", "모든", "유일무이", "혁명", "꿀", "갓", "사기급"}
FILLER = {"그냥", "진짜", "너무", "되게", "약간", "일단", "그래서", "그니까", "뭔가", "좀",
          "정말", "완전", "이제", "여기", "저기", "그거", "이거", "저거", "같은", "근데",
          "그런데", "아무튼", "어쨌든"}
# '당신'은 번역투라 한국어 숏폼에서 오히려 이탈을 부른다(제미니 검토) — 가산하지 않는다.
YOU_RE = re.compile(r"(?:^|[\s,.!?\"'“”‘’])(너|너는|너가|네가|니가|너도|너만|여러분|본인)(?=[\s,.!?\"'“”‘’]|$|[은는이가를도만한테])")
NUM_RE = re.compile(r"\d[\d,.]*\s?(?:%|퍼센트|명|개|곳|번|분|초|원|만원|천원|배|잔|인분|그램|g|kg|위|시간|일|주|개월|년|팀|가지|컷|인)|(?:\d+분의\s?\d+)")
AUD_RE = re.compile(r"(대전|유성|봉명동|갈마동|은행동|둔산|관평동|궁동|청년|20대|30대|직장인|혼밥|혼술|커플|집사|퇴근|점심|저녁|주말|아침)")
POLITE_RE = re.compile(r"(하세요|보세요|가세요|드세요|세요|시죠|습니다|해요|예요|이에요)")
COND_RE = re.compile(r"(면|때|전에|까지|뿐)")
REVEAL_RE = re.compile(r"(이유|비결|정체|차이|실험|재봤|바꿨|뿐|알고\s?보니)")
STAKE_RE = re.compile(r"(손해|망했|망한|망한다|후회|비싸|비쌌|비싼|돈|시간|실패|위험|놓치|아깝|늦|날리|사기|줄었|없어졌|올랐|깨졌|걸렸)")
CURIOSITY_RE = re.compile(r"(왜|어떻게|뭐|무슨|어디|언제|얼마|누가|근데|그런데|이유|비결|사실|까지|전에|아무도|혹시|정체)")
PROPER_RE = re.compile(r"[가-힣]{2,}(?:동|구|역|로|집|바|관|시장|골목|아파트)")
CLOSED_RE = re.compile(r"(왜냐하면|그래서|즉|때문에|결론은)")

FIX = {
    "SPECIFICITY": "형용사 하나를 숫자·이름·날짜로 바꾸세요",
    "ADDRESS": "첫 여섯 어절 안에 '너/여러분/대전 20대'처럼 대상을 부르세요",
    "STAKES": "그대로 두면 무엇을 잃는지(돈·시간·한 끼)를 말하세요",
    "CURIOSITY": "스스로 답해 버리는 반쪽 문장을 잘라내세요",
    "BREVITY": "7~20어절. 소리 내어 읽고 숨이 차는 곳에서 자르세요",
}
LABELS = {"SPECIFICITY": "특정성", "ADDRESS": "호명", "STAKES": "손실", "CURIOSITY": "호기심", "BREVITY": "간결"}


def clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))


def words(t):
    return [w for w in re.split(r"\s+", str(t or "").strip()) if w]


def strip_punct(w):
    return re.sub(r"[.,!?\"'“”‘’]", "", w)


def specificity(t):
    w = words(t)
    if not w:
        return 0
    nums = len(NUM_RE.findall(t))
    vague = sum(1 for x in w if strip_punct(x) in VAGUE)
    filler = sum(1 for x in w if strip_punct(x) in FILLER)
    s = 40 + nums * 18 - vague * 14 - filler * 5
    proper = sum(1 for x in w[1:] if PROPER_RE.search(x))
    s += min(14, proper * 7)
    return clamp(s)


def address(t):
    n = len(YOU_RE.findall(t))
    head = " ".join(words(t)[:6])
    first = 25 if YOU_RE.search(head) else 0
    aud = min(30, len(AUD_RE.findall(t)) * 10)
    polite = 8 if POLITE_RE.search(t) else 0
    return clamp(40 + n * 18 + first + aud + polite)


def stakes(t):
    n = len(STAKE_RE.findall(t))
    cond = 8 if COND_RE.search(t) else 0
    return clamp(30 + n * 24 + (12 if re.search(r"\d", t) else 0) + cond)


def curiosity(t):
    n = len(CURIOSITY_RE.findall(t))
    q = 18 if str(t).strip().endswith("?") else 0
    closed = -18 if CLOSED_RE.search(t) else 0
    reveal = 10 if REVEAL_RE.search(t) else 0
    return clamp(32 + n * 15 + q + closed + reveal)


def brevity(t):
    n = len(words(t))
    if not n:
        return 0
    if 7 <= n <= 20:
        return 100
    if n < 7:
        return max(30, 100 - (7 - n) * 12)
    return max(10, 100 - (n - 20) * 6)


PROPS = [("SPECIFICITY", specificity), ("ADDRESS", address), ("STAKES", stakes),
         ("CURIOSITY", curiosity), ("BREVITY", brevity)]


def band(v):
    # 한국어 보정 기준: 65/50 (영어 원본은 72/55). 실제 시드 훅 24개 분포를 보고 내렸다.
    return "튼튼" if v >= 65 else "쓸 만함" if v >= 50 else "약함"


def load_formulas():
    with open(FORMULAS_PATH, encoding="utf-8") as f:
        return json.load(f)["hooks"]


def classify(t, formulas):
    best, hits = None, 0
    for f in formulas:
        n = 0
        for p in f.get("match", []):
            try:
                if re.search(p, t, re.I):
                    n += 1
            except re.error:
                continue
        if n > hits:
            best, hits = f, n
    return (best.get("ko_name") or best["name"]) if best else "분류 없음", hits


def score(t, formulas):
    parts = {name: fn(t) for name, fn in PROPS}
    vals = list(parts.values())
    verdict = round(0.6 * (sum(vals) / len(vals)) + 0.4 * min(vals))
    name, hits = classify(t, formulas)
    weak = min(parts, key=parts.get)
    return {
        "hook": t.strip(), "properties": parts, "verdict": verdict, "band": band(verdict),
        "formula": name, "matched": hits, "weakest": weak, "weakest_label": LABELS[weak],
        "fix": FIX[weak], "words": len(words(t)),
    }


def report(r):
    print(f"\n  {r['hook']}")
    print("  " + "-" * min(72, max(20, len(r["hook"]))))
    for k, v in r["properties"].items():
        print(f"    {LABELS[k]:<6} {v:3d}  {'#' * (v // 5)}")
    print(f"    {'VERDICT':<6} {r['verdict']:3d}  {r['band']}")
    print(f"    formula   {r['formula']}" + (f"  ({r['matched']}개 패턴 일치)" if r["matched"] else "  (공식 없음 — 요약문일 가능성)"))
    print(f"    weakest   {r['weakest_label']} - {r['fix']}")
    print(f"    어절      {r['words']}")


def main():
    ap = argparse.ArgumentParser(description="첫 문장(훅) 채점 — 21개 공식 · 5속성")
    ap.add_argument("file", nargs="?", help="훅 한 줄에 하나")
    ap.add_argument("--hook", help="한 문장만 채점")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    formulas = load_formulas()
    if a.hook:
        lines = [a.hook]
    elif a.file:
        with open(a.file, encoding="utf-8") as f:
            lines = [l for l in f.read().splitlines() if l.strip()]
    else:
        ap.print_help()
        return 1
    rows = sorted((score(t, formulas) for t in lines), key=lambda r: -r["verdict"])
    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return 0
    for r in rows:
        report(r)
    if len(rows) > 1:
        print(f"\n  winner: {rows[0]['hook']}  ({rows[0]['verdict']}, {rows[0]['band']})\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
