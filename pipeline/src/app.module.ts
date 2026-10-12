import { Module } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { GenerationRunner } from './generation/generation-runner.js';
import { CLOCK, type Clock } from './tokens.js';

const systemClock: Clock = {
  now: () => new Date(),
  sleep: async (ms) => {
    await delay(ms);
  },
};

@Module({
  providers: [{ provide: CLOCK, useValue: systemClock }, GenerationRunner],
})
export class AppModule {}
