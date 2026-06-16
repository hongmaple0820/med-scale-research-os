import type { AgentDefinition } from '../IAgent.js'
export const RESEARCHER_AGENT: AgentDefinition = {
  id: 'researcher', name: 'Researcher', description: 'Research agent',
  triggers: ['search', 'find'], capabilities: [{ name: 'research', description: 'Research', inputs: [], outputs: [] }],
  toolAllowlist: ['Glob', 'Grep'], modelPreference: 'haiku', maxConcurrency: 3, priority: 5,
}
