import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findProjectRoot, projectLockfile, userLockfile } from '../src/paths.js';
import { makeTestEnv } from './helpers.js';

const env = makeTestEnv('paths');
afterAll(() => env.cleanup());

const savedRoot = process.env.SKILLPKG_ROOT;

describe('paths', () => {
  beforeEach(() => {
    delete process.env.SKILLPKG_ROOT;
  });

  afterEach(() => {
    if (savedRoot === undefined) delete process.env.SKILLPKG_ROOT;
    else process.env.SKILLPKG_ROOT = savedRoot;
  });

  it('keeps skillpkg state under SKILLPKG_HOME', () => {
    expect(userLockfile()).toBe(path.join(env.home, '.skillpkg', 'skills.lock.json'));
  });

  it('finds a project root by walking up to .git or skills.lock.json', () => {
    const root = path.join(env.base, 'my-repo');
    const nested = path.join(root, 'packages', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    expect(findProjectRoot(nested)).toBe(root);
    expect(projectLockfile(root)).toBe(path.join(root, 'skills.lock.json'));
  });

  it('prefers skills.lock.json over .git when both exist', () => {
    const root = path.join(env.base, 'locked');
    const nested = path.join(root, 'sub');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills.lock.json'), '{"version":1,"skills":[]}', 'utf8');
    expect(findProjectRoot(nested)).toBe(root);
  });

  it('returns null when no marker exists before the walk boundary', () => {
    const plain = path.join(env.base, 'plain', 'deeper');
    fs.mkdirSync(plain, { recursive: true });
    expect(findProjectRoot(plain, env.base)).toBeNull();
  });

  it('honors SKILLPKG_ROOT override', () => {
    process.env.SKILLPKG_ROOT = path.join(env.base, 'forced');
    expect(findProjectRoot()).toBe(path.join(env.base, 'forced'));
  });
});
