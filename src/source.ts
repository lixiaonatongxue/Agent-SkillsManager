import fs from 'node:fs';
import path from 'node:path';

export type SourceSpec =
  | { kind: 'git'; url: string }
  | { kind: 'local'; path: string };

const GIT_URL = /^(?:https?:\/\/|git@|ssh:\/\/git@|git:\/\/|file:\/\/)/i;
const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/;

/**
 * Resolve a user-supplied source into a git URL or a local directory.
 * Precedence: explicit git URLs, then existing local paths (including ./x
 * style), then owner/repo GitHub shorthand.
 */
export function resolveSource(input: string): SourceSpec {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('empty source');

  if (GIT_URL.test(trimmed)) {
    return { kind: 'git', url: normalizeGitUrl(trimmed) };
  }

  const looksLikePath = /^([./\\]|[a-zA-Z]:[\\/])/.test(trimmed);
  const local = path.resolve(trimmed);
  if (looksLikePath || fs.existsSync(local)) {
    if (!fs.existsSync(local)) {
      throw new Error(`local path "${trimmed}" does not exist`);
    }
    return { kind: 'local', path: local };
  }

  if (GITHUB_SHORTHAND.test(trimmed)) {
    return { kind: 'git', url: `https://github.com/${trimmed.replace(/\.git$/, '')}` };
  }

  throw new Error(
    `unrecognized source "${trimmed}": not a git URL, an owner/repo shorthand, or an existing local path`,
  );
}

function normalizeGitUrl(url: string): string {
  return url.endsWith('.git') ? url.slice(0, -4) : url;
}
