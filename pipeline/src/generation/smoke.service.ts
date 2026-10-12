import { Inject, Injectable } from '@nestjs/common';
import type { AdapterRegistry } from '../adapters/registry.js';
import { loadConfig, type AppConfig } from '../config/config.js';
import type { GitClient } from '../system/git.js';
import { ADAPTERS, GIT, OUTPUT, REPO_ROOT, type Output } from '../tokens.js';
import { GenerationRunner } from './generation-runner.js';
import { runSmoke, type SmokeOptions } from './smoke.js';

/** `smoke` 명령. 주입받은 I/O를 smoke.ts의 runSmoke에 넘기기만 하는 얇은 층 */
@Injectable()
export class SmokeService {
  constructor(
    @Inject(REPO_ROOT) readonly repoRoot: string,
    @Inject(ADAPTERS) readonly adapters: AdapterRegistry,
    @Inject(GIT) readonly git: GitClient,
    @Inject(OUTPUT) readonly out: Output,
    @Inject(GenerationRunner) readonly runner: GenerationRunner,
  ) {}

  /** exit code를 돌려준다 */
  async smoke(opts: SmokeOptions): Promise<number> {
    // .env는 실행할 때 읽는다 (컨텍스트 생성만으로는 읽지 않는다)
    let config: AppConfig;
    try {
      config = await loadConfig(this.repoRoot);
    } catch (err) {
      this.out.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
    return runSmoke(opts, {
      config,
      env: process.env,
      adapters: this.adapters,
      git: this.git,
      run: (adapter, input, policy) => this.runner.run(adapter, input, policy),
      out: this.out,
      now: () => this.runner.clock.now(),
      nodeVersion: process.version,
    });
  }
}
