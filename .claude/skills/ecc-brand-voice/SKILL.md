---
name: ecc-brand-voice
description: "필자 목소리 프로필 만들기(ECC 원본) — 실제 발행 글에서 VOICE PROFILE(리듬·압축·금지 표현)을 뽑아 여러 결과물에 재사용. 블로그·쇼츠 대본 톤을 맞출 때 읽는다. English: build a source-derived voice profile and reuse it across content."
metadata:
  origin: ECC (v2.2.3, affaan-m/ECC)
  upstream: skills/brand-voice
  upstream_commit: 3f14a10
  applied: 2026-11-19 (이 레포 맞춤 선별)
  license: MIT (ECC)
---

# ECC `brand-voice` — 이 레포 적용본

> 원본: `affaan-m/ECC` `skills/brand-voice/SKILL.md` (v2.2.3, 3f14a10).
> 본문은 **원문 그대로**(영어) 두었다 — 다음에 원본을 갱신할 때 diff로 비교하기 위해서다.
> 규칙이 부딪히면 **이 레포 `CLAUDE.md`·`docs/`가 우선**이다. 아래 메모를 먼저 읽고, 필요한 절만 원문에서 찾아 쓴다.

## 적용 메모 (이 레포 기준)

- **브랜드별로 따로 만든다**: `daejeon_youth`(대전 청년) / `ppiyak_kimmary`(삐약 김메리). 두 트랙의 톤을 섞지 않는다(CLAUDE.md §2).
- **소스**: 실제 발행한 블로그 글, 쇼츠 대본, `seeds/series_pack_*.json`의 기획 문구. 스킬의 X 게시물 수집(`x-api`) 단계는 없다 — 위 소스로 대체.
- **저장 위치**: VOICE PROFILE을 이 공개 저장소에 커밋하지 않는다(스킬 Persistence Rules). 필요하면 사용자 승인 후 로컬·메모리에 둔다.
- **"Affaan / ECC 보이스" 절**은 이 레포에 해당 없음 — 브랜드별 프로필이 그 자리를 대신한다.
- 프로필 스키마: `references/voice-profile-schema.md`(원본 그대로).

---

<!-- ↓↓↓ ECC 원본 본문 (번역하지 않음) ↓↓↓ -->

# Brand Voice

Build a durable voice profile from real source material, then use that profile everywhere instead of re-deriving style from scratch or defaulting to generic AI copy.

## When to Activate

- the user wants content or outreach in a specific voice
- writing for X, LinkedIn, email, launch posts, threads, or product updates
- adapting a known author's tone across channels
- the existing content lane needs a reusable style system instead of one-off mimicry

## Source Priority

Use the strongest real source set available, in this order:

1. recent original X posts and threads
2. articles, essays, memos, launch notes, or newsletters
3. real outbound emails or DMs that worked
4. product docs, changelogs, README framing, and site copy

Do not use generic platform exemplars as source material.

## Collection Workflow

1. Gather 5 to 20 representative samples when available.
2. Prefer recent material over old material unless the user says the older writing is more canonical.
3. Separate "public launch voice" from "private working voice" if the source set clearly splits.
4. If live X access is available, use `x-api` to pull recent original posts before drafting.
5. If site copy matters, include the current ECC landing page and repo/plugin framing.

## What to Extract

- rhythm and sentence length
- compression vs explanation
- capitalization norms
- parenthetical use
- question frequency and purpose
- how sharply claims are made
- how often numbers, mechanisms, or receipts show up
- how transitions work
- what the author never does

## Output Contract

Produce a reusable `VOICE PROFILE` block that downstream skills can consume directly. Use the schema in [references/voice-profile-schema.md](references/voice-profile-schema.md).

Keep the profile structured and short enough to reuse in session context. The point is not literary criticism. The point is operational reuse.

## Affaan / ECC Defaults

If the user wants Affaan / ECC voice and live sources are thin, start here unless newer source material overrides it:

- direct, compressed, concrete
- specifics, mechanisms, receipts, and numbers beat adjectives
- parentheticals are for qualification, narrowing, or over-clarification
- capitalization is conventional unless there is a real reason to break it
- questions are rare and should not be used as bait
- tone can be sharp, blunt, skeptical, or dry
- transitions should feel earned, not smoothed over

## Hard Bans

Delete and rewrite any of these:

- fake curiosity hooks
- "not X, just Y"
- "no fluff"
- forced lowercase
- LinkedIn thought-leader cadence
- bait questions
- "Excited to share"
- generic founder-journey filler
- corny parentheticals

## Persistence Rules

- Reuse the latest confirmed `VOICE PROFILE` across related tasks in the same session.
- If the user asks for a durable artifact, save the profile in the requested workspace location or memory surface.
- Do not create repo-tracked files that store personal voice fingerprints unless the user explicitly asks for that.

## Downstream Use

Use this skill before or inside:

- `content-engine`
- `crosspost`
- `lead-intelligence`
- article or launch writing
- cold or warm outbound across X, LinkedIn, and email

If another skill already has a partial voice capture section, this skill is the canonical source of truth.
