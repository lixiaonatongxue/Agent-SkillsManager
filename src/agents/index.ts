import type { AgentAdapter } from './base.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { CodexAdapter } from './codex.js';
import { ZCodeAdapter } from './zcode.js';

export const ADAPTERS: AgentAdapter[] = [
  new ClaudeCodeAdapter(),
  new ZCodeAdapter(),
  new CodexAdapter(),
];

export const AGENT_IDS = ADAPTERS.map((a) => a.id);

export function getAdapter(id: string): AgentAdapter {
  const adapter = ADAPTERS.find((a) => a.id === id);
  if (!adapter) {
    throw new Error(`unknown agent "${id}" (supported: ${AGENT_IDS.join(', ')})`);
  }
  return adapter;
}

export function detectInstalledAgents(): AgentAdapter[] {
  return ADAPTERS.filter((a) => a.detect());
}
