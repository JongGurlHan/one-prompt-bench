import { Inject, Injectable } from '@nestjs/common';
import type { Ask } from '../system/ask.js';
import type { Confirm } from '../system/confirm.js';
import { ASK, CLOCK, CONFIRM, OUTPUT, REPO_ROOT, type Clock, type Output } from '../tokens.js';
import { runJudge, type JudgeOptions } from './judge.js';

/** `judge` 명령. 주입받은 입력·확인·시계·출력을 judge.ts의 runJudge에 넘기기만 하는 얇은 층 */
@Injectable()
export class JudgeService {
  constructor(
    @Inject(REPO_ROOT) readonly repoRoot: string,
    @Inject(ASK) readonly ask: Ask,
    @Inject(CONFIRM) readonly confirm: Confirm,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(OUTPUT) readonly out: Output,
  ) {}

  /** exit code를 돌려준다 */
  async judge(opts: JudgeOptions): Promise<number> {
    return runJudge(opts, {
      repoRoot: this.repoRoot,
      ask: this.ask,
      confirm: this.confirm,
      out: this.out,
      now: () => this.clock.now(),
    });
  }
}
