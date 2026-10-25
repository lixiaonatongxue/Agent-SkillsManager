import { ConventionAdapter } from './base.js';

/** Claude Code: ~/.claude/skills + <repo>/.claude/skills */
export class ClaudeCodeAdapter extends ConventionAdapter {
  constructor() {
    super('claude-code', 'Claude Code', '.claude');
  }
}
