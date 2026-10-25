import fs from 'node:fs';
import path from 'node:path';

// Hard guard, run before every test file: SKILLPKG_HOME must point into this
// repo's .tmp scratch space so no test can ever touch the real ~/.claude /
// ~/.zcode / ~/.codex, even if a test file forgets to call makeTestEnv or
// another file's cleanup deleted the variable mid-suite.
const scratch = path.join(process.cwd(), '.tmp');
const guardHome = path.join(scratch, 'test-home');

function isInsideScratch(dir: string): boolean {
  const rel = path.relative(scratch, path.resolve(dir));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

if (!process.env.SKILLPKG_HOME || !isInsideScratch(process.env.SKILLPKG_HOME)) {
  process.env.SKILLPKG_HOME = guardHome;
}
fs.mkdirSync(process.env.SKILLPKG_HOME, { recursive: true });
