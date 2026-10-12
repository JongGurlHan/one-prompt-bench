import { Inject, Injectable } from '@nestjs/common';
import type { AdapterRegistry } from '../adapters/registry.js';
import { loadConfig, type AppConfig } from '../config/config.js';
import type { Confirm } from '../system/confirm.js';
import type { GitClient } from '../system/git.js';
import { ADAPTERS, CONFIRM, GIT, OUTPUT, REPO_ROOT, VALIDATOR, type Output } from '../tokens.js';
import type { Validator } from '../validation/validator.js';
import { runBatch, type BatchOptions } from './batch.js';
import { GenerationRunner } from './generation-runner.js';

/** `gen` 명령. 주입받은 I/O를 batch.ts의 runBatch에 넘기기만 하는 얇은 층 */
@Injectable()
export class BatchService {
  constructor(
    @Inject(REPO_ROOT) readonly repoRoot: string,
    @Inject(ADAPTERS) readonly adapters: AdapterRegistry,
    @Inject(GIT) readonly git: GitClient,
    @Inject(CONFIRM) readonly confirm: Confirm,
    @Inject(VALIDATOR) readonly validator: Validator,
    @Inject(OUTPUT) readonly out: Output,
    @Inject(GenerationRunner) readonly runner: GenerationRunner,
  ) {}

  /** exit code를 돌려준다 */
  async gen(opts: BatchOptions): Promise<number> {
    // .env는 실행할 때 읽는다 (컨텍스트 생성만으로는 읽지 않는다)
    let config: AppConfig;
    try {
      config = await loadConfig(this.repoRoot);
    } catch (err) {
      this.out.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
    return runBatch(opts, {
      config,
      env: process.env,
      adapters: this.adapters,
      git: this.git,
      confirm: this.confirm,
      validator: this.validator,
      run: (adapter, input) => this.runner.run(adapter, input),
      out: this.out,
      nodeVersion: process.version,
    });
  }
}
