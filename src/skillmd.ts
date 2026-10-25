import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export interface ParsedSkill {
  /** Canonical skill name: frontmatter name if present, else directory name. */
  name: string;
  description?: string;
  /** Non-fatal quality issues worth surfacing to the user at install time. */
  warnings: string[];
}

/**
 * Parse a SKILL.md file. Returns null when the file does not exist or cannot
 * be read. Frontmatter problems never throw — community skills are wildly
 * inconsistent, so we degrade to defaults and collect warnings instead.
 */
export function parseSkillMd(file: string): ParsedSkill | null {
  if (!fs.existsSync(file)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  const warnings: string[] = [];
  let data: Record<string, unknown> = {};
  if (/^---\r?\n/.test(raw)) {
    try {
      data = matter(raw).data ?? {};
    } catch (err) {
      warnings.push(`SKILL.md frontmatter could not be parsed (${(err as Error).message}); using raw values only`);
      data = {};
    }
  } else {
    warnings.push('SKILL.md has no frontmatter; name falls back to the directory name');
  }

  const dirName = path.basename(path.dirname(file));
  let name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) {
    name = dirName;
  } else if (name !== dirName) {
    warnings.push(`frontmatter name "${name}" differs from directory name "${dirName}"`);
  }

  let description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!description) {
    warnings.push('missing description — agents use it to decide when to trigger the skill');
  } else if (description.length > 1024) {
    warnings.push(`description is ${description.length} chars; some agents truncate near 1024`);
  }

  return { name, description: description || undefined, warnings };
}
