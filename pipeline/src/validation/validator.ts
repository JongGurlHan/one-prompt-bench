import { Inject, Injectable } from '@nestjs/common';
import type { Validation } from '@opb/core';
import { OUTPUT, REPO_ROOT, type Output } from '../tokens.js';
import { SCREENSHOT_SCHEDULE, validateResult } from './validate-result.js';

/**
 * 검증 (outcome ok인 모델만). meta.json의 validation과 스크린샷을 채우고 기록한 validation을 돌려준다.
 * gen은 생성 직후 부르고 결과는 쓰지 않는다. throw해도 batch는 계속하고 validation은 null로 남는다 (나중에 npm run validate).
 */
export interface Validator {
  validate(slug: string): Promise<Validation>;
}

/**
 * Playwright 검증기 (validate-result.ts). 브라우저는 검증할 때마다 띄우고 끝나면 닫는다 —
 * Nest 컨텍스트를 만들 때는 아무것도 띄우지 않는다.
 */
@Injectable()
export class PlaywrightValidator implements Validator {
  constructor(
    @Inject(REPO_ROOT) readonly repoRoot: string,
    @Inject(OUTPUT) readonly out: Output,
  ) {}

  async validate(slug: string): Promise<Validation> {
    const seconds = Math.round(Math.max(...SCREENSHOT_SCHEDULE.map((s) => s.atMs)) / 1000);
    this.out.log(`  검증: headless Chromium으로 results/${slug}/index.html을 엽니다 (스크린샷까지 약 ${seconds}초)`);
    const validation = await validateResult(this.repoRoot, slug);
    this.out.log(`  검증 완료: ${describeValidation(validation)}`);
    return validation;
  }
}

/** 운영자용 한 줄 요약: loaded · 콘솔 에러 수 · 페이지 에러 수 · 외부 요청 수 (사이트 표시 규칙과 별개) */
export function describeValidation(v: Validation): string {
  return [
    `loaded ${v.loaded}`,
    `콘솔 에러 ${v.consoleErrors.length}`,
    `페이지 에러 ${v.pageErrors.length}`,
    `외부 요청 ${v.externalRequests.length}`,
  ].join(' · ');
}
