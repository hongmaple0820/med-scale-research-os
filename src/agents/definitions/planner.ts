import type { AgentDefinition } from '../IAgent.js'
export const PLANNER_AGENT: AgentDefinition = {
  id: 'planner', name: 'Planner', description: 'Planning agent',
  triggers: ['plan', 'design'], capabilities: [{ name: 'plan', description: 'Plan', inputs: [], outputs: [] }],
  toolAllowlist: ['Read', 'Grep'], modelPreference: 'opus', maxConcurrency: 1, priority: 10,
}
