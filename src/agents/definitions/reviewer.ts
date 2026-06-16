import type { AgentDefinition } from '../IAgent.js'
export const REVIEWER_AGENT: AgentDefinition = {
  id: 'reviewer', name: 'Reviewer', description: 'Review agent',
  triggers: ['review', 'check'], capabilities: [{ name: 'review', description: 'Review', inputs: [], outputs: [] }],
  toolAllowlist: ['Read', 'Grep'], modelPreference: 'sonnet', maxConcurrency: 2, priority: 7,
}
