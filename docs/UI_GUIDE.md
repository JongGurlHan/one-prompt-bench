# UI 디자인 가이드 — 토큰, 컴포넌트, 탭별 레이아웃

시안 원본은 `docs/design/*.dc.html`이다(claude.ai 디자인 캔버스 형식이라 단독으로는 렌더링되지 않는다). 레이아웃·문구 참고용이고, 아래 값이 구현 기준이다. 수치는 기준값이라 구현 중 맞지 않으면 조정하고 handoff에 남긴다(CLAUDE.md "문서"). 원칙과 안티패턴은 지킨다. 문구는 `docs/COPY.md`, 표시 값은 `docs/DATA.md` "표시 규칙".

## 디자인 원칙

1. **결과물이 주인공이다.** 사이트는 액자처럼 차분하게 만든다. 밝은 회녹색 바탕에 초록 강조색 하나만 쓴다.
2. **숫자는 정직하게.** 숫자·날짜·식별자는 모노 폰트로 쓰고, 없는 값은 "—"로 둔다. 점수 합산·순위·트로피로 우열을 암시하지 않는다.
3. **한 번에 하나.** 결과물은 하나만 실행한다. 표는 가로 스크롤을 허용하고 열을 숨기지 않는다.
4. **라이트 모드 고정, 한국어만.** 문구는 "~해요"체다.

## AI 슬롭 안티패턴 — 하지 마라

| 금지 사항 | 이유 |
|---|---|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text (배경 그라데이션 텍스트) | AI가 만든 SaaS 랜딩의 1번 특징 |
| "Powered by AI" 배지 | 기능이 아니라 장식. 사용자에게 가치 없음 |
| box-shadow 글로우 애니메이션, 카드 그림자 | 네온 글로우 = AI 슬롭. 이 사이트는 테두리(1px)로만 구분한다 |
| 보라/인디고 브랜드 색상 | "AI = 보라색" 클리셰. 보라 계열은 상태 배지(잘림·HTML 없음·거부)에만 쓴다 |
| 컴포넌트 구분 없이 같은 큰 둥글기 | 템플릿 느낌. 아래 "둥글기" 표의 컴포넌트별 값만 쓴다 |
| 배경 gradient orb (blur-3xl 원형) | 모든 AI 랜딩 페이지에 있는 장식 |
| 순위 배지·트로피·1위 강조·점수 합계 | "순위가 아니라 기록"이라는 사이트 성격과 반대 |
| 숫자 카운트업·스크롤 등장 애니메이션 | 장식. 결과물 iframe 외에는 움직임이 없다 |
| 이모지 아이콘 | 판정 기호(✓ △ ✗)와 각주 기호(† ‡ § ¶) 외에는 쓰지 않는다 |

## 토큰 (`:root` CSS 변수)

### 색
| 변수 | 값 | 용도 |
|---|---|---|
| `--bg` | #F5F6F3 | 페이지 바탕 |
| `--surface` | #FFFFFF | 헤더, 카드, 목록 버튼, 표 컨테이너 |
| `--surface-muted` | #FAFBF9 | 표 머리(th) |
| `--surface-selected` | #E7F0EA | 선택된 모델 버튼 |
| `--notice-bg` / `--notice-text` | #E9EFEA / #23432F | 안내 박스 (비용 안내) |
| `--viewer-bg` | #1C1F24 | 결과물 실행 영역 바탕 |
| `--viewer-title` / `--viewer-text` | #E8EAED / #C9CDD3 | 실행 영역 안 문구 |
| `--text` | #16181D | 주 텍스트, 제목 |
| `--text-strong` | #3B4048 | 탭 링크, 생성 기록 값, 칩 |
| `--text-body` | #4A4F57 | 본문 설명, 표 머리 |
| `--text-muted` | #5A606B | 보조 정보, 날짜, "—" |
| `--border` | #DADDD6 | 카드·헤더 테두리 |
| `--border-strong` | #CFD3CC | 버튼·칩 테두리, 점선 범례 |
| `--divider` | #E6E8E3 | 카드 내부·표 행 구분선 |
| `--divider-soft` | #EEF0EC | 생성 조건 목록 구분선 |
| `--accent` / `--accent-hover` | #2F5D46 / #1F4232 | 링크, 선택 테두리, 주 버튼, 작은 라벨 |
| `--nav-active-bg` / `--nav-active-text` | #16181D / #FFFFFF | 현재 탭 |
| `--footnote-mark` | #6B4A0B | † ‡ § ¶ 위첨자 |

### 상태 배지 (바탕 / 글자)
| 라벨 | 바탕 | 글자 |
|---|---|---|
| 정상 | #DCEBDF | #1F5132 |
| 지시 미준수 | #F6E7C8 | #6B4A0B |
| 위반 | #F5D9D5 | #7A2318 |
| 잘림 · HTML 없음 · 거부 | #E5E1F2 | #43357A |
| 한도 초과 · 생성 실패 | #DCE6F2 | #1F3F66 |
| 생성 전 · 검증 전 | #ECEDEA | #4A4F57 |

배지: `font-size 11px`(목록) / `12px`(표), `padding 2px 8px`, `border-radius 999px`, `white-space nowrap`.

### 타이포그래피
글꼴: IBM Plex Sans KR(400·500·600), IBM Plex Mono(400·500). Google Fonts, `display=swap`. 본문 기본은 `15px / line-height 1.6`.
Mono 글꼴 스택은 `'IBM Plex Mono', 'IBM Plex Sans KR', monospace`다. Plex Mono에는 한글이 없어서, Mono 자리의 한글(헤더 부제, 칩 "모델 {N}개", "3분 34초")이 시스템 고정폭 글꼴로 떨어지지 않게 한다.

| 용도 | 스타일 |
|---|---|
| 소개 탭 큰 제목 | 44px, 600, line-height 1.25, letter-spacing -0.025em |
| 페이지 제목 (h1) | 28px, 600, letter-spacing -0.02em |
| 사이트 이름 | 20px, 600, letter-spacing -0.01em |
| 섹션 제목 (h2) | 18px, 600 |
| 카드 제목 (h3), 목록 제목 | 14~15px, 600 |
| 본문 | 15px, `--text-body` |
| 보조 문구, 버튼 | 13px (버튼은 500) |
| 메타 정보, 표 머리 | 12px |
| 숫자·날짜·식별자·칩 | IBM Plex Mono 12~13px |
| 작은 라벨 (What / How / Caution, "AI 모델 결과물 비교") | Mono 12~13px, `--accent` |

### 둥글기
| 컴포넌트 | 값 |
|---|---|
| 카드, 실행 영역 카드, 표 컨테이너 | 14px |
| 모델 목록 버튼, 안내 박스, 점선 범례, 소개 탭 큰 버튼 | 10px |
| 탭 링크, 작은 버튼(복사·다시 시작·새 창에서 열기) | 8px |
| 배지, 칩 | 999px |

## 공통 레이아웃

- 콘텐츠 최대 폭 1200px, 좌우 여백 32px(휴대폰 16px). 정렬은 왼쪽 정렬이다.
- 섹션 간격 24px, 카드 간 16px, 목록 항목 간 6px.
- **헤더**: 흰 바탕에 아래쪽 1px `--border`. 왼쪽에 사이트 이름과 부제(Mono 13px `--text-muted`), 오른쪽에 탭 4개(소개·결과·비교표·프롬프트). 페이지가 있는 탭만 둔다(ADR-024 — phase 5에서 4개가 모두 생겼다). 탭은 `padding 10px 16px`(휴대폰은 `10px 12px`, 폭 320px에서도 탭 4개가 한 줄), 현재 탭은 `--nav-active-bg` 바탕에 `aria-current="page"`. 좁으면 줄바꿈한다.
- **카드**: `--surface` 바탕, 1px `--border`, 14px 둥글기, `padding 16px`. 그림자는 없다.
- **버튼**: 작은 버튼은 13px/500, `padding 8px 12px`, `min-height 36px`, 1px `--border-strong`, 흰 바탕, `--accent` 글자다. 주 버튼(소개 탭 "결과 보러 가기")은 `--accent` 바탕에 흰 글자, `padding 12px 20px`, 10px 둥글기다. 보조 큰 버튼은 흰 바탕에 `--border-strong`.
- **칩**: Mono 12px, `padding 4px 10px`, 1px `--border-strong`, 999px.
- **표**: 컨테이너는 카드 스타일 + `overflow-x: auto`, 표는 `min-width 760px; border-collapse: collapse`. th·td는 `padding 12px 14px`, 아래쪽 1px `--divider`, 14px. th는 12px/600 `--text-body`, `--surface-muted` 바탕, nowrap. 모델명 칸은 600·nowrap, 숫자 칸은 Mono 13px.
- **포커스**: 모든 상호작용 요소에 보이는 포커스 링(`outline 2px solid var(--accent)`, offset 2px). 키보드만으로 모델을 고를 수 있어야 한다.
- **애니메이션**: 없다. 결과물 iframe만 움직인다.

## 탭별 화면

### 결과 탭 (`/`, 시안 Main.dc.html — A안)
- 상단: h1 + 설명 + 칩 3개(`season-tree-v1`, `모델 {N}개`, `모델당 1회 생성(빈 화면은 다시)`).
- 두 열(`flex-wrap`): 왼쪽 목록(`flex 1 1 280px`, 최대 340px), 오른쪽 결과(`flex 999 1 560px`).
- **첫 선택**: 목록 순서에서 결과물이 있는 첫 모델, 하나도 없으면 맨 위 모델(ADR-025). 빌드 때 정해 HTML에 넣어서 스크립트가 돌기 전에도 그 모델이 보인다.
- **모델 목록**: 제목 "모델"과 오른쪽 "출시일 최신순"(12px muted). 각 항목은 `<button>`(`min-height 56px`, `padding 10px 14px`, 10px 둥글기)이다. 왼쪽에 표시명(15px/600)과 "회사 · 생성 도구"(12px muted), 오른쪽에 출시일(Mono 12px)과 상태 배지. 선택된 항목은 `--surface-selected` 바탕에 2px `--accent` 테두리, `aria-pressed="true"`. 목록 아래 점선(1px dashed `--border-strong`) 범례 상자 "상태 표시"에 모든 라벨 배지를 둔다.
- **실행 카드**: 머리 줄에 표시명(600) + "회사 · 도구로 생성 · YYYY-MM-DD 출시"(12px muted), 오른쪽에 [다시 시작] [새 창에서 열기] 작은 버튼. 아래 실행 영역은 `aspect-ratio 16 / 10`, `--viewer-bg`이고 iframe이 영역을 가득 채운다(`border 0`, `title`은 COPY). 샌드박스 속성은 ARCHITECTURE "사이트".
- **재생성 안내 박스**(ADR-032): 버린 결과물이 있는 모델(다시 생성·수정)을 고르면 실행 카드 바로 위에 둔다. 비교표 비용 안내와 같은 안내 박스 스타일(`--notice-bg`/`--notice-text`, 10px 둥글기, `padding 12px 16px`, 14px)이고, 첫 줄은 600, 앞선 생성 줄은 13px. 커밋 해시는 Mono(줄과 같은 13px). 첫 줄과 줄 목록 간격 4px, 줄끼리 2px, 박스와 실행 카드 간격은 결과 열의 gap 16px(phase 6 구현 수치). 버린 결과물이 없는 모델을 고르면 숨긴다(모델 전환 때 함께 바뀐다). 경고색(빨강·노랑)은 쓰지 않는다 — 잘못이 아니라 기록 공개다.
- **결과물이 없을 때**: 실행 영역에 라벨 이유 문구(COPY "결과물이 없을 때")를 `--viewer-title`로 가운데 보여주고, 버튼 두 개는 숨긴다. 원문이 있는 라벨이면 실행 카드 아래에 "응답 원문" 카드를 둔다. `<pre>`(Mono 13px, `white-space: pre-wrap`, `max-height 480px`, `overflow auto`)이고, 모델을 고를 때 불러온다.
- **아래 카드 두 개**(`grid auto-fit minmax(260px, 1fr)`, gap 16px):
  - "요구사항 판정": 장면·계절 순환·계절 모습·계절 이름 행(왼쪽 이름, 오른쪽 ✓ 충족 / △ 부분 충족 / ✗ 미충족 / 판정 전 / —). 아래 구분선 다음에 판정 메모(13px `--text-body`). 메모가 없으면 줄을 생략한다.
  - "생성 기록": 결과, 조건 검사, 에러 수(ADR-026), 토큰 (입력 / 출력), 비용 (정가 기준), 걸린 시간. 값은 Mono 13px `--text-strong`.
- **휴대폰(폭 < 768px)**: 모델 목록을 `<label>모델</label><select>`(옵션: "표시명 · 상태")로 바꾸고 범례 상자는 결과 아래로 보낸다. 실행 영역은 폭 100%를 유지한다. 선택기는 `min-height 44px`, `padding 10px 12px`, 15px, 10px 둥글기, 1px `--border-strong`, 라벨 15px/600, 라벨과 선택기 간격 8px. 목록(버튼)과 선택기는 HTML에 둘 다 있고 CSS로 전환한다(`aside`를 `display: contents`로 풀어 범례 상자만 `order`로 결과 아래에 보낸다). 설명 문구는 `span[data-screen]` 두 벌 중 하나만 보인다(COPY).

### 비교표 탭 (`/compare/`, 시안 Compare.dc.html)
- h1 "비교표" + 설명.
- 표 1 "수록 모델": 모델, 회사, 출시일, 생성 도구, 결과(배지), 생성 횟수(Mono 13px, `3회 · 수정 1회`처럼, 버린 결과물이 있는 모델은 값 옆 ¶ — ADR-032), 파일 크기, three.js 버전. 표 아래 각주 한 줄 ¶(표 2 각주와 같은 스타일).
- 표 2 "생성 기록": 표 위에 안내 박스(`--notice-bg`, 10px 둥글기, `padding 12px 16px`, 14px)로 비용 안내를 둔다. 열은 모델, 입력 토큰(Claude Code·Codex 행에 §), 출력 토큰(Codex 행에 †), 그중 추론(Google 행에 ‡), 비용 (정가 기준), 걸린 시간, 재시도. 표 아래 각주 세 줄(†‡§ 순서, 12~13px `--text-muted`, 기호는 `--footnote-mark`).
- 표 3 "요구사항과 검증": 모델, 장면, 계절 순환, 계절 모습, 계절 이름, 조건 검사, 에러 수. 아래 범례 줄과 "판정 기준 보기" 링크(`/prompt/#judge`).

### 프롬프트 탭 (`/prompt/`, 시안 Prompt.dc.html)
- h1 "프롬프트" + 설명.
- 두 열: 왼쪽 원문 카드(머리에 `season-tree-v1` 칩과 [복사] 버튼 → 클립보드에 원문 그대로, 복사 후 2초간 "복사됨"). 본문은 `prompts/season-tree-v1.md`를 렌더링한다(목록은 `ul`, `padding-left 20px`, gap 6px). 오른쪽 "생성 조건" 카드에는 라벨/값 행 6개(횟수·추론 강도·출력 상한·생성 도구·재시도·시스템 프롬프트, COPY)를 `--divider-soft` 구분선으로 나눈다.
- 아래 "판정 기준"(`id="judge"`): 설명 + 표(요구사항, ✓ 충족, △ 부분 충족, ✗ 미충족). 내용은 `prompts/season-tree-v1.judging.md`의 표.

### 소개 탭 (`/intro/`, 시안 Intro.dc.html)
- 히어로: 작은 라벨, 44px 제목, 문단, 버튼 3개(주 버튼 "결과 보러 가기", 보조 "비교표 보기"·"프롬프트 전문"), 칩 3개.
- 카드 3개(`grid auto-fit minmax(280px, 1fr)`): 작은 라벨(What / How / Caution) + h2 18px + 본문.
- 수록 기준: 기준 문단 + "대상에서 뺀 모델" 목록(모델명 / 사유).
- phase 5 구현 수치(시안 기준): 블록 사이 40px, 히어로 위 여백 24px·`max-width 760px`·gap 16px, 주 버튼 15px/500, 카드 `padding 24px`. 휴대폰은 44px 제목을 32px(`line-height 1.3`, `word-break: keep-all`), 블록 간격 32px, 히어로 위 여백 8px로 줄인다. 프롬프트 탭은 두 열이 한 열로 쌓이고 원문 본문 `padding 16px`, 생성 조건 값은 `overflow-wrap: anywhere`. 비교표 표 컨테이너는 카드 스타일에 `padding 0`이고 마지막 행 아래 구분선이 없다.

### 새 창 래퍼 (`/view/<slug>/`)
- 화면 전체(`100vw × 100vh`, 여백 없음, 바탕 `--viewer-bg`)를 결과물 iframe 하나로 채운다(샌드박스는 결과 탭과 같다, ARCHITECTURE "사이트"). 다른 UI는 없고, `<title>`만 "<표시명> — One Prompt Bench"로 한다.

## 아이콘
- 쓰지 않는 것이 기본이다. 필요하면 인라인 SVG(stroke 1.5)로 넣고, 둥근 배경 상자로 감싸지 않는다.
