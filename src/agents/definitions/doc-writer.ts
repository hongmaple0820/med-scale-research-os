import type { AgentDefinition } from '../IAgent.js'
export const DOC_WRITER_AGENT: AgentDefinition = {
  id: 'doc-writer', name: 'Doc Writer', description: 'Documentation agent',
  triggers: ['document', 'readme'], capabilities: [{ name: 'doc', description: 'Documentation', inputs: [], outputs: [] }],
  toolAllowlist: ['Read', 'Write'], modelPreference: 'haiku', maxConcurrency: 3, priority: 3,
}
