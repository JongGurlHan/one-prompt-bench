import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { parseCommand, USAGE, type Command } from './cli.js';

/* ────────────────────────────────────────────────────────────
 * 파이프라인 진입점. 명령 파싱 → Nest 컨텍스트(HTTP 서버 없음) → 명령 실행만 하는 얇은 층.
 * 이 파일 이름(main.ts)은 .claude/hooks/block_dangerous.py의 ENTRY 패턴과 묶여 있다. 바꾸지 마라.
 * ──────────────────────────────────────────────────────────── */

/** Nest 컨텍스트가 필요한 명령 (gen·smoke — step 3·4가 추가) */
type RunCommand = Exclude<Command, { kind: 'help' | 'usage_error' }>;

async function execute(app: INestApplicationContext, command: RunCommand): Promise<number> {
  // 명령이 추가되면 여기서 command.kind로 나눠 app.get(...)한 서비스에 넘긴다
  const unhandled: never = command;
  throw new Error(`처리하지 않은 명령: ${JSON.stringify(unhandled)}`);
}

const command = parseCommand(process.argv.slice(2));
if (command.kind === 'help') {
  console.log(USAGE);
} else if (command.kind === 'usage_error') {
  console.error(`${command.message}\n\n${USAGE}`);
  process.exitCode = 1;
} else {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    process.exitCode = await execute(app, command);
  } finally {
    await app.close();
  }
}
