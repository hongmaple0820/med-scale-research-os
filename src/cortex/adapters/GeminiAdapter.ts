// SCALE Cortex — Gemini CLI Adapter
// 对齐 ECC: DRY adapter pattern — converts Gemini CLI hook format to unified Cortex format
// Gemini CLI uses GEMINI.md hooks with its own stdin format

import type { UnifiedHookInput } from './ClaudeAdapter.js'

/**
 * Parse Gemini CLI hook stdin JSON into unified format.
 * Gemini format varies per tool, this normalizes across known shapes.
 */
export function parseGeminiInput(raw: string): UnifiedHookInput {
  try {
    const input = JSON.parse(raw)
    return {
      harness: 'gemini',
      sessionId: input.session_id ?? input.sessionId ?? input.sid ?? 'unknown',
      cwd: input.cwd ?? input.working_directory ?? process.cwd(),
      toolName: input.tool_name ?? input.toolName ?? input.action ?? '',
      toolInput: input.input ?? input.tool_input ?? input.args ?? {},
      event: input.event ?? input.hook_event ?? 'PreToolUse',
    }
  } catch {
    return {
      harness: 'gemini',
      sessionId: 'unknown',
      cwd: process.cwd(),
      toolName: '',
      toolInput: {},
      event: 'PreToolUse',
    }
  }
}

/**
 * Generate Gemini CLI hook config entry for Cortex.
 * Gemini CLI uses GEMINI.md with hooks section.
 */
export function generateGeminiHookConfig(scriptPath: string): object {
  return {
    hooks: {
      PreToolUse: [
        {
          type: 'command',
          command: `node ${scriptPath}`,
          timeout: 5000,
        },
      ],
    },
  }
}
