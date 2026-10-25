import fs from 'node:fs';
import path from 'node:path';

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  /** skill directory name */
  skill: string;
  /** file path relative to the skill directory */
  file: string;
  line?: number;
  severity: Severity;
  rule: string;
  message: string;
  snippet?: string;
}

const TEXT_EXTS = new Set([
  '.md', '.mdx', '.txt', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.pl', '.lua', '.php',
  '.json', '.yml', '.yaml', '.toml', '.xml', '.ini', '.conf', '.html',
]);

const TEXT_NAMES = new Set(['SKILL.md', 'README.md', 'Makefile', 'Dockerfile', '.env.example']);

const BINARY_EXTS = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.scr', '.com', '.msi', '.jar', '.psm1bin']);

const MAX_FILE_BYTES = 1_000_000;

interface LineRule {
  severity: Severity;
  rule: string;
  message: string;
  pattern: RegExp;
  /** restrict matching to these extensions (default: all text files) */
  exts?: Set<string>;
}

const LINE_RULES: LineRule[] = [
  {
    severity: 'high',
    rule: 'HIGH_PIPE_TO_SHELL',
    message: 'downloads from the network piped straight into a shell (download-and-execute)',
    pattern:
      /(curl|wget)\b[^\n|]{0,400}\|\s*(?:sudo\s+)?(?:ba|z|da|fi)?sh\b|(curl|wget)\b[^\n|]{0,400}\|\s*(?:sudo\s+)?(?:powershell|pwsh|cmd)\b/i,
  },
  {
    severity: 'high',
    rule: 'HIGH_INVOKE_EXPRESSION',
    message: 'Invoke-Expression / iex executes arbitrary strings at runtime',
    pattern: /\bInvoke-Expression\b|\biex\s+\$/i,
  },
  {
    severity: 'high',
    rule: 'HIGH_EVAL_EXEC',
    message: 'eval() of string content executes arbitrary code',
    pattern: /\beval\s*\(?\s*(['"`])/,
  },
  {
    severity: 'high',
    rule: 'HIGH_BASE64_DECODE_EXEC',
    message: 'base64-decoded content executed directly (common obfuscation)',
    pattern:
      /(?:base64\s+(?:-d|--decode)[^\n]{0,200}|FromBase64String[^\n]{0,200}|atob\([^\n]{0,200})(?:\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b|Invoke-Expression|\biex\b|\beval\s*\()/i,
  },
  {
    severity: 'medium',
    rule: 'MED_DATA_EGRESS',
    message: 'sends data to an external endpoint (POST / upload)',
    pattern:
      /(curl|wget)[^\n]{0,200}(-X\s*(POST|PUT)|--data(-raw)?\b|-d\s+[^-]|--upload-file\b|-T\s+)|UploadFile\s*\(|requests\.(post|put)\s*\(|axios\.(post|put)\s*\(/i,
  },
  {
    severity: 'medium',
    rule: 'MED_ENV_COLLECTION',
    message: 'reads environment variables and hands them to network code',
    pattern:
      /process\.env[^\n]{0,80}(curl|wget|https?:\/\/|fetch\()|os\.environ[^\n]{0,80}(curl|wget|https?:\/\/|requests\.|urllib)|printenv[^\n]{0,80}(>|curl|wget)/i,
  },
  {
    severity: 'medium',
    rule: 'MED_PERSISTENCE',
    message: 'modifies shell profiles, startup entries or scheduled tasks (persistence)',
    pattern:
      /(\.bashrc|\.zshrc|\.profile\b|PowerShell\s*profile|schtasks\b[^\n]*\/create|crontab\b|CurrentVersion..Run|systemctl\s+enable|LaunchAgents\/)/i,
  },
];

/** credential-material references that become interesting when network egress is in the same file */
const CRED_PATTERN =
  /(\/\.ssh|~\/\.ssh|\.aws\b|\.gnupg|\.kube\b|Login Data|User Data[^\n]{0,40}(Chrome|Edge|Chromium)|\.env(?!\.(example|sample|template|dist))\b|credentials?\.(json|ya?ml))/i;
const NETWORK_PATTERN =
  /(curl|wget|Invoke-WebRequest|Invoke-RestMethod|requests\.post|axios\.post|fetch\(|netcat|nc\s+-)/i;

/**
 * Statically audit one installed skill directory. Heuristics only — this
 * reports suspicious patterns, it does not block anything and can both miss
 * and over-flag. Findings are informational.
 */
export function auditSkill(skillName: string, skillDir: string, ignore: Set<string> = new Set()): Finding[] {
  const findings: Finding[] = [];
  walk(skillDir);

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      auditFile(full);
    }
  }

  function auditFile(file: string): void {
    const ext = path.extname(file).toLowerCase();
    const rel = path.relative(skillDir, file).split(path.sep).join('/');
    if (BINARY_EXTS.has(ext)) {
      push({ skill: skillName, file: rel, severity: 'low', rule: 'LOW_BINARY_BLOB', message: `binary file "${path.basename(file)}" inside the skill` });
      return;
    }
    if (!TEXT_EXTS.has(ext) && !TEXT_NAMES.has(path.basename(file))) return;

    let content: string;
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE_BYTES) return;
      content = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    if (content.includes('\0')) return;

    const lines = content.split(/\r?\n/);
    const scriptish = new Set(['.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd']);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 500) {
        push({
          skill: skillName, file: rel, line: i + 1, severity: 'low', rule: 'LOW_LONG_LINE',
          message: `single ${line.length}-char line (minified or obfuscated?)`, snippet: truncate(line),
        });
      }
      for (const rule of LINE_RULES) {
        if (rule.rule === 'HIGH_INVOKE_EXPRESSION' && rule.exts && !rule.exts.has(ext) && !/\biex\s+\$/.test(line)) {
          // plain "iex" in prose is too noisy; only flag Invoke-Expression outside scripts
          if (!/\bInvoke-Expression\b/i.test(line)) continue;
        }
        if (!rule.pattern.test(line)) continue;
        push({
          skill: skillName, file: rel, line: i + 1, severity: rule.severity, rule: rule.rule,
          message: rule.message, snippet: truncate(line),
        });
      }
    }

    if (CRED_PATTERN.test(content) && NETWORK_PATTERN.test(content)) {
      const line = firstLineMatching(lines, CRED_PATTERN);
      push({
        skill: skillName, file: rel, line, severity: 'high', rule: 'HIGH_CREDS_EXFIL',
        message: 'references credential material (ssh keys / .env / browser profiles) in a file that also performs network calls',
      });
    }
  }

  function push(finding: Finding): void {
    if (ignore.has(finding.rule)) return;
    if (findings.some((f) => f.file === finding.file && f.rule === finding.rule && f.line === finding.line)) return;
    findings.push(finding);
  }

  return findings;
}

function firstLineMatching(lines: string[], pattern: RegExp): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return undefined;
}

function truncate(line: string): string {
  const t = line.trim();
  return t.length <= 90 ? t : `${t.slice(0, 89)}…`;
}
