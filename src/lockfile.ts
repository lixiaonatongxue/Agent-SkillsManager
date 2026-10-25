import fs from 'node:fs';
import path from 'node:path';
import type { Scope } from './agents/base.js';

export interface LockEntry {
  name: string;
  /** git URL or absolute local path the skill was installed from */
  source: string;
  /** subdirectory inside the source containing this skill's SKILL.md ('' = repo root) */
  path: string;
  /** short commit hash for git sources, null for local paths */
  commit: string | null;
  installedAt: string;
  updatedAt?: string;
  /** adapter ids the skill was installed for */
  agents: string[];
  scope: Scope;
  license: string | null;
  description?: string;
  /** true when the installed directories link into ~/.skillpkg/cache instead of copying */
  link?: boolean;
}

export interface Lockfile {
  version: 1;
  skills: LockEntry[];
}

export function emptyLockfile(): Lockfile {
  return { version: 1, skills: [] };
}

export function readLockfile(file: string): Lockfile {
  if (!fs.existsSync(file)) return emptyLockfile();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`lockfile ${file} is not valid JSON: ${(err as Error).message}`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    !Array.isArray((parsed as { skills?: unknown }).skills)
  ) {
    throw new Error(`lockfile ${file} has an unexpected shape (expected version 1 with a "skills" array)`);
  }
  return parsed as Lockfile;
}

export function writeLockfile(file: string, lock: Lockfile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  lock.skills.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

export function findEntry(lock: Lockfile, name: string): LockEntry | null {
  return lock.skills.find((s) => s.name === name) ?? null;
}

export function upsertEntry(lock: Lockfile, entry: LockEntry): void {
  const i = lock.skills.findIndex((s) => s.name === entry.name);
  if (i >= 0) lock.skills[i] = entry;
  else lock.skills.push(entry);
}

export function removeEntry(lock: Lockfile, name: string): LockEntry | null {
  const i = lock.skills.findIndex((s) => s.name === name);
  if (i < 0) return null;
  return lock.skills.splice(i, 1)[0];
}
