// 테스트용 가짜 CLI (test/cli-process.test.ts가 node로 띄운다). 생성 도구를 흉내 내지 않고 프로세스 동작만 만든다.
// 사용: node fake-cli.mjs <동작> [인자…]
import { spawn } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';

const [mode, ...rest] = process.argv.slice(2);
const hold = () => setInterval(() => {}, 1000);
const GRANDCHILD = ['-e', 'setInterval(() => {}, 1000)'];

/** cwd에 pids.json을 쓴다 (테스트가 읽다 만 파일을 보지 않게 이름을 바꿔서) */
function writePids(pids) {
  writeFileSync('pids.json.tmp', JSON.stringify(pids));
  renameSync('pids.json.tmp', 'pids.json');
}

switch (mode) {
  case 'echo': // stdin을 바이트 그대로 stdout으로
    process.stdin.pipe(process.stdout);
    break;
  case 'args': // <동작> 뒤의 인자를 JSON 배열로
    process.stdout.write(JSON.stringify(rest));
    break;
  case 'env': // 받은 환경변수 이름을 JSON 배열로
    process.stdout.write(JSON.stringify(Object.keys(process.env)));
    break;
  case 'cwd':
    process.stdout.write(process.cwd());
    break;
  case 'exit': // exit <code> <stdout> <stderr>
    process.stdout.write(rest[1] ?? '');
    process.stderr.write(rest[2] ?? '');
    process.exitCode = Number(rest[0]);
    break;
  case 'no-stdin': // stdin을 읽지 않고 바로 끝난다
    process.stdout.write('done');
    break;
  case 'flood': // flood <bytes>: stdout에 쓰고 끝나지 않는다
    process.stdout.write(Buffer.alloc(Number(rest[0]), 'x'));
    hold();
    break;
  case 'tree': { // 손자를 띄우고(stdout·stderr를 물려줌) pid를 알린 뒤 둘 다 끝나지 않는다
    const grandchild = spawn(process.execPath, GRANDCHILD, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    writePids({ child: process.pid, grandchild: grandchild.pid });
    hold();
    break;
  }
  case 'escape': { // 프로세스 트리·그룹 밖 손자(detached)가 stdout·stderr를 쥐고, 자식은 바로 끝난다
    const grandchild = spawn(process.execPath, GRANDCHILD, {
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    grandchild.unref();
    writePids({ child: process.pid, grandchild: grandchild.pid });
    break;
  }
  default:
    process.stderr.write(`unknown mode: ${mode}\n`);
    process.exitCode = 99;
}
