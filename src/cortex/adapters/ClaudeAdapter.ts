// SCALE Cortex — Claude Code Adapter
// 对齐 ECC: DRY adapter pattern — same hook logic, different stdin format
// Converts Claude Code hook stdin JSON to unified Cortex format

export interface UnifiedHookInput {
  harness: 'claude' | 'codex' | 'cursor' | 'gemini'
  sessionId: string
  cwd: string
  toolName: string
  toolInput: Record<string, unknown>
  event: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionStart'
}

/**
 * Parse Claude Code hook stdin JSON into unified format.
 * Claude Code format: { session_id, cwd, tool_name, tool_input }
 */
export function parseClaudeInput(raw: string): UnifiedHookInput {
  try {
    const input = JSON.parse(raw)
    return {
      harness: 'claude',
      sessionId: input.session_id ?? 'unknown',
      cwd: input.cwd ?? process.cwd(),
      toolName: input.tool_name ?? '',
      toolInput: input.tool_input ?? {},
      event: input.hook_event ?? 'PreToolUse',
    }
  } catch {
    return {
      harness: 'claude',
      sessionId: 'unknown',
      cwd: process.cwd(),
      toolName: '',
      toolInput: {},
      event: 'PreToolUse',
    }
  }
}

/**
 * Generate Claude Code settings.json hook entry for Cortex.
 */
export function generateClaudeHookConfig(scriptPath: string): object {
  return {
    hooks: {
      PreToolUse: [
        {
          type: 'command',
          command: `node ${scriptPath}`,
          timeout: 5000,
        },
      ],
      SessionStart: [
        {
          type: 'command',
          command: `node ${scriptPath} --event SessionStart`,
          timeout: 10000,
        },
      ],
      Stop: [
        {
          type: 'command',
          command: `node ${scriptPath} --event Stop`,
          timeout: 10000,
        },
      ],
    },
  }
}
