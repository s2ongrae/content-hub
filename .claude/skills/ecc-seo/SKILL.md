---
name: ecc-seo
description: "SEO 점검·개선(ECC 원본) — 크롤·색인, 제목·메타·헤딩, 구조화 데이터, 키워드 매핑, 내부링크. 네이버 블로그 글과 공개 페이지의 검색 노출을 다룰 때 읽는다. English: technical and on-page SEO audit, keyword mapping, internal linking."
metadata:
  origin: ECC (v2.2.3, affaan-m/ECC)
  upstream: skills/seo
  upstream_commit: 3f14a10
  applied: 2026-11-19 (이 레포 맞춤 선별)
  license: MIT (ECC)
---

# ECC `seo` — 이 레포 적용본

> 원본: `affaan-m/ECC` `skills/seo/SKILL.md` (v2.2.3, 3f14a10).
> 본문은 **원문 그대로**(영어) 두었다 — 다음에 원본을 갱신할 때 diff로 비교하기 위해서다.
> 규칙이 부딪히면 **이 레포 `CLAUDE.md`·`docs/`가 우선**이다. 아래 메모를 먼저 읽고, 필요한 절만 원문에서 찾아 쓴다.

## 적용 메모 (이 레포 기준)

- **채널**: 주 채널은 네이버 블로그(`youth-daejeon`). 네이버 자체 규칙(C-Rank·DIA·스마트블록)은 이 스킬 범위 밖 — 일반 원칙만 가져온다: 1페이지 1의도, 제목 앞부분에 핵심어, 헤딩 구조, 내부링크.
- **트랙 분리**: 대전 청년·삐약 김메리 키워드와 링크를 섞지 않는다(CLAUDE.md §2).
- **적용 대상**: 블로그 글, `seeds/`에서 렌더한 기획 문서, 공개 페이지. 콘텐츠 허브 앱(`index.html`, 해시 라우터)은 색인 대상이 아니다.
- **구조화 데이터**는 실제 내용과 맞을 때만 넣는다(스킬 Anti-Patterns). 네이버 블로그에는 JSON-LD를 넣을 수 없으니 이 항목은 자체 페이지에만.
- 제목 길이 기준은 이 스킬의 50~60자(영문) 대신 네이버 블로그 관행(30자 안팎, 앞부분 키워드)으로 읽는다.

---

<!-- ↓↓↓ ECC 원본 본문 (번역하지 않음) ↓↓↓ -->

# SEO

Improve search visibility through technical correctness, performance, and content relevance, not gimmicks.

## When to Use

Use this skill when:
- auditing crawlability, indexability, canonicals, or redirects
- improving title tags, meta descriptions, and heading structure
- adding or validating structured data
- improving Core Web Vitals
- doing keyword research and mapping keywords to URLs
- planning internal linking or sitemap / robots changes

## How It Works

### Principles

1. Fix technical blockers before content optimization.
2. One page should have one clear primary search intent.
3. Prefer long-term quality signals over manipulative patterns.
4. Mobile-first assumptions matter because indexing is mobile-first.
5. Recommendations should be page-specific and implementable.

### Technical SEO checklist

#### Crawlability

- `robots.txt` should allow important pages and block low-value surfaces
- no important page should be unintentionally `noindex`
- important pages should be reachable within a shallow click depth
- avoid redirect chains longer than two hops
- canonical tags should be self-consistent and non-looping

#### Indexability

- preferred URL format should be consistent
- multilingual pages need correct hreflang if used
- sitemaps should reflect the intended public surface
- no duplicate URLs should compete without canonical control

#### Performance

- LCP < 2.5s
- INP < 200ms
- CLS < 0.1
- common fixes: preload hero assets, reduce render-blocking work, reserve layout space, trim heavy JS

#### Structured data

- homepage: organization or business schema where appropriate
- editorial pages: `Article` / `BlogPosting`
- product pages: `Product` and `Offer`
- interior pages: `BreadcrumbList`
- Q&A sections: `FAQPage` only when the content truly matches

### On-page rules

#### Title tags

- aim for roughly 50-60 characters
- put the primary keyword or concept near the front
- make the title legible to humans, not stuffed for bots

#### Meta descriptions

- aim for roughly 120-160 characters
- describe the page honestly
- include the main topic naturally

#### Heading structure

- one clear `H1`
- `H2` and `H3` should reflect actual content hierarchy
- do not skip structure just for visual styling

### Keyword mapping

1. define the search intent
2. gather realistic keyword variants
3. prioritize by intent match, likely value, and competition
4. map one primary keyword/theme to one URL
5. detect and avoid cannibalization

### Internal linking

- link from strong pages to pages you want to rank
- use descriptive anchor text
- avoid generic anchors when a more specific one is possible
- backfill links from new pages to relevant existing ones

## Examples

### Title formula

```text
Primary Topic - Specific Modifier | Brand
```

### Meta description formula

```text
Action + topic + value proposition + one supporting detail
```

### JSON-LD example

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Page Title Here",
  "author": {
    "@type": "Person",
    "name": "Author Name"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Brand Name"
  }
}
```

### Audit output shape

```text
[HIGH] Duplicate title tags on product pages
Location: src/routes/products/[slug].tsx
Issue: Dynamic titles collapse to the same default string, which weakens relevance and creates duplicate signals.
Fix: Generate a unique title per product using the product name and primary category.
```

## Anti-Patterns

| Anti-pattern | Fix |
| --- | --- |
| keyword stuffing | write for users first |
| thin near-duplicate pages | consolidate or differentiate them |
| schema for content that is not actually present | match schema to reality |
| content advice without checking the actual page | read the real page first |
| generic “improve SEO” outputs | tie every recommendation to a page or asset |

## Related Skills

- `seo-specialist`
- `frontend-patterns`
- `brand-voice`
- `market-research`
