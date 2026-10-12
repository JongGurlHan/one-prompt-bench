import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_RUN_POLICY,
  runGeneration,
  type GenerationRecord,
  type ProviderAdapter,
  type RunInput,
  type RunPolicy,
} from '@opb/core';
import { CLOCK, type Clock } from '../tokens.js';

/** core Runner를 Nest에 연결하는 얇은 층. 재시도·저장 로직은 core에 있고, 여기서는 시계만 주입한다. */
@Injectable()
export class GenerationRunner {
  constructor(@Inject(CLOCK) readonly clock: Clock) {}

  run(adapter: ProviderAdapter, input: RunInput, policy: RunPolicy = DEFAULT_RUN_POLICY): Promise<GenerationRecord> {
    return runGeneration(adapter, input, policy, this.clock);
  }
}
