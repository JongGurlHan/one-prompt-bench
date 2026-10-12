import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkResults } from '../src/results.js';

/**
 * npm run check:results — results/ 전수 검사 (배포 게이트, docs/DATA.md "check:results")
 * 데이터 루트는 레포 루트이고, OPB_DATA_ROOT가 있으면 그 경로를 검사한다.
 * 이슈가 있으면 "경로: 이유"를 한 줄씩 출력하고 exit 1.
 */
const dataRoot = path.resolve(process.env.OPB_DATA_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));

const issues = await checkResults(dataRoot);
if (issues.length > 0) {
  for (const issue of issues) console.error(`${issue.path}: ${issue.message}`);
  console.error(`FAIL check:results: ${issues.length} issue(s) in ${dataRoot}`);
  process.exitCode = 1;
} else {
  console.log(`OK  check:results: ${await countResultFolders(dataRoot)} result folders in ${dataRoot}`);
}

/** 이슈가 없을 때 results/ 아래 항목은 모두 결과 폴더다 */
async function countResultFolders(root: string): Promise<number> {
  try {
    return (await readdir(path.join(root, 'results'), { withFileTypes: true })).filter((e) => e.isDirectory()).length;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
}
