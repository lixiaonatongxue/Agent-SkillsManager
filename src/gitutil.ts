import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface HeadInfo {
  /** short commit hash */
  commit: string;
  /** subject line of the latest commit */
  subject: string;
  /** commit date, YYYY-MM-DD */
  date: string;
}

/** Shallow-clone `url` into `dest` (which must not exist yet). */
export async function cloneShallow(url: string, dest: string): Promise<void> {
  await exec('git', ['clone', '--depth', '1', '--quiet', '--', url, dest], {
    windowsHide: true,
    timeout: 300_000,
  });
}

/** Latest commit of an existing repository checkout, or null on failure. */
export async function headInfo(dir: string): Promise<HeadInfo | null> {
  try {
    const { stdout } = await exec(
      'git',
      ['-C', dir, 'log', '-1', '--pretty=format:%h%x09%s%x09%cs'],
      { windowsHide: true, timeout: 30_000 },
    );
    const [commit, subject, date] = stdout.trim().split('\t');
    if (!commit) return null;
    return { commit, subject: subject ?? '', date: date ?? '' };
  } catch {
    return null;
  }
}
