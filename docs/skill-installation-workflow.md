# SCALE Engine — Skill Installation Workflow

## 交互式技能安装流程

工作流自动检测未安装技能，提示用户确认，执行安装。

## 工作流步骤

### 1. 检测未安装技能

```typescript
import { SkillRegistry, SkillInstaller, registerExternalSkills } from './skills/index.js'
import { EventBus } from './core/eventBus.js'

const eventBus = new EventBus()
const registry = new SkillRegistry(eventBus)
registerExternalSkills(registry, eventBus)

const installer = new SkillInstaller(registry, eventBus)

// 检测未安装技能
const pending = await installer.checkAndPrompt()
// 返回: [{ skillId: 'cua', method: 'pip-install' }, ...]
```

### 2. 提示用户确认

工作流收到 `skills.install-prompt` 事件后，向用户展示：

```
检测到 6 个未安装技能：
- cua (pip-install) - Computer Use Agent
- fireworks-tech-graph (git-clone) - 技术流程图
- excalidraw-diagram-generator (git-clone) - 手绘风格图表
- architecture-diagram-generator (git-clone) - 系统架构图
- hyperframes (npm-install) - HeyGen 视频生成
- guizang-ppt-skill (git-clone) - PPT 自动生成

是否安装？(y/n)
```

### 3. 执行安装

用户确认后：

```typescript
// 批量安装所有未安装技能
const results = await installer.batchInstall(pending)

// 或逐个安装（更安全）
for (const config of pending) {
  const result = await installer.install(config)
  if (!result.success) {
    // 失败时询问用户是否继续
    console.log(`安装失败: ${config.skillId} - ${result.error}`)
  }
}
```

### 4. 安装验证

```typescript
// 验证技能是否安装成功
const isInstalled = await installer.verify('cua')
// 返回: true/false
```

## 安装方法映射

| 方法 | 适用场景 | 命令示例 |
|------|---------|---------|
| **git-clone** | GitHub 技能仓库 | `git clone --depth 1 https://github.com/xxx/skill ~/.claude/skills/skill` |
| **npm-install** | npm 包 | `npm install -g @scope/package` |
| **pip-install** | Python 包 | `pip install package` |
| **curl-download** | 单文件下载 | `curl -o ~/.claude/skills/skill/SKILL.md https://...` |

## 技能安装配置

预定义在 `SkillInstaller.INSTALL_CONFIGS`:

| Skill ID | 安装方法 | 安装命令 |
|----------|---------|---------|
| cua | pip-install | `pip install cua` |
| fireworks-tech-graph | git-clone | `git clone https://github.com/yizhiyanhua-ai/fireworks-tech-graph` |
| excalidraw-diagram-generator | git-clone | `git clone https://github.com/github/awesome-copilot` |
| architecture-diagram-generator | git-clone | `git clone https://github.com/Cocoon-AI/architecture-diagram-generator` |
| hyperframes | npm-install | `npm install -g @heygen/hyperframes` |
| guizang-ppt-skill | git-clone | `git clone https://github.com/op7418/guizang-ppt-skill` |

## 事件流

```
skills.install-prompt   → 用户确认
skill.install-started   → 开始安装
skill.installed         → 安装成功
skill.install-failed    → 安装失败（含错误信息）
skills.batch-installed  → 批量安装完成
```

## CLI 命令（未来实现）

```bash
# 查看所有技能安装状态
scale skills list --installed

# 检查未安装技能
scale skills check

# 交互式安装
scale skills install --interactive

# 安装特定技能
scale skills install cua
scale skills install fireworks-tech-graph
```
