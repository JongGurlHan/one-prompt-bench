import { Inject, Injectable } from '@nestjs/common';
import { OUTPUT, type Output } from '../tokens.js';

/**
 * 생성 직후 검증 (outcome ok인 모델만). meta.json의 validation과 스크린샷을 채운다.
 * throw해도 batch는 계속하고 validation은 null로 남는다 (나중에 npm run validate).
 */
export interface Validator {
  validate(slug: string): Promise<void>;
}

/** phase 1 자리표시: 아무것도 하지 않는다. phase 2가 Playwright 검증기로 바꾼다 */
@Injectable()
export class PlaceholderValidator implements Validator {
  constructor(@Inject(OUTPUT) private readonly out: Output) {}

  async validate(slug: string): Promise<void> {
    this.out.log(`  ${slug}: 검증기 없음 — validation은 null로 남는다`);
  }
}
