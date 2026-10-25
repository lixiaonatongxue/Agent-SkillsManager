import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * All agent homes resolve under this directory. Overridable via SKILLPKG_HOME
 * so tests and smoke runs never touch the real ~/.claude / ~/.zcode / ~/.codex.
 */
export function homeDir(): string {
  return process.env.SKILLPKG_HOME || os.homedir();
}

/** Directory where skillpkg keeps its own state (user lockfile, clone cache). */
export function skillpkgDir(): string {
  return path.join(homeDir(), '.skillpkg');
}

export function userLockfile(): string {
  return path.join(skillpkgDir(), 'skills.lock.json');
}

export function projectLockfile(repoRoot: string): string {
  return path.join(repoRoot, 'skills.lock.json');
}

/**
 * Walk up from `start` looking for a project marker (.git or skills.lock.json).
 * `stopAt` bounds the walk (tests bound it to their scratch dir so the host
 * repo's .git is never found). SKILLPKG_ROOT overrides discovery entirely.
 */
export function findProjectRoot(start: string = process.cwd(), stopAt?: string): string | null {
  if (process.env.SKILLPKG_ROOT) return path.resolve(process.env.SKILLPKG_ROOT);
  const stop = path.resolve(stopAt ?? path.parse(path.resolve(start)).root);
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'skills.lock.json'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (dir === stop) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
