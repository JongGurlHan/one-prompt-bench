import { Module } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { createAdapterRegistry } from './adapters/registry.js';
import { defaultRepoRoot } from './config/config.js';
import { BatchService } from './generation/batch.service.js';
import { GenerationRunner } from './generation/generation-runner.js';
import { SmokeService } from './generation/smoke.service.js';
import { createTerminalConfirm } from './system/confirm.js';
import { createGitClient } from './system/git.js';
import { ADAPTERS, CLOCK, CONFIRM, GIT, OUTPUT, REPO_ROOT, VALIDATOR, type Clock, type Output } from './tokens.js';
import { PlaceholderValidator } from './validation/validator.js';

const systemClock: Clock = {
  now: () => new Date(),
  sleep: async (ms) => {
    await delay(ms);
  },
};

const consoleOutput: Output = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

// 컨텍스트를 만들 때는 파일·프로세스를 건드리지 않는다: .env는 BatchService.gen·SmokeService.smoke가 실행할 때 읽고,
// git·어댑터는 실제로 쓸 때 부르거나 만든다
@Module({
  providers: [
    { provide: CLOCK, useValue: systemClock },
    { provide: REPO_ROOT, useFactory: defaultRepoRoot },
    { provide: ADAPTERS, useFactory: createAdapterRegistry },
    { provide: GIT, useFactory: (repoRoot: string) => createGitClient(repoRoot), inject: [REPO_ROOT] },
    { provide: CONFIRM, useFactory: () => createTerminalConfirm() },
    { provide: OUTPUT, useValue: consoleOutput },
    { provide: VALIDATOR, useClass: PlaceholderValidator }, // phase 2: Playwright 검증기
    GenerationRunner,
    BatchService,
    SmokeService,
  ],
})
export class AppModule {}
