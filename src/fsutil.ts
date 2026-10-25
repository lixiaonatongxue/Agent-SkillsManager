import fs from 'node:fs';
import path from 'node:path';

/**
 * existsSync returns false for broken links, and skill destinations may be
 * junctions/symlinks, so existence must be probed with lstat.
 */
export function pathExists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Put a skill directory in place at destDir: symlink/junction when linking
 * (one source shared by many agents, live updates), filtered recursive copy
 * otherwise (skips .git and node_modules). Returns the mode actually used.
 */
export function placeDirectory(srcDir: string, destDir: string, link: boolean): 'copy' | 'link' {
  if (link) {
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    try {
      fs.symlinkSync(srcDir, destDir, type);
      return 'link';
    } catch {
      // Windows without developer mode, or a restricted filesystem: fall back.
    }
  }
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      return base !== '.git' && base !== 'node_modules';
    },
  });
  return 'copy';
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
