import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** All test scratch data stays inside the repo under .tmp/ (gitignored). */
const TMP_ROOT = path.join(process.cwd(), '.tmp', 'test');

export interface TestEnv {
  base: string;
  /** Fake $HOME injected via SKILLPKG_HOME so tests never touch real agent dirs. */
  home: string;
  cleanup(): void;
}

export function makeTestEnv(name: string): TestEnv {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const base = fs.mkdtempSync(path.join(TMP_ROOT, `${name}-`));
  const home = path.join(base, 'home');
  fs.mkdirSync(home, { recursive: true });
  const prevHome = process.env.SKILLPKG_HOME;
  process.env.SKILLPKG_HOME = home;
  delete process.env.SKILLPKG_ROOT;
  return {
    base,
    home,
    cleanup() {
      if (prevHome === undefined) delete process.env.SKILLPKG_HOME;
      else process.env.SKILLPKG_HOME = prevHome;
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

export interface SkillFixture {
  name?: string;
  description?: string;
  body?: string;
}

/** Create a skill directory with a SKILL.md; omit name/description to vary frontmatter. */
export function writeSkill(dir: string, opts: SkillFixture = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  if (opts.name !== undefined) lines.push(`name: ${opts.name}`);
  if (opts.description !== undefined) lines.push(`description: ${opts.description}`);
  const front = lines.length ? `---\n${lines.join('\n')}\n---\n\n` : '';
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `${front}# ${opts.name ?? path.basename(dir)}\n\n${opts.body ?? 'Do the thing.'}\n`,
    'utf8',
  );
  return dir;
}

export function run(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true });
}

/** Create a git repo with one initial commit of all current files. Returns its path. */
export function makeGitRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  run(dir, 'git', ['init', '-b', 'main']);
  run(dir, 'git', ['add', '-A']);
  run(dir, 'git', ['-c', 'user.name=tester', '-c', 'user.email=tester@example.com', 'commit', '-m', 'init', '--allow-empty']);
  return dir;
}

export function gitCommit(dir: string, message: string): void {
  run(dir, 'git', ['add', '-A']);
  run(dir, 'git', ['-c', 'user.name=tester', '-c', 'user.email=tester@example.com', 'commit', '-m', message]);
}

/** file:// URL for cloning a local repo (exercises the real git clone path offline). */
export function fileUrl(dir: string): string {
  return pathToFileURL(path.resolve(dir)).href;
}
