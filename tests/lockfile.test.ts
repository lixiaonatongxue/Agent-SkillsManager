import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeTestEnv } from './helpers.js';
import {
  emptyLockfile,
  findEntry,
  readLockfile,
  removeEntry,
  upsertEntry,
  writeLockfile,
  type LockEntry,
} from '../src/lockfile.js';

const env = makeTestEnv('lockfile');
afterAll(() => env.cleanup());

function entry(name: string): LockEntry {
  return {
    name,
    source: 'https://github.com/x/' + name,
    path: '',
    commit: 'a1b2c3d',
    installedAt: '2026-10-25',
    agents: ['claude-code'],
    scope: 'user',
    license: 'MIT',
  };
}

describe('lockfile', () => {
  it('returns an empty lockfile for a missing file', () => {
    expect(readLockfile(path.join(env.base, 'missing.json'))).toEqual(emptyLockfile());
  });

  it('round-trips entries through write and read', () => {
    const file = path.join(env.base, 'nested', 'dir', 'skills.lock.json');
    const lock = emptyLockfile();
    upsertEntry(lock, entry('ppt-master'));
    upsertEntry(lock, entry('docx'));
    writeLockfile(file, lock);

    const read = readLockfile(file);
    expect(read.skills.map((s) => s.name)).toEqual(['docx', 'ppt-master']); // sorted
    expect(read.skills[1].source).toBe('https://github.com/x/ppt-master');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(1);
  });

  it('upsert replaces by name', () => {
    const lock = emptyLockfile();
    upsertEntry(lock, entry('a'));
    const updated = { ...entry('a'), commit: 'deadbee' };
    upsertEntry(lock, updated);
    expect(lock.skills).toHaveLength(1);
    expect(lock.skills[0].commit).toBe('deadbee');
  });

  it('finds and removes entries', () => {
    const lock = emptyLockfile();
    upsertEntry(lock, entry('a'));
    upsertEntry(lock, entry('b'));
    expect(findEntry(lock, 'b')?.source).toContain('/b');
    expect(removeEntry(lock, 'a')?.name).toBe('a');
    expect(removeEntry(lock, 'nope')).toBeNull();
    expect(lock.skills.map((s) => s.name)).toEqual(['b']);
  });

  it('rejects corrupt or wrong-shape lockfiles', () => {
    const bad = path.join(env.base, 'bad.json');
    fs.writeFileSync(bad, '{oops', 'utf8');
    expect(() => readLockfile(bad)).toThrow(/not valid JSON/);
    const wrong = path.join(env.base, 'wrong.json');
    fs.writeFileSync(wrong, JSON.stringify({ version: 9, skills: [] }), 'utf8');
    expect(() => readLockfile(wrong)).toThrow(/unexpected shape/);
  });
});
