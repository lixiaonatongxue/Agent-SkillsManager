import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAdapter } from './agents/index.js';
import { pathExists, placeDirectory, todayISO } from './fsutil.js';
import { cloneShallow, headInfo } from './gitutil.js';
import { cloneCacheDir, detectLicense, discoverSkills } from './install.js';
import { readLockfile, upsertEntry, writeLockfile, type LockEntry } from './lockfile.js';
import { resolveSource } from './source.js';

export interface UpdateTarget {
  /** lockfile the entry belongs to */
  lockfile: string;
  entry: LockEntry;
  /** project root for project-scope entries */
  repoRoot?: string;
  /** where throwaway clones go; tests keep them inside the repo scratch dir */
  tmpBase?: string;
}

export type UpdateOutcome =
  | { name: string; status: 'up-to-date'; commit: string | null }
  | { name: string; status: 'updated'; from: string | null; to: string; subject: string; date: string }
  | { name: string; status: 'refreshed'; from: string }
  | { name: string; status: 'skipped'; reason: string };

/**
 * Bring one lockfile entry to the latest state of its source. Git sources are
 * re-cloned shallowly and compared by commit; local sources are re-copied
 * unconditionally (there is no commit to compare). Linked installs point at
 * the persistent cache clone, which is refreshed in place at the same path so
 * existing links stay valid.
 */
export async function updateEntry(target: UpdateTarget): Promise<UpdateOutcome> {
  const { entry, lockfile } = target;
  const spec = resolveSource(entry.source);

  if (spec.kind === 'local') {
    if (!pathExists(spec.path)) {
      return { name: entry.name, status: 'skipped', reason: `local source ${spec.path} no longer exists` };
    }
    const skill = findSkillIn(spec.path, entry);
    if (!skill) {
      return { name: entry.name, status: 'skipped', reason: `skill "${entry.name}" (at "${entry.path || 'root'}") is no longer in ${spec.path}` };
    }
    const srcDir = path.join(spec.path, skill.relPath);
    placeIntoAgents(srcDir, entry, target.repoRoot);
    updateLockEntry(lockfile, entry, {
      commit: null,
      description: skill.description ?? entry.description,
      license: detectLicense(srcDir, spec.path) ?? entry.license,
    });
    return { name: entry.name, status: 'refreshed', from: spec.path };
  }

  let treeRoot: string;
  let tmpDir: string | null = null;
  if (entry.link) {
    treeRoot = cloneCacheDir(spec.url);
    fs.rmSync(treeRoot, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(treeRoot), { recursive: true });
    await cloneShallow(spec.url, treeRoot);
  } else {
    tmpDir = fs.mkdtempSync(path.join(target.tmpBase ?? os.tmpdir(), 'skillpkg-update-'));
    await cloneShallow(spec.url, tmpDir);
    treeRoot = tmpDir;
  }

  try {
    const head = await headInfo(treeRoot);
    if (head && entry.commit && head.commit === entry.commit) {
      return { name: entry.name, status: 'up-to-date', commit: entry.commit };
    }
    const skill = findSkillIn(treeRoot, entry);
    if (!skill) {
      return {
        name: entry.name,
        status: 'skipped',
        reason: `skill "${entry.name}" (at "${entry.path || 'root'}") is no longer in the latest source`,
      };
    }
    placeIntoAgents(path.join(treeRoot, skill.relPath), entry, target.repoRoot);
    updateLockEntry(lockfile, entry, {
      commit: head?.commit ?? entry.commit,
      description: skill.description ?? entry.description,
      license: detectLicense(path.join(treeRoot, skill.relPath), treeRoot) ?? entry.license,
    });
    return {
      name: entry.name,
      status: 'updated',
      from: entry.commit,
      to: head?.commit ?? '?',
      subject: head?.subject ?? '',
      date: head?.date ?? '',
    };
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Match the locked skill in a source tree by relPath first, then by name. */
function findSkillIn(treeRoot: string, entry: LockEntry) {
  const skills = discoverSkills(treeRoot);
  return skills.find((s) => s.relPath === entry.path) ?? skills.find((s) => s.name === entry.name) ?? null;
}

function placeIntoAgents(srcDir: string, entry: LockEntry, repoRoot?: string): void {
  for (const agentId of entry.agents) {
    const destRoot = getAdapter(agentId).scopeDir(entry.scope, repoRoot);
    const dest = path.join(destRoot, entry.name);
    fs.mkdirSync(destRoot, { recursive: true });
    if (pathExists(dest)) fs.rmSync(dest, { recursive: true, force: true });
    placeDirectory(srcDir, dest, !!entry.link);
  }
}

function updateLockEntry(lockfile: string, entry: LockEntry, changes: Partial<LockEntry>): void {
  const lock = readLockfile(lockfile);
  upsertEntry(lock, { ...entry, ...changes, updatedAt: todayISO() });
  writeLockfile(lockfile, lock);
}
