// SCALE Cortex — Codex Adapter
// 对齐 ECC: DRY adapter pattern — converts Codex hook format to unified Cortex format
// Codex uses .codex/hooks.json with slightly different stdin shape

import type { UnifiedHookInput } from './ClaudeAdapter.js'

/**
 * Parse Codex hook stdin JSON into unified format.
 * Codex format: { session, workspace, tool, input }
 */
export function parseCodexInput(raw: string): UnifiedHookInput {
  try {
    const input = JSON.parse(raw)
    return {
      harness: 'codex',
      sessionId: input.session?.id ?? input.sessionId ?? 'unknown',
      cwd: input.workspace ?? input.cwd ?? process.cwd(),
      toolName: input.tool ?? input.toolName ?? '',
      toolInput: input.input ?? input.toolInput ?? {},
      event: input.event ?? 'PreToolUse',
    }
  } catch {
    return {
      harness: 'codex',
      sessionId: 'unknown',
      cwd: process.cwd(),
      toolName: '',
      toolInput: {},
      event: 'PreToolUse',
    }
  }
}

/**
 * Generate Codex hooks.json config entry for Cortex.
 */
export function generateCodexHookConfig(scriptPath: string): object {
  return {
    hooks: {
      PreToolUse: [
        {
          command: `node ${scriptPath}`,
          timeout: 5000,
        },
      ],
      SessionStart: [
        {
          command: `node ${scriptPath} --event SessionStart`,
          timeout: 10000,
        },
      ],
    },
  }
}
