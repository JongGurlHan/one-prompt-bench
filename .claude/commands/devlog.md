$ARGUMENTS 일차의 개발 일지 초안을 `docs/devlog/day-$ARGUMENTS.md`에 작성하라. (인자가 없으면 가장 최근에 끝난 `phases/dayN-*`의 N을 쓴다.)

개발 일지는 "AI에게 맡긴 것 / 직접 고친 것"이 날마다 남아 AI 활용 역량의 근거가 되는 포트폴리오 자료다. 초안만 쓰고 사람이 검토해 확정한다. **커밋하지 마라.**

## 자료 모으기

1. `phases/day$ARGUMENTS-*/index.json`: 각 step의 `name`·`summary`·`handoff`·`attempts`·`cost_usd`·`num_turns`, phase의 `created_at`·`completed_at`. `attempts`가 1보다 크면 재시도가 있었던 것이다. 같은 폴더의 `step*-attempt*-output.json`(로컬에만 있음)에서 실패 원인을 확인한다.
2. git 기록: phase 기간(`created_at`부터 다음 날 같은 시각 또는 `completed_at` 뒤 사람 작업까지)의 커밋을 모든 브랜치에서 본다 (`git log --all --since=... --until=... --format='%h %ad %s%n%b' --date=iso`). 커밋을 아래처럼 나눈다.
   - **하네스(무인 AI)**: `chore(<phase>): phase plan`, `feat(<phase>): step N — …`, `wip(<phase>): …`, `chore(<phase>): step N output`, `chore(<phase>): mark phase completed`
   - **대화형 AI**: 본문에 `Co-Authored-By: Claude` 트레일러가 있는 커밋
   - **사람**: 그 밖의 커밋 (`data:` 생성 결과 커밋 포함). 사람 커밋은 `git show --stat`으로 무엇을 고쳤는지 확인한다.
3. 생성·판정 결과가 있으면 `results/*/meta.json`의 outcome, `judgment.json` 유무.

## 형식

```md
# N일차

## 한 일
- (그날 동작하게 된 것. 결과 중심 3~6줄. 공개 URL·생성한 모델이 있으면 적는다)

## AI에게 맡긴 것
- (하네스 step별 한 줄: step 이름 — summary, 시도 횟수, 비용·턴 수)
- (대화형 AI에게 시킨 작업)

## 직접 고친 것
- (사람 커밋별: 무엇을 왜 고쳤는지. 커밋 해시)
- (없으면 "없음")

## 막힌 점과 해결
- (재시도·error·blocked가 난 step: 원인 → 해결. 사용 한도로 멈춘 경우 포함)
- (사람이 개입해 해결한 문제)
```

## 규칙

- 기록에 근거한 사실만 쓴다. 추측한 원인은 "(추정)"으로 표시한다.
- "직접 고친 것"과 "막힌 점"에서 기록만으로 알 수 없는 부분은 비워 두지 말고 `<!-- 사람이 채울 것: … -->` 주석으로 질문을 남긴다.
- 루트 `README.md`에 "개발 일지" 절이 있으면 이 일차의 한 줄 요약과 링크를 추가하거나 갱신한다. 없으면 건드리지 않는다.
- 끝나면 사람에게 검토할 부분(주석으로 남긴 질문)을 짧게 알려 준다.
