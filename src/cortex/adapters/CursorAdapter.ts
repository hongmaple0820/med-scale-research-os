// SCALE Cortex — Cursor Adapter
// 对齐 ECC: DRY adapter pattern — converts Cursor hook format to unified Cortex format
// Cursor uses .cursor/hooks.json with a slightly different stdin schema

import type { UnifiedHookInput } from './ClaudeAdapter.js'

/**
 * Parse Cursor hook stdin JSON into unified format.
 * Cursor format: { session_id, working_dir, action, args }
 */
export function parseCursorInput(raw: string): UnifiedHookInput {
  try {
    const input = JSON.parse(raw)
    return {
      harness: 'cursor',
      sessionId: input.session_id ?? input.sessionId ?? 'unknown',
      cwd: input.working_dir ?? input.cwd ?? process.cwd(),
      toolName: input.action ?? input.tool ?? '',
      toolInput: input.args ?? input.input ?? {},
      event: input.hook_event ?? input.event ?? 'PreToolUse',
    }
  } catch {
    return {
      harness: 'cursor',
      sessionId: 'unknown',
      cwd: process.cwd(),
      toolName: '',
      toolInput: {},
      event: 'PreToolUse',
    }
  }
}

/**
 * Generate Cursor hooks.json config entry for Cortex.
 */
export function generateCursorHookConfig(scriptPath: string): object {
  return {
    hooks: {
      PreToolUse: [
        {
          type: 'command',
          command: `node ${scriptPath}`,
        },
      ],
    },
  }
}
