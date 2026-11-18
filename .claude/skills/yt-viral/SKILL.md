---
name: yt-viral
description: >-
  잘 된 영상을 채널 평소 중위수 대비 배수로 줄 세운다. "뭐가 터졌지", "우리 채널 아웃라이어",
  "경쟁 채널 분석", "왜 이 영상만" 에 쓴다. content-hub 숏폼 공방 ⑥과 같은 계산.
---

# yt-viral — 아웃라이어

원본: `skills/yt-viral/swipe.py` (MIT) → 한국어판.

```bash
python3 tools/yt/swipe_ko.py collected.tsv            # 채널<TAB>제목<TAB>조회수
python3 tools/yt/swipe_ko.py collected.tsv --min 1.5
```

- 배수 = 조회수 ÷ 그 채널의 중위수. 절대 조회수로 줄 세우지 않는다. 큰 채널의 평범한 영상이 위에 오면 배울 게 없다.
- 기본 컷 2.0배. 채널당 3편 미만이면 중위수가 '평소'가 아니라고 표시한다.
- 공개 목록만 읽는다. 로그인·자격증명을 쓰지 않는다.
- 공식 분류(`yt-hook`)를 붙여 "이 제목이 어떤 공식을 썼나"까지 적는다.

## 게이트

- 관찰과 판정을 분리해 쓴다. "이 제목은 The Statistic을 썼다"는 관찰, "그래서 터졌다"는 주장이다.
- 숫자를 만들지 않는다. 표본이 적으면 적다고 쓴다.
