import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Scope } from './agents/base.js';
import { getAdapter } from './agents/index.js';
import { cloneShallow, headInfo } from './gitutil.js';
import { findEntry, readLockfile, upsertEntry, writeLockfile } from './lockfile.js';
import { skillpkgDir } from './paths.js';
import { pathExists, placeDirectory, todayISO } from './fsutil.js';
import { parseSkillMd } from './skillmd.js';
import { resolveSource } from './source.js';

export interface DiscoveredSkill {
  name: string;
  description?: string;
  /** subdirectory inside the source tree ('' when SKILL.md sits at the root) */
  relPath: string;
  warnings: string[];
}

export interface InstallOptions {
  agentIds: string[];
  scope: Scope;
  /** project repository root, required when scope === 'project' */
  repoRoot?: string;
  /** pick specific skills (by name or relPath) when the source holds several */
  skillNames?: string[];
  /** install every skill the source contains */
  all?: boolean;
  /** link skill directories to the clone instead of copying them */
  link?: boolean;
  /** overwrite existing directories that skillpkg does not manage */
  force?: boolean;
  /** lockfile of the target scope */
  lockfile: string;
  /** where throwaway clones go; tests keep them inside the repo scratch dir */
  tmpBase?: string;
}

export interface InstalledSkill {
  name: string;
  relPath: string;
  agents: string[];
  license: string | null;
  commit: string | null;
  warnings: string[];
  mode: 'copy' | 'link';
  replaced: boolean;
}

export interface InstallResult {
  source: string;
  kind: 'git' | 'local';
  commit: string | null;
  skills: InstalledSkill[];
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.skillpkg']);

/** Find every skill (directory with a SKILL.md) in a source tree. */
export function discoverSkills(treeRoot: string): DiscoveredSkill[] {
  const found: DiscoveredSkill[] = [];
  const stack: string[] = [treeRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const skillFile = path.join(dir, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      const parsed = parseSkillMd(skillFile);
      if (parsed) {
        found.push({
          name: parsed.name,
          description: parsed.description,
          relPath: path.relative(treeRoot, dir).split(path.sep).join('/'),
          warnings: parsed.warnings,
        });
      }
      // A skill directory is treated as a leaf; nested skills are not collected.
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      stack.push(path.join(dir, entry.name));
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
}

/**
 * Install skill(s) from a git repo or local directory into the target agents,
 * writing an entry per skill into the scope's lockfile.
 */
export async function install(sourceInput: string, opts: InstallOptions): Promise<InstallResult> {
  if (opts.scope === 'project' && !opts.repoRoot) {
    throw new Error('repoRoot is required for project-scope installs');
  }
  const adapters = opts.agentIds.map(getAdapter);
  const spec = resolveSource(sourceInput);

  let treeRoot: string;
  let commit: string | null = null;
  let tmpDir: string | null = null;
  if (spec.kind === 'git') {
    const dest = opts.link ? cloneCacheDir(spec.url) : fs.mkdtempSync(path.join(opts.tmpBase ?? os.tmpdir(), 'skillpkg-clone-'));
    if (!opts.link) tmpDir = dest;
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await cloneShallow(spec.url, dest);
    treeRoot = dest;
    commit = (await headInfo(dest))?.commit ?? null;
  } else {
    treeRoot = spec.path;
  }

  try {
    const discovered = discoverSkills(treeRoot);
    if (discovered.length === 0) {
      throw new Error(`no skill found in "${sourceInput}" (no directory contains a SKILL.md)`);
    }

    const selected = selectSkills(discovered, opts);

    const lock = readLockfile(opts.lockfile);
    const results: InstalledSkill[] = [];
    for (const skill of selected) {
      const srcDir = path.join(treeRoot, skill.relPath);
      const license = detectLicense(srcDir, treeRoot);
      let replaced = false;
      const modes: Array<'copy' | 'link'> = [];
      for (const adapter of adapters) {
        const destRoot = adapter.scopeDir(opts.scope, opts.repoRoot);
        const dest = path.join(destRoot, skill.name);
        fs.mkdirSync(destRoot, { recursive: true });
        if (pathExists(dest)) {
          if (!findEntry(lock, skill.name) && !opts.force) {
            throw new Error(
              `${dest} already exists but is not managed by skillpkg (not in the lockfile); re-run with --force to overwrite it`,
            );
          }
          fs.rmSync(dest, { recursive: true, force: true });
          replaced = true;
        }
        modes.push(placeDirectory(srcDir, dest, !!opts.link));
      }
      const mode: 'copy' | 'link' = modes.includes('link') && modes.every((m) => m === 'link') ? 'link' : 'copy';
      if (opts.link && mode === 'copy') {
        skill.warnings.push('link mode requested but symlinking failed; fell back to copying');
      }

      upsertEntry(lock, {
        name: skill.name,
        source: spec.kind === 'git' ? spec.url : spec.path,
        path: skill.relPath,
        commit,
        installedAt: todayISO(),
        agents: opts.agentIds.slice(),
        scope: opts.scope,
        license,
        description: skill.description,
        link: opts.link ? true : undefined,
      });
      results.push({
        name: skill.name,
        relPath: skill.relPath,
        agents: opts.agentIds.slice(),
        license,
        commit,
        warnings: skill.warnings,
        mode,
        replaced,
      });
    }
    writeLockfile(opts.lockfile, lock);
    return {
      source: spec.kind === 'git' ? spec.url : spec.path,
      kind: spec.kind,
      commit,
      skills: results,
    };
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function selectSkills(discovered: DiscoveredSkill[], opts: InstallOptions): DiscoveredSkill[] {
  let selected = discovered;
  if (opts.skillNames && opts.skillNames.length > 0) {
    const wanted = new Set(opts.skillNames);
    selected = discovered.filter((s) => wanted.has(s.name) || wanted.has(s.relPath));
    if (selected.length === 0) {
      throw new Error(
        `none of the requested skills [${[...wanted].join(', ')}] exist in the source; available: ${discovered.map((s) => s.name).join(', ')}`,
      );
    }
  } else if (discovered.length > 1 && !opts.all) {
    throw new Error(
      `the source contains ${discovered.length} skills; pick one or more with --skill <name>, or pass --all to install them all. ` +
        `Available: ${discovered.map((s) => `${s.name} (${s.relPath || 'repo root'})`).join(', ')}`,
    );
  }
  const seen = new Set<string>();
  for (const skill of selected) {
    if (seen.has(skill.name)) throw new Error(`duplicate skill name "${skill.name}" in selection; refusing ambiguous install`);
    seen.add(skill.name);
  }
  return selected;
}

/** Persistent clone location for --link installs (one clone, many agents). */
export function cloneCacheDir(url: string): string {
  const safe = url
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 60);
  return path.join(skillpkgDir(), 'cache', safe);
}

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING'];

/** Best-effort license detection from the skill dir, then the repo root. */
export function detectLicense(...dirs: string[]): string | null {
  for (const dir of dirs) {
    for (const name of LICENSE_FILES) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      const head = fs.readFileSync(file, 'utf8').slice(0, 600);
      if (/MIT License/i.test(head)) return 'MIT';
      const apache = head.match(/Apache License[^]*?Version (\d+\.\d+)/i);
      if (apache) return `Apache-${apache[1]}`;
      if (/Mozilla Public License/i.test(head)) return 'MPL';
      if (/GNU Lesser General Public License/i.test(head)) return 'LGPL';
      if (/GNU General Public License/i.test(head)) return 'GPL';
      if (/BSD/.test(head)) return 'BSD';
      if (/ISC License/i.test(head)) return 'ISC';
      return 'custom';
    }
  }
  return null;
}
