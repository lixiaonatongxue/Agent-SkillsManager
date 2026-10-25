import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ADAPTERS, detectInstalledAgents, getAdapter } from '../src/agents/index.js';
import { makeTestEnv, writeSkill } from './helpers.js';

const env = makeTestEnv('agents');
afterAll(() => env.cleanup());

describe('agent adapters', () => {
  it('detects agents by the presence of their config dir under home', () => {
    fs.mkdirSync(path.join(env.home, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(env.home, '.zcode'), { recursive: true });
    const ids = detectInstalledAgents().map((a) => a.id);
    expect(ids).toEqual(['claude-code', 'zcode']);
  });

  it('lists installed skills with parsed frontmatter', () => {
    const claude = getAdapter('claude-code');
    writeSkill(path.join(claude.userScopeDir(), 'ppt-master'), {
      name: 'ppt-master',
      description: 'Make slides',
    });
    // a stray folder without SKILL.md is ignored
    fs.mkdirSync(path.join(claude.userScopeDir(), 'not-a-skill'), { recursive: true });

    const skills = claude.listInstalled('user');
    expect(skills.map((s) => s.name)).toEqual(['ppt-master']);
    expect(skills[0].description).toBe('Make slides');
  });

  it('scopes user vs project dirs per adapter', () => {
    const root = path.join(env.base, 'repo');
    for (const adapter of ADAPTERS) {
      expect(adapter.userScopeDir()).toBe(path.join(env.home, adapter.id === 'claude-code' ? '.claude' : adapter.id === 'zcode' ? '.zcode' : '.codex', 'skills'));
      expect(adapter.projectScopeDir(root)).toBe(path.join(root, `.${adapter.id === 'claude-code' ? 'claude' : adapter.id === 'zcode' ? 'zcode' : 'codex'}`, 'skills'));
    }
  });

  it('throws on unknown adapter id', () => {
    expect(() => getAdapter('nope')).toThrow(/unknown agent/);
  });
});
