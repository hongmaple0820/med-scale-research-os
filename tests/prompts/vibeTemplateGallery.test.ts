import { describe, expect, it } from 'vitest'
import {
  getVisualVibeTemplate,
  listVisualVibeTemplates,
  renderCopyablePromptCard,
  renderVisualVibeTemplateIndex,
} from '../../src/prompts/VibeTemplateGallery.js'

describe('VibeTemplateGallery', () => {
  it('provides visual copyable prompt templates aligned with SCALE workflow', () => {
    const templates = listVisualVibeTemplates()

    expect(templates.length).toBeGreaterThanOrEqual(5)
    expect(templates.map(template => template.id)).toEqual(expect.arrayContaining([
      'product-ceo-discovery',
      'ui-ux-design-direction',
      'technical-architecture-plan',
      'implementation-slice',
      'verification-release',
    ]))
    for (const template of templates) {
      expect(template.copyPrompt).toContain('成功标准')
      expect(template.copyPrompt).toContain('安全边界')
      expect(template.copyPrompt).toContain('主动使用 skills/MCP/CLI')
      expect(template.scaleWorkflow).toEqual(expect.arrayContaining(['explore', 'plan', 'verify']))
    }
  })

  it('renders a markdown index that users can view and copy from', () => {
    const markdown = renderVisualVibeTemplateIndex({ appName: 'Amdox Workbench' })

    expect(markdown).toContain('# SCALE Vibe Coding 可视化提示词模板')
    expect(markdown).toContain('复制使用')
    expect(markdown).toContain('product-ceo-discovery')
    expect(markdown).toContain('Amdox Workbench')
    expect(markdown).toContain('scale vibe --template')
  })

  it('renders one copyable prompt card with interpolated context', () => {
    const card = renderCopyablePromptCard('technical-architecture-plan', {
      appName: 'Scale Engine',
      scenario: '升级 Skill 安全安装流程',
    })

    expect(card).toContain('Scale Engine')
    expect(card).toContain('升级 Skill 安全安装流程')
    expect(card).toContain('```text')
    expect(card).toContain('请作为 CTO')
    expect(card).toContain('工具与 Skill 编排')
  })

  it('returns undefined for unknown template ids', () => {
    expect(getVisualVibeTemplate('missing-template')).toBeUndefined()
  })
})
