#!/usr/bin/env node
import fs from 'node:fs';
import { Command, Option } from 'commander';
import Table from 'cli-table3';
import c from 'picocolors';
import type { Scope } from './agents/base.js';
import { ADAPTERS, AGENT_IDS, detectInstalledAgents, getAdapter } from './agents/index.js';
import { install } from './install.js';
import { findProjectRoot, projectLockfile, userLockfile } from './paths.js';
import { collectRows } from './list.js';
import { findEntry, readLockfile } from './lockfile.js';
import { uninstall } from './uninstall.js';
import { updateEntry, type UpdateTarget } from './update.js';

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const program = new Command();
program
  .name('sm')
  .description('skillpkg — the package manager for coding-agent skills (Claude Code / ZCode / Codex)')
  .version(version);

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function resolveAgentIds(value: string): string[] {
  const v = value.trim().toLowerCase();
  if (v === 'auto') {
    const detected = detectInstalledAgents().map((a) => a.id);
    if (detected.length === 0) {
      throw new Error(
        `no supported agent detected on this machine (${AGENT_IDS.join(', ')}); pass --agent explicitly`,
      );
    }
    return detected;
  }
  if (v === 'all') return [...AGENT_IDS];
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of ids) getAdapter(id); // validates and throws a friendly error
  return ids;
}

interface ScopeLock {
  scope: Scope;
  lockfile: string;
  repoRoot?: string;
}

function activeScopes(): ScopeLock[] {
  const scopes: ScopeLock[] = [{ scope: 'user', lockfile: userLockfile() }];
  const root = findProjectRoot();
  if (root) scopes.push({ scope: 'project', lockfile: projectLockfile(root), repoRoot: root });
  return scopes;
}

/* ---------------------------------- agents --------------------------------- */

program
  .command('agents')
  .description('list supported agents and whether they are detected on this machine')
  .action(() => {
    const table = new Table({ head: ['ID', 'Agent', 'User skills dir', 'Detected'].map((h) => c.bold(h)) });
    for (const adapter of ADAPTERS) {
      table.push([
        adapter.id,
        adapter.label,
        truncate(adapter.userScopeDir(), 46),
        adapter.detect() ? c.green('yes') : c.dim('no'),
      ]);
    }
    console.log(table.toString());
  });

/* ---------------------------------- install -------------------------------- */

program
  .command('install')
  .description('install skill(s) from a git repo, owner/repo shorthand, or a local directory')
  .argument('<source>', 'git URL, owner/repo, or local path')
  .option('-a, --agent <ids>', 'claude-code,zcode,codex comma list, "all", or "auto" (detected agents)', 'auto')
  .addOption(new Option('-s, --scope <scope>', 'where to install').choices(['user', 'project']).default('user'))
  .option('--skill <name>', 'pick one skill of a multi-skill source (repeatable)', collect, [])
  .option('--all', 'install every skill found in the source')
  .option('--link', 'link to a clone instead of copying (edits/updates are live)')
  .option('--force', 'overwrite skill directories that skillpkg does not manage')
  .action(async (source: string, opts: {
    agent: string; scope: Scope; skill: string[]; all?: boolean; link?: boolean; force?: boolean;
  }) => {
    const agentIds = resolveAgentIds(opts.agent);

    let lock: ScopeLock;
    if (opts.scope === 'project') {
      const root = findProjectRoot();
      if (!root) {
        throw new Error(
          'not inside a project (no .git or skills.lock.json found upwards); run from a project directory or use --scope user',
        );
      }
      lock = { scope: 'project', lockfile: projectLockfile(root), repoRoot: root };
    } else {
      lock = { scope: 'user', lockfile: userLockfile() };
    }

    const result = await install(source, {
      agentIds,
      scope: lock.scope,
      repoRoot: lock.repoRoot,
      skillNames: opts.skill,
      all: opts.all,
      link: opts.link,
      force: opts.force,
      lockfile: lock.lockfile,
    });

    const origin = result.commit ? `${result.source} @ ${result.commit}` : result.source;
    console.log(`\nInstalled ${result.skills.length} skill(s) from ${c.cyan(origin)}\n`);
    for (const skill of result.skills) {
      const mode = skill.mode === 'link' ? c.magenta('linked') : 'copied';
      console.log(
        `  ${c.green('+')} ${c.bold(skill.name)} → ${skill.agents.join(', ')}  (${mode}${skill.replaced ? ', replaced previous' : ''})`,
      );
      if (skill.license) console.log(`      license: ${skill.license}`);
      for (const warning of skill.warnings) console.log(`      ${c.yellow('warn')}: ${warning}`);
    }
    console.log(`\nLockfile: ${c.dim(lock.lockfile)}`);
  });

/* ----------------------------------- list ---------------------------------- */

program
  .command('list')
  .alias('ls')
  .description('list installed skills across agents and scopes')
  .addOption(new Option('-s, --scope <scope>', 'filter by scope').choices(['user', 'project']))
  .action((opts: { scope?: Scope }) => {
    const repoRoot = findProjectRoot() ?? undefined;
    const rows = collectRows({
      userLock: readLockfile(userLockfile()),
      projectLock: repoRoot ? readLockfile(projectLockfile(repoRoot)) : null,
      repoRoot,
    }).filter((row) => !opts.scope || row.scope === opts.scope);

    if (rows.length === 0) {
      console.log('No skills found. Install one with: sm install <owner/repo>');
      return;
    }

    const table = new Table({
      head: ['Skill', 'Scope', 'Agents', 'State', 'Source', 'Description'].map((h) => c.bold(h)),
    });
    for (const row of rows) {
      let state: string;
      if (row.status === 'missing') state = c.red('missing');
      else if (row.status === 'manual') state = c.dim('manual');
      else state = row.commit ?? c.green('ok');
      table.push([
        row.link ? c.magenta(row.name) : row.name,
        row.scope,
        row.present.join(', ') || '-',
        state,
        truncate(row.source ?? '-', 40),
        truncate(row.description ?? '', 40),
      ]);
    }
    console.log(table.toString());
    const manual = rows.filter((r) => r.status === 'manual').length;
    if (manual > 0) console.log(c.dim(`(${manual} manual skill(s) are not managed by skillpkg)`));
  });

/* --------------------------------- uninstall ------------------------------- */

program
  .command('uninstall')
  .alias('rm')
  .description('remove a skill from every agent listed in the lockfile')
  .argument('<name>', 'skill name')
  .addOption(new Option('-s, --scope <scope>', 'user or project').choices(['user', 'project']))
  .option('--force', 'remove a skill that is not in the lockfile (matches by directory name)')
  .action((name: string, opts: { scope?: Scope; force?: boolean }) => {
    const candidates = activeScopes().filter((s) => !opts.scope || s.scope === opts.scope);

    // Prefer lockfile-driven removal so exactly the recorded directories die.
    for (const candidate of candidates) {
      if (findEntry(readLockfile(candidate.lockfile), name)) {
        const result = uninstall(name, { ...candidate, force: opts.force });
        reportUninstall(result.name, result.removedDirs, result.scope);
        return;
      }
    }

    if (!opts.force) {
      throw new Error(
        `"${name}" is not in any lockfile; if it was installed manually, re-run with --force to delete matching directories`,
      );
    }
    for (const candidate of candidates) {
      const result = uninstall(name, { ...candidate, force: true });
      reportUninstall(result.name, result.removedDirs, result.scope);
      return;
    }
  });

function reportUninstall(name: string, removedDirs: string[], scope: Scope): void {
  console.log(`\nRemoved ${c.bold(name)} (${scope} scope)`);
  for (const dir of removedDirs) console.log(`  ${c.red('-')} ${dir}`);
}

/* ---------------------------------- update --------------------------------- */

program
  .command('update')
  .description('update skill(s) to the latest commit of their source')
  .argument('[name]', 'update one skill; omit to update all')
  .action(async (name?: string) => {
    const targets: UpdateTarget[] = [];
    for (const scopeLock of activeScopes()) {
      for (const entry of readLockfile(scopeLock.lockfile).skills) {
        if (name && entry.name !== name) continue;
        targets.push({ lockfile: scopeLock.lockfile, entry, repoRoot: scopeLock.repoRoot });
      }
    }
    if (targets.length === 0) {
      console.log(name ? `No locked skill named "${name}".` : 'Nothing to update (no skills in any lockfile).');
      return;
    }

    for (const target of targets) {
      const outcome = await updateEntry(target);
      if (outcome.status === 'up-to-date') {
        console.log(`${c.dim('·')} ${outcome.name} up to date (${outcome.commit})`);
      } else if (outcome.status === 'updated') {
        console.log(
          `${c.green('↑')} ${c.bold(outcome.name)}  ${c.dim(outcome.from ?? 'none')} → ${outcome.to}  ${truncate(outcome.subject, 60)} ${c.dim(`(${outcome.date})`)}`,
        );
      } else if (outcome.status === 'refreshed') {
        console.log(`${c.green('↑')} ${c.bold(outcome.name)}  refreshed from ${truncate(outcome.from, 50)}`);
      } else {
        console.log(`${c.yellow('!')} ${outcome.name} skipped: ${outcome.reason}`);
      }
    }
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`${c.red('error:')} ${err.message}`);
  process.exit(1);
});
