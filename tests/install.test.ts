import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { install } from '../src/install.js';
import { readLockfile } from '../src/lockfile.js';
import { userLockfile } from '../src/paths.js';
import { makeTestEnv, makeGitRepo, fileUrl, gitCommit, writeSkill } from './helpers.js';

const env = makeTestEnv('install');
const tmpBase = path.join(env.base, 'tmp');
fs.mkdirSync(tmpBase, { recursive: true });

afterAll(() => env.cleanup());

const baseOpts = {
  agentIds: ['claude-code', 'zcode'],
  scope: 'user' as const,
  lockfile: userLockfile(),
  tmpBase,
};

const claudeSkillDir = path.join(env.home, '.claude', 'skills');
const zcodeSkillDir = path.join(env.home, '.zcode', 'skills');

describe('install (local source)', () => {
  it('installs a single-skill source into every target agent and writes the lockfile', async () => {
    const src = writeSkill(path.join(env.base, 'src-single', 'ppt-master'), {
      name: 'ppt-master',
      description: 'Make slides',
    });

    const result = await install(src, baseOpts);

    expect(result.kind).toBe('local');
    expect(result.commit).toBeNull();
    expect(result.skills.map((s) => s.name)).toEqual(['ppt-master']);
    for (const dir of [claudeSkillDir, zcodeSkillDir]) {
      expect(fs.readFileSync(path.join(dir, 'ppt-master', 'SKILL.md'), 'utf8')).toMatch('Make slides');
    }

    const lock = readLockfile(userLockfile());
    expect(lock.skills).toHaveLength(1);
    const entry = lock.skills[0];
    expect(entry).toMatchObject({
      name: 'ppt-master',
      source: src,
      path: '',
      commit: null,
      agents: ['claude-code', 'zcode'],
      scope: 'user',
      license: null,
      description: 'Make slides',
    });
  });

  it('installs into project scope under the repo root', async () => {
    const repoRoot = path.join(env.base, 'my-project');
    const src = writeSkill(path.join(env.base, 'src-proj'), { name: 'proj-skill', description: 'd' });

    await install(src, {
      ...baseOpts,
      scope: 'project',
      repoRoot,
      lockfile: path.join(repoRoot, 'skills.lock.json'),
    });

    expect(fs.existsSync(path.join(repoRoot, '.claude', 'skills', 'proj-skill', 'SKILL.md'))).toBe(true);
    const lock = readLockfile(path.join(repoRoot, 'skills.lock.json'));
    expect(lock.skills[0]).toMatchObject({ name: 'proj-skill', scope: 'project' });
  });

  it('detects MIT license from the skill directory', async () => {
    const src = path.join(env.base, 'src-mit', 'licensed');
    writeSkill(src, { name: 'licensed', description: 'd' });
    fs.writeFileSync(path.join(src, 'LICENSE'), 'MIT License\n\nCopyright (c) x', 'utf8');

    const result = await install(src, baseOpts);
    expect(result.skills[0].license).toBe('MIT');
    expect(readLockfile(userLockfile()).skills.find((s) => s.name === 'licensed')?.license).toBe('MIT');
  });

  it('rejects multi-skill sources unless --skill or --all is given', async () => {
    const root = path.join(env.base, 'src-multi');
    writeSkill(path.join(root, 'alpha'), { name: 'alpha', description: 'a' });
    writeSkill(path.join(root, 'beta'), { name: 'beta', description: 'b' });

    await expect(install(root, baseOpts)).rejects.toThrow(/contains 2 skills/);

    const picked = await install(root, { ...baseOpts, skillNames: ['beta'] });
    expect(picked.skills.map((s) => s.name)).toEqual(['beta']);
    expect(picked.skills[0].relPath).toBe('beta');

    const all = await install(root, { ...baseOpts, all: true });
    expect(all.skills.map((s) => s.name)).toEqual(['alpha', 'beta']);
  });

  it('fails with available names when --skill matches nothing', async () => {
    const root = path.join(env.base, 'src-none');
    writeSkill(path.join(root, 'only'), { name: 'only', description: 'o' });
    await expect(install(root, { ...baseOpts, skillNames: ['ghost'] })).rejects.toThrow(/available: only/);
  });

  it('refuses to overwrite unmanaged directories without --force', async () => {
    const src = path.join(env.base, 'src-clobber');
    writeSkill(src, { name: 'clobber-me', description: 'new' });
    const existing = path.join(claudeSkillDir, 'clobber-me');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(existing, 'SKILL.md'), 'manual content', 'utf8');

    await expect(install(src, baseOpts)).rejects.toThrow(/not managed by skillpkg/);

    await install(src, { ...baseOpts, force: true });
    expect(fs.readFileSync(path.join(existing, 'SKILL.md'), 'utf8')).toMatch('new');
  });

  it('reinstalls over an entry the lockfile already manages', async () => {
    const src = writeSkill(path.join(env.base, 'src-reinstall', 're-skill'), {
      name: 're-skill',
      description: 'v1',
    });
    await install(src, baseOpts);
    fs.writeFileSync(path.join(src, 'SKILL.md'), fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8').replace('v1', 'v2'), 'utf8');

    const again = await install(src, baseOpts);
    expect(again.skills[0].replaced).toBe(true);
    expect(fs.readFileSync(path.join(claudeSkillDir, 're-skill', 'SKILL.md'), 'utf8')).toMatch('v2');
    expect(readLockfile(userLockfile()).skills.filter((s) => s.name === 're-skill')).toHaveLength(1);
  });

  it('links instead of copying with --link for local sources', async () => {
    const src = writeSkill(path.join(env.base, 'src-link', 'linked-skill'), {
      name: 'linked-skill',
      description: 'd',
    });
    const result = await install(src, { ...baseOpts, link: true, agentIds: ['claude-code'] });

    const dest = path.join(claudeSkillDir, 'linked-skill');
    expect(result.skills[0].mode).toBe('link');
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toMatch('linked-skill');
    // editing the source is reflected through the link
    fs.writeFileSync(path.join(src, 'extra.md'), 'hot reload', 'utf8');
    expect(fs.readFileSync(path.join(dest, 'extra.md'), 'utf8')).toBe('hot reload');
  });
});

describe('install (git source)', () => {
  it('clones, records the commit, and strips .git from the copy', async () => {
    const repo = path.join(env.base, 'gitrepo');
    writeSkill(path.join(repo, 'git-skill'), { name: 'git-skill', description: 'from git' });
    makeGitRepo(repo);

    const result = await install(fileUrl(repo), { ...baseOpts, agentIds: ['claude-code'] });

    expect(result.kind).toBe('git');
    expect(result.commit).toMatch(/^[0-9a-f]{7,}$/);
    const dest = path.join(claudeSkillDir, 'git-skill');
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toMatch('from git');
    expect(fs.existsSync(path.join(dest, '.git'))).toBe(false);
    expect(readLockfile(userLockfile()).skills.find((s) => s.name === 'git-skill')?.commit).toBe(result.commit);
  });

  it('links to a persistent cache clone with --link', async () => {
    const repo = path.join(env.base, 'gitrepo-link');
    writeSkill(path.join(repo, 'cache-skill'), { name: 'cache-skill', description: 'd' });
    makeGitRepo(repo);

    const result = await install(fileUrl(repo), { ...baseOpts, link: true, agentIds: ['claude-code'] });
    const dest = path.join(claudeSkillDir, 'cache-skill');
    expect(result.skills[0].mode).toBe('link');
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(readLockfile(userLockfile()).skills.find((s) => s.name === 'cache-skill')?.link).toBe(true);
  });
});

describe('install (validation)', () => {
  it('fails on sources without any SKILL.md', async () => {
    const empty = path.join(env.base, 'empty-src');
    fs.mkdirSync(empty, { recursive: true });
    await expect(install(empty, baseOpts)).rejects.toThrow(/no skill found/);
  });

  it('requires repoRoot for project scope', async () => {
    const src = writeSkill(path.join(env.base, 'src-noroot', 'x'), { name: 'x', description: 'd' });
    await expect(install(src, { ...baseOpts, scope: 'project' })).rejects.toThrow(/repoRoot/);
  });

  it('rejects unknown agent ids', async () => {
    const src = writeSkill(path.join(env.base, 'src-badagent', 'y'), { name: 'y', description: 'd' });
    await expect(install(src, { ...baseOpts, agentIds: ['nope'] })).rejects.toThrow(/unknown agent/);
  });
});

// keep git helpers referenced even if a describe block above is skipped
void gitCommit;
