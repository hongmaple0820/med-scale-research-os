import type { AgentDefinition } from '../IAgent.js'
export const IMPLEMENTER_AGENT: AgentDefinition = {
  id: 'implementer', name: 'Implementer', description: 'Implementation agent',
  triggers: ['implement', 'code'], capabilities: [{ name: 'implement', description: 'Implement', inputs: [], outputs: [] }],
  toolAllowlist: ['Read', 'Edit', 'Write'], modelPreference: 'sonnet', maxConcurrency: 2, priority: 8,
}
