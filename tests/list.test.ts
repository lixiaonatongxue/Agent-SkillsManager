import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { install } from '../src/install.js';
import { collectRows } from '../src/list.js';
import { emptyLockfile, readLockfile } from '../src/lockfile.js';
import { userLockfile } from '../src/paths.js';
import { makeTestEnv, writeSkill } from './helpers.js';

const env = makeTestEnv('list');
const tmpBase = path.join(env.base, 'tmp');
fs.mkdirSync(tmpBase, { recursive: true });
afterAll(() => env.cleanup());

describe('list rows', () => {
  it('merges lockfile entries with disk scans and marks statuses', async () => {
    const src = path.join(env.base, 'multi');
    writeSkill(path.join(src, 'locked-skill'), { name: 'locked-skill', description: 'from lock' });
    await install(src, { agentIds: ['claude-code'], scope: 'user', lockfile: userLockfile(), tmpBase });

    // manual skill: on disk, not in any lockfile
    writeSkill(path.join(env.home, '.claude', 'skills', 'manual-skill'), {
      name: 'manual-skill',
      description: 'hand made',
    });

    const rows = collectRows({
      userLock: readLockfile(userLockfile()),
      projectLock: null,
      repoRoot: undefined,
    });

    expect(rows.map((r) => r.name)).toEqual(['locked-skill', 'manual-skill']);
    expect(rows[0]).toMatchObject({ status: 'ok', present: ['claude-code'], commit: null });
    expect(rows[1]).toMatchObject({ status: 'manual', present: ['claude-code'] });
  });

  it('marks locked skills whose directories are gone as missing', () => {
    const userLock = emptyLockfile();
    userLock.skills.push({
      name: 'gone',
      source: 'https://github.com/x/gone',
      path: '',
      commit: 'abc1234',
      installedAt: '2026-10-25',
      agents: ['claude-code'],
      scope: 'user',
      license: null,
    });
    const rows = collectRows({ userLock, projectLock: null });
    expect(rows[0]).toMatchObject({ name: 'gone', status: 'missing', present: [] });
  });

  it('skips the project scope when no repoRoot is given', () => {
    writeSkill(path.join(env.home, '.claude', 'skills', 'any'), { name: 'any', description: 'd' });
    const rows = collectRows({ userLock: emptyLockfile(), projectLock: null });
    expect(rows.every((r) => r.scope === 'user')).toBe(true);
  });
});
