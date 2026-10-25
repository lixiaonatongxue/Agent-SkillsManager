import { ConventionAdapter } from './base.js';

/** Codex: ~/.codex/skills + <repo>/.codex/skills */
export class CodexAdapter extends ConventionAdapter {
  constructor() {
    super('codex', 'Codex', '.codex');
  }
}
