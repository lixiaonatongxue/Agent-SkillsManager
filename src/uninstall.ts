import fs from 'node:fs';
import path from 'node:path';
import { ADAPTERS, getAdapter } from './agents/index.js';
import type { Scope } from './agents/base.js';
import { pathExists } from './fsutil.js';
import { findEntry, readLockfile, removeEntry, writeLockfile } from './lockfile.js';

export interface UninstallOptions {
  /** lockfile of the scope to uninstall from */
  lockfile: string;
  scope: Scope;
  /** project root, required for project-scope entries */
  repoRoot?: string;
  /** allow removing a skill that is not in the lockfile (matched by name) */
  force?: boolean;
}

export interface UninstallResult {
  name: string;
  scope: Scope;
  removedDirs: string[];
}

/**
 * Remove a skill by name: delete its directory from every agent listed in the
 * lockfile entry, then drop the entry. Without a lockfile entry, --force scans
 * all agents' skill directories for a matching folder.
 */
export function uninstall(name: string, opts: UninstallOptions): UninstallResult {
  if (opts.scope === 'project' && !opts.repoRoot) {
    throw new Error('repoRoot is required for project-scope uninstalls');
  }
  const lock = readLockfile(opts.lockfile);
  const entry = findEntry(lock, name);

  if (entry) {
    const removedDirs: string[] = [];
    for (const agentId of entry.agents) {
      const dir = path.join(getAdapter(agentId).scopeDir(entry.scope, opts.repoRoot), name);
      if (pathExists(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        removedDirs.push(dir);
      }
    }
    removeEntry(lock, name);
    writeLockfile(opts.lockfile, lock);
    return { name, scope: entry.scope, removedDirs };
  }

  if (!opts.force) {
    throw new Error(
      `"${name}" is not in the lockfile (${opts.lockfile}); ` +
        'if you are sure it was installed manually, re-run with --force to delete matching directories',
    );
  }

  const removedDirs: string[] = [];
  for (const adapter of ADAPTERS) {
    const dir = path.join(adapter.scopeDir(opts.scope, opts.repoRoot), name);
    if (pathExists(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removedDirs.push(dir);
    }
  }
  if (removedDirs.length === 0) {
    throw new Error(`no directory named "${name}" found in any agent skills directory (${opts.scope} scope)`);
  }
  return { name, scope: opts.scope, removedDirs };
}
