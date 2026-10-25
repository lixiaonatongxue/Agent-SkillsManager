**English** | [简体中文](README.zh-CN.md)

# skillpkg (`sm`) — Package Manager for Agent Skills

> **The package manager for coding-agent skills — "npm for skills".**
> One command installs skills from any git repo into Claude Code / ZCode / Codex, with unified listing, updating, security auditing and clean uninstalls.

---

## Why

The agent-skills ecosystem is exploding, but managing them is still stuck in the stone age:

- **Install** = manual `git clone` plus hand-copying, and every agent expects a different directory
- **Update** = doesn't exist; **uninstall** = delete folders by hand, never cleanly
- **Risk** = a rogue skill hiding `curl ... | sh` — nobody checks it for you

```bash
# Before: clone, hunt for the directory, copy, pray
git clone https://github.com/someone/some-skill
cp -r some-skill ~/.claude/skills/       # and zcode uses yet another directory...

# Now
sm install someone/some-skill           # installed into every detected agent
```

## Installation

```bash
# try it without installing
npx skillpkg list

# or install globally
npm install -g skillpkg
```

Requirements: Node ≥ 20 and a working `git` (network needed for GitHub shorthand).

## Commands

| Command | What it does |
|---|---|
| `sm install <source>` | Install skill(s) from a git repo, `owner/repo` shorthand, or a local directory |
| `sm list` | List all skills across agents and scopes with their versions (commits) |
| `sm update [name]` | Update to the latest source commit, showing an `old → new` change summary |
| `sm uninstall <name>` | Clean removal guided by the lockfile — no leftovers |
| `sm doctor` | Static security audit of every installed skill (report-only) |
| `sm agents` | Show supported agents and their detection status on this machine |

### install in depth

```bash
sm install anthropics/skills --skill docx        # GitHub shorthand + pick one skill from a multi-skill repo
sm install https://github.com/x/y --all          # install every skill in the repo
sm install ./my-local-skill                      # local directory (pairs great with --link while developing)
sm install x/y --agent claude-code,zcode         # default: every detected agent
sm install x/y --scope project                   # install into the current project (.claude/skills etc.)
sm install x/y --link                            # link instead of copy: source updates are live (junctions on Windows)
```

During install the `SKILL.md` frontmatter is parsed and validated: missing `description`, name/directory mismatches and similar quality problems produce warnings — with community skills being as inconsistent as they are, this check alone is valuable.

### The lockfile (skills.lock.json)

User-scope lockfile lives at `~/.skillpkg/skills.lock.json`, project-scope at the project root (`skills.lock.json`) so it can be committed for reproducible team setups:

```json
{
  "version": 1,
  "skills": [
    {
      "name": "docx",
      "source": "https://github.com/anthropics/skills",
      "path": "document-skills/docx",
      "commit": "a1b2c3d",
      "installedAt": "2026-10-25",
      "agents": ["claude-code", "zcode"],
      "scope": "user",
      "license": "MIT"
    }
  ]
}
```

### sm doctor — the security checkup

Run it before installing skills from unknown sources. Rules are open for review, findings never block, and `--ignore <rule>` silences noisy ones:

| Severity | Rule | Detects |
|---|---|---|
| high | `HIGH_PIPE_TO_SHELL` | `curl/wget ... \| sh`, `\| powershell` — download-and-execute |
| high | `HIGH_INVOKE_EXPRESSION` / `HIGH_EVAL_EXEC` | `Invoke-Expression` / `iex` / `eval('...')` |
| high | `HIGH_BASE64_DECODE_EXEC` | base64-decoded content executed directly (obfuscated payloads) |
| high | `HIGH_CREDS_EXFIL` | credential material (`~/.ssh`, `.env`, browser profiles) referenced in a file that also makes network calls |
| medium | `MED_DATA_EGRESS` | POST / upload of data to external endpoints |
| medium | `MED_ENV_COLLECTION` | environment variables collected and handed to network code |
| medium | `MED_PERSISTENCE` | shell profile edits, startup entries, scheduled tasks |
| low | `LOW_BINARY_BLOB` / `LOW_LONG_LINE` | binaries inside a skill / very long single lines (obfuscation suspects) |

> ⚠️ doctor is heuristic static analysis: it **can miss things and can over-flag**. Treat findings as input for review, not a verdict.

## Supported agents

| Agent | User scope | Project scope |
|---|---|---|
| Claude Code | `~/.claude/skills/` | `<repo>/.claude/skills/` |
| ZCode | `~/.zcode/skills/` | `<repo>/.zcode/skills/` |
| Codex | `~/.codex/skills/` | `<repo>/.codex/skills/` |

Supporting a new agent is a ~10-line adapter file — PRs welcome.

## Development

```bash
git clone https://github.com/lixiaonatongxue/Agent-SkillsManager
cd Agent-SkillsManager
npm install
npm test          # vitest, 55+ cases
npm run build     # tsc -> dist/
node dist/cli.js --help
```

Tests use synthetic data and a sandboxed home (`SKILLPKG_HOME`) only — they never touch your real `~/.claude` and friends.

## Roadmap

- [x] v0.1: install / list / update / uninstall / lockfile / multi-agent adapters
- [x] `sm doctor` static security audit
- [ ] v0.2: seed registry with `sm search`; project-level `sm disable`
- [ ] v1.0: duplicate/trigger-conflict detection; usage statistics and cleanup suggestions; Homebrew/winget distribution

## License

MIT. This tool is an "installer + auditor" only — it does not host or redistribute skill content; each skill repo remains under its author's license.
