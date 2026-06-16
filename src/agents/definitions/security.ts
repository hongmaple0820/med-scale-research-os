import type { AgentDefinition } from '../IAgent.js'
export const SECURITY_AGENT: AgentDefinition = {
  id: 'security', name: 'Security', description: 'Security agent',
  triggers: ['security', 'audit'], capabilities: [{ name: 'security', description: 'Security', inputs: [], outputs: [] }],
  toolAllowlist: ['Read', 'Grep'], modelPreference: 'opus', maxConcurrency: 1, priority: 15,
}
