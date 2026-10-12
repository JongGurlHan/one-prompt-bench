import { Inject, Injectable } from '@nestjs/common';
import { OUTPUT, REPO_ROOT, VALIDATOR, type Output } from '../tokens.js';
import { runValidate, type ValidateCommandOptions } from './validate.js';
import type { Validator } from './validator.js';

/** `validate` 명령. 주입받은 검증기·출력을 validate.ts의 runValidate에 넘기기만 하는 얇은 층 */
@Injectable()
export class ValidateService {
  constructor(
    @Inject(REPO_ROOT) readonly repoRoot: string,
    @Inject(VALIDATOR) readonly validator: Validator,
    @Inject(OUTPUT) readonly out: Output,
  ) {}

  /** exit code를 돌려준다 */
  async validate(opts: ValidateCommandOptions): Promise<number> {
    return runValidate(opts, { repoRoot: this.repoRoot, validator: this.validator, out: this.out });
  }
}
