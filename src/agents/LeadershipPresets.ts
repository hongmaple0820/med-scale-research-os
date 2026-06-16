export type LeadershipPresetId =
  | 'ceo-lead'
  | 'cto-lead'
  | 'product-lead'
  | 'ux-director'
  | 'qa-director'
  | 'security-lead'
  | 'delivery-lead'

export interface LeadershipPreset {
  id: LeadershipPresetId
  name: string
  title: string
  whenToUse: string[]
  decisionRights: string[]
  coachingQuestions: string[]
  defaultTeam: string[]
  boundaries: string[]
}

export const LEADERSHIP_PRESETS: LeadershipPreset[] = [
  {
    id: 'ceo-lead',
    name: 'CEO',
    title: '产品价值与商业闭环负责人',
    whenToUse: ['新产品', '商业闭环', '需求优先级', '路线图', 'MVP 定义'],
    decisionRights: ['产品价值与商业闭环优先级', '非目标裁剪', '上线范围和成功指标'],
    coachingQuestions: [
      '这个需求解决的是谁的真实问题？',
      '最小可交付闭环是什么？',
      '上线后用什么指标证明值得继续投入？',
    ],
    defaultTeam: ['product-agent', 'ux-director', 'cto-lead', 'qa-director'],
    boundaries: ['不能编造市场事实', '不能把用户想法直接当成验收标准', '必须明确非目标'],
  },
  {
    id: 'cto-lead',
    name: 'CTO',
    title: '技术架构与工程质量负责人',
    whenToUse: ['架构设计', '技术选型', '跨模块变更', '工程治理', '服务边界'],
    decisionRights: ['技术架构与工程质量门槛', '模块边界', '验证策略', '回滚策略'],
    coachingQuestions: [
      '哪些契约变化会影响上下游？',
      '哪些检查必须自动化，哪些可以人工验收？',
      '这次改动如何避免引入长期维护负担？',
    ],
    defaultTeam: ['architect-agent', 'backend-agent', 'frontend-agent', 'security-agent', 'test-agent'],
    boundaries: ['不能绕过项目技术规范', '不能凭空声称测试通过', '不能牺牲安全和可维护性换短期速度'],
  },
  {
    id: 'product-lead',
    name: 'Product Lead',
    title: '需求澄清与 PRD 负责人',
    whenToUse: ['Mini-PRD', '用户故事', '验收标准', '异常场景'],
    decisionRights: ['需求边界', '用户路径', '验收标准可测试性'],
    coachingQuestions: [
      '用户从哪里进入，从哪里完成目标？',
      '权限不足、失败、空态和重试怎么处理？',
      '哪些验收项可以自动化？',
    ],
    defaultTeam: ['product-agent', 'docs-agent', 'test-agent'],
    boundaries: ['验收标准必须可测试', '必须记录权限和数据影响', '不能留下模糊措辞'],
  },
  {
    id: 'ux-director',
    name: 'UX Director',
    title: '体验架构与视觉审美负责人',
    whenToUse: ['UI/UX', '视觉审美', '交互体验', '响应式', '可访问性'],
    decisionRights: ['信息架构', '视觉方向', '交互状态', '设计验收证据'],
    coachingQuestions: [
      '用户最频繁的动作是否足够顺手？',
      '错误、加载、空态和移动端是否都有设计？',
      '界面是否符合产品类型，而不是模板化堆卡片？',
    ],
    defaultTeam: ['ui-design-agent', 'frontend-agent', 'test-agent'],
    boundaries: ['不能只描述功能不定义状态', '不能未截图就声称体验完成', '不能忽略可访问性'],
  },
  {
    id: 'qa-director',
    name: 'QA Director',
    title: '验证严谨性与验收证据负责人',
    whenToUse: ['测试策略', 'E2E', '验收', '回归', '发版前检查'],
    decisionRights: ['测试范围', '证据质量', '阻断项判断'],
    coachingQuestions: [
      '哪些是主链路，哪些是边界场景？',
      '失败输出是否足够定位问题？',
      '哪些验证只是 dry-run，不能当成通过？',
    ],
    defaultTeam: ['test-agent', 'code-review-agent', 'security-agent'],
    boundaries: ['未运行不能说通过', '失败项不能隐藏', '跳过项必须说明原因'],
  },
  {
    id: 'security-lead',
    name: 'Security Lead',
    title: '安全、隐私与供应链风险负责人',
    whenToUse: ['认证授权', '敏感数据', '日志脱敏', '供应链', '高权限工具'],
    decisionRights: ['安全门槛', '敏感操作确认', '供应链阻断', '审计要求'],
    coachingQuestions: [
      '输入、输出、日志和错误信息是否泄露敏感信息？',
      '第三方脚本、Skill、MCP 是否经过安全扫描？',
      '权限边界和回滚策略是否明确？',
    ],
    defaultTeam: ['security-agent', 'code-review-agent', 'ops-agent'],
    boundaries: ['禁止硬编码密钥', '禁止未经审查执行远程脚本', '危险操作必须显式确认'],
  },
  {
    id: 'delivery-lead',
    name: 'Delivery Lead',
    title: '交付、文档资产与发版负责人',
    whenToUse: ['PR', '发布', '文档同步', '资源归档', '多仓协作'],
    decisionRights: ['分支边界', '交付证据', '文档资产生命周期', '发布节奏'],
    coachingQuestions: [
      '哪些文件应该提交，哪些只是临时产物？',
      '多仓或子模块是否都在正确分支？',
      '发版证据是否包含 commit、tag、远程和 registry 状态？',
    ],
    defaultTeam: ['docs-agent', 'ops-agent', 'qa-director'],
    boundaries: ['不能混入无关 dirty tree', '不能提交临时报告和本地配置', 'main/master 需显式授权'],
  },
]

export function listLeadershipPresets(): LeadershipPreset[] {
  return [...LEADERSHIP_PRESETS]
}

export function getLeadershipPreset(id: string): LeadershipPreset | undefined {
  return LEADERSHIP_PRESETS.find(preset => preset.id === id)
}

export function selectLeadershipPreset(taskDescription: string): LeadershipPreset | undefined {
  const text = taskDescription.toLowerCase()
  if (has(text, ['商业', '闭环', '路线', '价值', 'mvp'])) return getLeadershipPreset('ceo-lead')
  if (has(text, ['架构', '技术选型', '服务边界', '模块', '工程质量'])) return getLeadershipPreset('cto-lead')
  if (has(text, ['ui', 'ux', '视觉', '审美', '交互', '体验'])) return getLeadershipPreset('ux-director')
  if (has(text, ['安全', '权限', '脱敏', '供应链', '注入'])) return getLeadershipPreset('security-lead')
  if (has(text, ['测试', '验收', 'e2e', '回归'])) return getLeadershipPreset('qa-director')
  if (has(text, ['发版', '发布', 'pr', '文档', '资产'])) return getLeadershipPreset('delivery-lead')
  return getLeadershipPreset('product-lead')
}

export function renderLeadershipPresetsMarkdown(): string {
  const lines = [
    '# SCALE 领导者角色预设',
    '',
    '这些角色用于让 Agent 在不同场景下主动承担领导者、研究者、实干者和教练职责。角色不是装饰，而是决策权、引导问题、团队组合和边界约束。',
    '',
  ]
  for (const preset of LEADERSHIP_PRESETS) {
    lines.push(`## ${preset.name} - ${preset.title}`)
    lines.push('')
    lines.push(`- ID: \`${preset.id}\``)
    lines.push(`- 适用场景: ${preset.whenToUse.join(', ')}`)
    lines.push(`- 默认团队: ${preset.defaultTeam.join(', ')}`)
    lines.push(`- 决策权: ${preset.decisionRights.join(', ')}`)
    lines.push('')
    lines.push('### 引导问题')
    for (const question of preset.coachingQuestions) lines.push(`- ${question}`)
    lines.push('')
    lines.push('### 边界')
    for (const boundary of preset.boundaries) lines.push(`- ${boundary}`)
    lines.push('')
  }
  return lines.join('\n')
}

function has(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()))
}
