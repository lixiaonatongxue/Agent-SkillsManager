import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from '../paths.js';
import { parseSkillMd } from '../skillmd.js';

export type Scope = 'user' | 'project';

export interface SkillMeta {
  name: string;
  /** Absolute path of the installed skill directory. */
  dir: string;
  description?: string;
}

export interface AgentAdapter {
  /** Stable identifier used in the lockfile and on the CLI (e.g. "claude-code"). */
  readonly id: string;
  readonly label: string;
  /** Whether the agent appears to be installed on this machine. */
  detect(): boolean;
  userScopeDir(): string;
  projectScopeDir(repoRoot: string): string;
  scopeDir(scope: Scope, repoRoot?: string): string;
  /** Skills physically present in this scope, parsed from their SKILL.md. */
  listInstalled(scope: Scope, repoRoot?: string): SkillMeta[];
}

/**
 * Most agents follow the same convention: a config directory at the user home
 * (e.g. ~/.claude) mirrored at the project root (e.g. .claude) with skills
 * under `<config>/skills/<skill-name>/SKILL.md`. Adapters only declare the
 * config directory name; agents that diverge can override individual methods.
 */
export abstract class ConventionAdapter implements AgentAdapter {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly configDir: string,
  ) {}

  detect(): boolean {
    return fs.existsSync(path.join(homeDir(), this.configDir));
  }

  userScopeDir(): string {
    return path.join(homeDir(), this.configDir, 'skills');
  }

  projectScopeDir(repoRoot: string): string {
    return path.join(repoRoot, this.configDir, 'skills');
  }

  scopeDir(scope: Scope, repoRoot?: string): string {
    return scope === 'user' ? this.userScopeDir() : this.projectScopeDir(repoRoot ?? process.cwd());
  }

  listInstalled(scope: Scope, repoRoot?: string): SkillMeta[] {
    const dir = this.scopeDir(scope, repoRoot);
    if (!fs.existsSync(dir)) return [];
    const skills: SkillMeta[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Linked skills are junctions/symlinks, not plain directories.
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const skillFile = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const parsed = parseSkillMd(skillFile);
      skills.push({
        name: parsed?.name ?? entry.name,
        dir: path.join(dir, entry.name),
        description: parsed?.description,
      });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
  }
}
