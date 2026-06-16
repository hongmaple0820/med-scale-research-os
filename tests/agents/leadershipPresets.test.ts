import { describe, expect, it } from 'vitest'
import {
  getLeadershipPreset,
  listLeadershipPresets,
  renderLeadershipPresetsMarkdown,
  selectLeadershipPreset,
} from '../../src/agents/LeadershipPresets.js'

describe('LeadershipPresets', () => {
  it('provides CEO and CTO leader presets for agent-led workflows', () => {
    const presets = listLeadershipPresets()
    const ids = presets.map(preset => preset.id)

    expect(ids).toEqual(expect.arrayContaining([
      'ceo-lead',
      'cto-lead',
      'product-lead',
      'ux-director',
      'qa-director',
      'security-lead',
    ]))
    expect(getLeadershipPreset('ceo-lead')?.decisionRights).toContain('产品价值与商业闭环优先级')
    expect(getLeadershipPreset('cto-lead')?.decisionRights).toContain('技术架构与工程质量门槛')
  })

  it('selects a leader by task language and domain', () => {
    expect(selectLeadershipPreset('需要评审商业闭环、用户价值和产品路线')?.id).toBe('ceo-lead')
    expect(selectLeadershipPreset('需要做架构方案、技术选型、服务边界设计')?.id).toBe('cto-lead')
    expect(selectLeadershipPreset('需要优化 UI/UX、视觉审美、交互体验')?.id).toBe('ux-director')
  })

  it('renders a Chinese guide with coaching questions and safety boundaries', () => {
    const markdown = renderLeadershipPresetsMarkdown()

    expect(markdown).toContain('# SCALE 领导者角色预设')
    expect(markdown).toContain('CEO')
    expect(markdown).toContain('CTO')
    expect(markdown).toContain('引导问题')
    expect(markdown).toContain('边界')
  })
})
