---
name: yt-edit
description: >-
  타임코드 대본을 컷편집 리스트로 바꾼다 — 무음(DEAD)·추임새(FILLER)·재시도(REPEAT)를 초 단위로.
  "이거 편집해", "군더더기 잘라", "너무 길어", "컷 리스트"에 쓴다. content-hub 숏폼 공방 ④와 같은 계산.
---

# yt-edit — 컷편집 리스트

원본: `skills/yt-edit/deadair.py` (MIT) → 한국어판.

```bash
python3 tools/yt/edl_ko.py transcript.srt
python3 tools/yt/edl_ko.py transcript.srt --floor 0.4 --json
```

- 입력: SRT·VTT, 또는 `00:12 말` 형식. 타임코드가 없으면 먼저 만든다(whisper, faster-whisper, 비공개 업로드 자동 자막). **타임코드를 추측하지 않는다.**
- DEAD는 **가운데**를 자른다. 말에 딱 붙여 자르면 숨가쁜 테이크가 된다.
- REPEAT은 바로 앞 큐가 아니라 **마지막 실제 발화**와 비교한다(사이에 "음"이 끼기 때문).
- 결과의 `살릴 곳` 표에 ON SCREEN 지시가 붙는다. 그대로 편집에 쓴다.
- 40% 컷은 '말'의 40%다. 무음 데모가 긴 영상이면 이 비율은 틀린다. 영상과 대조한다.

## 게이트

- 영상을 건드리지 않는다. 어디를 자를지만 알려준다.
- 발행하지 않는다.
