---
name: ecc-article-writing
description: "장문 글쓰기(ECC 원본) — 블로그·가이드·뉴스레터를 사람 목소리로, 근거 먼저, AI 상투어 금지. 네이버 블로그 초안을 쓸 때 읽는다. English: long-form article and blog post writing with voice control and banned AI patterns."
metadata:
  origin: ECC (v2.2.3, affaan-m/ECC)
  upstream: skills/article-writing
  upstream_commit: 3f14a10
  applied: 2026-11-19 (이 레포 맞춤 선별)
  license: MIT (ECC)
---

# ECC `article-writing` — 이 레포 적용본

> 원본: `affaan-m/ECC` `skills/article-writing/SKILL.md` (v2.2.3, 3f14a10).
> 본문은 **원문 그대로**(영어) 두었다 — 다음에 원본을 갱신할 때 diff로 비교하기 위해서다.
> 규칙이 부딪히면 **이 레포 `CLAUDE.md`·`docs/`가 우선**이다. 아래 메모를 먼저 읽고, 필요한 절만 원문에서 찾아 쓴다.

## 적용 메모 (이 레포 기준)

- **사용자 톤이 기준**: 담백한 구어체, 대전 로컬 비유, 과장·"AI 연출" 금지. 이 스킬의 Banned Patterns와 같은 방향이다.
- **역할 분담**: 레이는 초안·임시저장까지, 수정·발행은 사용자(2026-11-17 확정). 발행 버튼까지 가지 않는다.
- **숫자·사실**: 가격·영업시간·후기는 확인한 값만 쓴다. 못 채운 칸은 `[채우기]`로 남긴다(스킬 Core Rule 5: never invent facts).
- **블로그 서식**: 이 레포의 기존 블로그 서식(소제목·표·사진 자리)을 유지하고, 이 스킬은 문장·구조 판단에만 쓴다.
- 본문이 가리키는 `brand-voice`는 이 레포에 `ecc-brand-voice`로 함께 넣었다.

---

<!-- ↓↓↓ ECC 원본 본문 (번역하지 않음) ↓↓↓ -->

# Article Writing

Write long-form content that sounds like an actual person with a point of view, not an LLM smoothing itself into paste.

## When to Activate

- drafting blog posts, essays, launch posts, guides, tutorials, or newsletter issues
- turning notes, transcripts, or research into polished articles
- matching an existing founder, operator, or brand voice from examples
- tightening structure, pacing, and evidence in already-written long-form copy

## Core Rules

1. Lead with the concrete thing: artifact, example, output, anecdote, number, screenshot, or code.
2. Explain after the example, not before.
3. Keep sentences tight unless the source voice is intentionally expansive.
4. Use proof instead of adjectives.
5. Never invent facts, credibility, or customer evidence.

## Voice Handling

If the user wants a specific voice, run `brand-voice` first and reuse its `VOICE PROFILE`.
Do not duplicate a second style-analysis pass here unless the user explicitly asks for one.

If no voice references are given, default to a sharp operator voice: concrete, unsentimental, useful.

## Banned Patterns

Delete and rewrite any of these:
- "In today's rapidly evolving landscape"
- "game-changer", "cutting-edge", "revolutionary"
- "here's why this matters" as a standalone bridge
- fake vulnerability arcs
- a closing question added only to juice engagement
- biography padding that does not move the argument
- generic AI throat-clearing that delays the point

## Writing Process

1. Clarify the audience and purpose.
2. Build a hard outline with one job per section.
3. Start sections with proof, artifact, conflict, or example.
4. Expand only where the next sentence earns space.
5. Cut anything that sounds templated, overexplained, or self-congratulatory.

## Structure Guidance

### Technical Guides

- open with what the reader gets
- use code, commands, screenshots, or concrete output in major sections
- end with actionable takeaways, not a soft recap

### Essays / Opinion

- start with tension, contradiction, or a specific observation
- keep one argument thread per section
- make opinions answer to evidence

### Newsletters

- keep the first screen doing real work
- do not front-load diary filler
- use section labels only when they improve scanability

## Quality Gate

Before delivering:
- factual claims are backed by provided sources
- generic AI transitions are gone
- the voice matches the supplied examples or the agreed `VOICE PROFILE`
- every section adds something new
- formatting matches the intended medium
