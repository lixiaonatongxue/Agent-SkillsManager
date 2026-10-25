import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { install } from '../src/install.js';
import { userLockfile } from '../src/paths.js';
import { readLockfile } from '../src/lockfile.js';
import { updateEntry } from '../src/update.js';
import { fileUrl, gitCommit, makeGitRepo, makeTestEnv, writeSkill } from './helpers.js';

const env = makeTestEnv('update');
const tmpBase = path.join(env.base, 'tmp');
fs.mkdirSync(tmpBase, { recursive: true });
afterAll(() => env.cleanup());

const lockPath = userLockfile();
const opts = { agentIds: ['claude-code'], scope: 'user' as const, lockfile: lockPath, tmpBase };
const claudeSkillDir = path.join(env.home, '.claude', 'skills');

function lockEntry(name: string) {
  return readLockfile(lockPath).skills.find((s) => s.name === name)!;
}

describe('update', () => {
  it('pulls the newest commit, replaces the files, and records the change', async () => {
    const repo = path.join(env.base, 'repo1');
    writeSkill(path.join(repo, 'moving-skill'), { name: 'moving-skill', description: 'v1' });
    makeGitRepo(repo);

    await install(fileUrl(repo), { ...opts });
    const firstCommit = lockEntry('moving-skill').commit;

    fs.writeFileSync(path.join(repo, 'moving-skill', 'SKILL.md'), '---\nname: moving-skill\ndescription: v2\n---\n\nnew body\n', 'utf8');
    gitCommit(repo, 'feat: second revision');

    const outcome = await updateEntry({ lockfile: lockPath, entry: lockEntry('moving-skill'), tmpBase });

    expect(outcome.status).toBe('updated');
    if (outcome.status === 'updated') {
      expect(outcome.from).toBe(firstCommit);
      expect(outcome.to).toMatch(/^[0-9a-f]{7,}$/);
      expect(outcome.subject).toBe('feat: second revision');
    }
    const dest = path.join(claudeSkillDir, 'moving-skill', 'SKILL.md');
    expect(fs.readFileSync(dest, 'utf8')).toMatch('v2');
    expect(lockEntry('moving-skill').commit).not.toBe(firstCommit);
    expect(lockEntry('moving-skill').updatedAt).toBeTruthy();
  });

  it('reports up-to-date when the commit has not changed', async () => {
    const outcome = await updateEntry({ lockfile: lockPath, entry: lockEntry('moving-skill'), tmpBase });
    expect(outcome.status).toBe('up-to-date');
  });

  it('refreshes local-source skills unconditionally', async () => {
    const src = writeSkill(path.join(env.base, 'local-src', 'local-skill'), {
      name: 'local-skill',
      description: 'v1',
    });
    await install(src, { ...opts });

    fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: local-skill\ndescription: v2\n---\n\nbody\n', 'utf8');
    const outcome = await updateEntry({ lockfile: lockPath, entry: lockEntry('local-skill'), tmpBase });

    expect(outcome.status).toBe('refreshed');
    expect(fs.readFileSync(path.join(claudeSkillDir, 'local-skill', 'SKILL.md'), 'utf8')).toMatch('v2');
  });

  it('refreshes linked skills by re-cloning the cache in place', async () => {
    const repo = path.join(env.base, 'repo-link');
    writeSkill(path.join(repo, 'live-skill'), { name: 'live-skill', description: 'v1' });
    makeGitRepo(repo);

    await install(fileUrl(repo), { ...opts, link: true });
    const dest = path.join(claudeSkillDir, 'live-skill');
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);

    fs.writeFileSync(path.join(repo, 'live-skill', 'SKILL.md'), '---\nname: live-skill\ndescription: v2\n---\n\nbody\n', 'utf8');
    gitCommit(repo, 'fix: link refresh');

    const outcome = await updateEntry({ lockfile: lockPath, entry: lockEntry('live-skill'), tmpBase });

    expect(outcome.status).toBe('updated');
    // still a link, now showing the new content through it
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toMatch('v2');
  });

  it('skips entries whose skill disappeared from the source', async () => {
    const src = writeSkill(path.join(env.base, 'vanish-src', 'vanish'), { name: 'vanish', description: 'd' });
    await install(src, { ...opts });

    fs.rmSync(path.join(src, 'SKILL.md'));
    const outcome = await updateEntry({ lockfile: lockPath, entry: lockEntry('vanish'), tmpBase });

    expect(outcome.status).toBe('skipped');
  });
});
