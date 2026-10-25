import type { AgentAdapter, Scope } from './agents/base.js';
import { ADAPTERS } from './agents/index.js';
import type { Lockfile } from './lockfile.js';

export type RowStatus = 'ok' | 'manual' | 'missing';

export interface SkillRow {
  name: string;
  scope: Scope;
  /** adapter ids where the skill directory physically exists */
  present: string[];
  /** adapter ids recorded in the lockfile entry */
  agents: string[];
  status: RowStatus;
  commit?: string | null;
  source?: string;
  installedAt?: string;
  updatedAt?: string;
  description?: string;
  link?: boolean;
}

export interface CollectOptions {
  userLock: Lockfile;
  /** project lockfile; pass null (and no repoRoot) to skip the project scope */
  projectLock: Lockfile | null;
  repoRoot?: string;
  agents?: AgentAdapter[];
}

/**
 * Merge lockfile entries with on-disk scans into one row per (scope, name):
 * ok = managed and present, manual = on disk but not in any lockfile,
 * missing = locked but the directories are gone.
 */
export function collectRows(opts: CollectOptions): SkillRow[] {
  const agents = opts.agents ?? ADAPTERS;
  const rows = new Map<string, SkillRow>();

  const scopes: Array<{ scope: Scope; lock: Lockfile | null; active: boolean }> = [
    { scope: 'user', lock: opts.userLock, active: true },
    { scope: 'project', lock: opts.projectLock, active: opts.repoRoot !== undefined },
  ];

  for (const { scope, lock, active } of scopes) {
    if (!active) continue;
    for (const entry of lock?.skills ?? []) {
      rows.set(rowKey(scope, entry.name), {
        name: entry.name,
        scope,
        present: [],
        agents: entry.agents.slice(),
        status: 'missing',
        commit: entry.commit,
        source: entry.source,
        installedAt: entry.installedAt,
        updatedAt: entry.updatedAt,
        description: entry.description,
        link: entry.link,
      });
    }
    for (const adapter of agents) {
      for (const meta of adapter.listInstalled(scope, opts.repoRoot)) {
        const key = rowKey(scope, meta.name);
        let row = rows.get(key);
        if (!row) {
          row = { name: meta.name, scope, present: [], agents: [], status: 'manual' };
          rows.set(key, row);
        }
        if (!row.present.includes(adapter.id)) row.present.push(adapter.id);
        if (!row.description && meta.description) row.description = meta.description;
        if (row.status === 'missing') row.status = 'ok';
      }
    }
  }

  return [...rows.values()].sort((a, b) =>
    a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === 'user' ? -1 : 1,
  );
}

function rowKey(scope: Scope, name: string): string {
  return `${scope}:${name}`;
}
