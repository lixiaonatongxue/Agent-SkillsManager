import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { install } from '../src/install.js';
import { readLockfile } from '../src/lockfile.js';
import { userLockfile } from '../src/paths.js';
import { uninstall } from '../src/uninstall.js';
import { makeTestEnv, writeSkill } from './helpers.js';

const env = makeTestEnv('uninstall');
const tmpBase = path.join(env.base, 'tmp');
fs.mkdirSync(tmpBase, { recursive: true });
afterAll(() => env.cleanup());

const lockPath = userLockfile();
const opts = { agentIds: ['claude-code', 'zcode'], scope: 'user' as const, lockfile: lockPath, tmpBase };

const claudeSkillDir = path.join(env.home, '.claude', 'skills');
const zcodeSkillDir = path.join(env.home, '.zcode', 'skills');

describe('uninstall', () => {
  it('removes the skill from every agent and drops the lockfile entry', async () => {
    const src = writeSkill(path.join(env.base, 's1', 'gone-skill'), { name: 'gone-skill', description: 'd' });
    await install(src, { ...opts });

    const result = uninstall('gone-skill', { lockfile: lockPath, scope: 'user' });

    expect(result.removedDirs.sort()).toEqual(
      [path.join(claudeSkillDir, 'gone-skill'), path.join(zcodeSkillDir, 'gone-skill')].sort(),
    );
    expect(fs.existsSync(path.join(claudeSkillDir, 'gone-skill'))).toBe(false);
    expect(fs.existsSync(path.join(zcodeSkillDir, 'gone-skill'))).toBe(false);
    expect(readLockfile(lockPath).skills.find((s) => s.name === 'gone-skill')).toBeUndefined();
  });

  it('leaves sibling skills untouched', async () => {
    const root = path.join(env.base, 's2');
    writeSkill(path.join(root, 'keep-a'), { name: 'keep-a', description: 'a' });
    writeSkill(path.join(root, 'keep-b'), { name: 'keep-b', description: 'b' });
    await install(root, { ...opts, all: true });

    uninstall('keep-a', { lockfile: lockPath, scope: 'user' });

    expect(fs.existsSync(path.join(claudeSkillDir, 'keep-a'))).toBe(false);
    expect(fs.existsSync(path.join(claudeSkillDir, 'keep-b'))).toBe(true);
  });

  it('refuses unknown names without --force and lists nothing removed', () => {
    expect(() => uninstall('ghost', { lockfile: lockPath, scope: 'user' })).toThrow(/not in the lockfile/);
  });

  it('force-removes manually installed directories not tracked by the lockfile', () => {
    writeSkill(path.join(claudeSkillDir, 'manual-skill'), { name: 'manual-skill', description: 'm' });

    const result = uninstall('manual-skill', { lockfile: lockPath, scope: 'user', force: true });

    expect(result.removedDirs).toEqual([path.join(claudeSkillDir, 'manual-skill')]);
    expect(fs.existsSync(path.join(claudeSkillDir, 'manual-skill'))).toBe(false);
  });

  it('errors when --force finds no matching directory either', () => {
    expect(() => uninstall('ghost', { lockfile: lockPath, scope: 'user', force: true })).toThrow(
      /no directory named "ghost"/,
    );
  });
});
