import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeTestEnv, writeSkill } from './helpers.js';
import { parseSkillMd } from '../src/skillmd.js';

const env = makeTestEnv('skillmd');
afterAll(() => env.cleanup());

describe('parseSkillMd', () => {
  it('reads name and description from frontmatter', () => {
    const dir = writeSkill(path.join(env.base, 'ppt-master'), {
      name: 'ppt-master',
      description: 'Generate polished slide decks',
    });
    const parsed = parseSkillMd(path.join(dir, 'SKILL.md'));
    expect(parsed?.name).toBe('ppt-master');
    expect(parsed?.description).toBe('Generate polished slide decks');
    expect(parsed?.warnings).toEqual([]);
  });

  it('falls back to the directory name and warns when frontmatter is missing', () => {
    const dir = writeSkill(path.join(env.base, 'bare-skill'));
    const parsed = parseSkillMd(path.join(dir, 'SKILL.md'))!;
    expect(parsed.name).toBe('bare-skill');
    expect(parsed.description).toBeUndefined();
    expect(parsed.warnings.join('\n')).toMatch(/no frontmatter/);
    expect(parsed.warnings.join('\n')).toMatch(/missing description/);
  });

  it('warns when frontmatter name differs from the directory name', () => {
    const dir = writeSkill(path.join(env.base, 'folder-name'), {
      name: 'other-name',
      description: 'd',
    });
    const parsed = parseSkillMd(path.join(dir, 'SKILL.md'))!;
    expect(parsed.name).toBe('other-name');
    expect(parsed.warnings.join('\n')).toMatch(/differs from directory name/);
  });

  it('warns on over-long descriptions', () => {
    const dir = writeSkill(path.join(env.base, 'verbose'), {
      name: 'verbose',
      description: 'x'.repeat(1200),
    });
    const parsed = parseSkillMd(path.join(dir, 'SKILL.md'))!;
    expect(parsed.warnings.join('\n')).toMatch(/1200 chars/);
  });

  it('returns null for missing or unreadable files', () => {
    expect(parseSkillMd(path.join(env.base, 'nope', 'SKILL.md'))).toBeNull();
    fs.mkdirSync(path.join(env.base, 'unreadable'), { recursive: true });
    expect(parseSkillMd(path.join(env.base, 'unreadable', 'SKILL.md'))).toBeNull();
  });
});
