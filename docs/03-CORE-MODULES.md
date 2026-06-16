# 03 — 核心模块设计

> 本篇详细描述 7 个核心模块的接口、内部结构、关键算法和时序。
> 每个模块独立成节，可作为模块开发的"详细设计文档"。

---

## §3.1 EventBus 模块

### 职责
内存中的 pub/sub + JSONL 持久化 + 事件重放。所有模块通过它解耦通信。

### 接口

```typescript
interface IEventBus {
  // 订阅
  on<T>(type: EventType | '*', handler: EventHandler<T>): Subscription
  once<T>(type: EventType, handler: EventHandler<T>): void

  // 发布
  emit<T>(type: EventType, payload: T, opts?: EmitOptions): Event<T>
  emitAsync<T>(type: EventType, payload: T, opts?: EmitOptions): Promise<Event<T>>

  // 中间件 (用于持久化、过滤、增强)
  use(middleware: EventMiddleware): void

  // 重放
  replay(filter: ReplayFilter, handler: EventHandler): Promise<void>

  // 查询
  query(filter: QueryFilter): Promise<Event[]>
}

interface EmitOptions {
  sessionId?: string
  actor?: Actor
  artifactId?: string
  causedBy?: string
  correlationId?: string
}
```

### 内部结构

```
EventBus
├── handlers: Map<EventType, Set<Handler>>
├── middlewares: Middleware[]
├── persistor: JSONLPersistor      ← 默认中间件，落盘
└── memoryRing: Event[]            ← 最近 1000 条，加速查询
```

### 持久化策略

```typescript
// 中间件链
PersistenceMiddleware:
  on every emit:
    1. write to events.jsonl (append, no fsync)
    2. push to memoryRing (evict if > 1000)
    3. continue to handlers

// 每 5 秒 fsync 一次（可配置）
setInterval(() => persistor.flush(), 5000)
```

### 关键设计决策

- **不用 EventEmitter**：要类型安全 + 中间件能力
- **同步发射，异步处理**：emit 立即返回 Event 对象，handler 异步执行
- **不丢事件**：handler 异常被 catch，不影响后续 handler
- **事件不可变**：emit 后 Event 对象 freeze

---

## §3.2 Artifact + FSM 模块

### 职责
Artifact 的 CRUD + 状态机迁移引擎 + 文件系统/SQLite 双写。

### 核心接口

```typescript
interface IArtifactStore {
  create(input: CreateArtifactInput): Promise<Artifact>
  get(id: string): Promise<Artifact | null>
  update(id: string, updates: Partial<Artifact>): Promise<Artifact>
  delete(id: string): Promise<void>

  query(filter: ArtifactFilter): Promise<Artifact[]>
  findChildren(parentId: string, type?: ArtifactType): Promise<Artifact[]>
  findParents(childId: string): Promise<Artifact[]>

  // Gate 相关
  setGate(artifactId: string, gate: Gate): Promise<void>
  checkGates(artifactId: string): Promise<GateCheckResult>
}

interface IFSM {
  // 注册状态机定义（启动时调用）
  register<S extends string, A extends string>(
    type: ArtifactType,
    definition: FSMDefinition<S, A>
  ): void

  // 检查是否可以迁移（不实际执行）
  canTransition(artifactId: string, action: string): Promise<{
    allowed: boolean
    blockedBy?: string[]
  }>

  // 执行迁移（核心 API）
  transition(
    artifactId: string,
    action: string,
    context: TransitionContext
  ): Promise<TransitionResult>

  // 获取当前状态可用的所有 actions
  availableActions(artifactId: string): Promise<string[]>
}

interface TransitionResult {
  success: boolean
  artifact?: Artifact
  blockedBy?: GuardFailure[]
  effectsExecuted: string[]
}
```

### FSM 引擎核心算法（伪代码）

```typescript
async function transition(artifactId, action, context):
  artifact = await store.get(artifactId)
  if not artifact: throw NotFound

  fsm = registry.get(artifact.type)
  transitionDef = fsm.transitions.find(
    t => t.from === artifact.status && t.action === action
  )
  if not transitionDef:
    throw InvalidTransition(`${artifact.status} 不支持 ${action}`)

  # Phase 1: 检查所有 guards
  guardFailures = []
  for guard in transitionDef.guards:
    passed = await guard.check(artifact, context)
    if not passed:
      guardFailures.push({guard: guard.name, msg: guard.errorMessage})

  if guardFailures.length > 0:
    return {success: false, blockedBy: guardFailures}

  # Phase 2: 写状态历史 + 更新状态
  await db.transaction(async tx => {
    eventId = await eventBus.emit('artifact.transitioned', {...})
    await tx.insert('status_history', {
      artifact_id: artifactId,
      from_status: artifact.status,
      to_status: transitionDef.to,
      at: Date.now(),
      by: context.actor,
      reason: context.reason,
      event_id: eventId
    })
    await tx.update('artifacts', {status: transitionDef.to, ...})
  })

  # Phase 3: 执行所有 effects（异步，不阻塞返回）
  effectsExecuted = []
  for effect in transitionDef.effects:
    try:
      await effect.run(artifact, context)
      effectsExecuted.push(effect.name)
    except Exception as e:
      log.error(`Effect ${effect.name} failed: ${e}`)
      # Effect 失败不回滚状态迁移（事件已发出，下游可补偿）

  return {success: true, artifact: updated, effectsExecuted}
```

### 文件系统 + SQLite 双写策略

```typescript
async function writeArtifact(artifact, content):
  contentPath = `.scale/artifacts/${artifact.type}/${artifact.id}.md`

  # 先写文件，再写 DB（崩溃恢复时以 DB 为准）
  # 如果写 DB 失败，孤儿文件会被定期清理
  await fs.writeFile(contentPath, content)

  await db.transaction(async tx => {
    await tx.upsert('artifacts', {...artifact, content_ref: contentPath})
    await eventBus.emit('artifact.created' or 'artifact.updated', ...)
  })
```

### 索引重建机制（应对腐败）

```typescript
async function rebuildFromEvents(fromTimestamp = 0):
  log.info('Rebuilding artifact projection from events...')
  await db.exec('DELETE FROM artifacts')
  await db.exec('DELETE FROM status_history')
  await db.exec('DELETE FROM gates')

  for event of eventBus.replay({fromTimestamp}):
    switch event.type:
      case 'artifact.created':
        await db.insert('artifacts', event.payload)
      case 'artifact.transitioned':
        await db.update('artifacts', {status: event.payload.to})
        await db.insert('status_history', {...})
      case 'artifact.gate_checked':
        await db.upsert('gates', {...})
      ...

  log.info('Rebuild complete')
```

---

## §3.3 TaskEngine 模块

### 职责
长时任务执行 + Checkpoint + 跨会话 Resume + 子任务派发。

### 核心接口

```typescript
interface ITaskEngine {
  // 创建任务（基于 Task Artifact）
  schedule(taskId: string, opts?: ScheduleOptions): Promise<void>

  // 执行（同步阻塞或异步）
  execute(taskId: string): Promise<ExecutionResult>

  // 控制
  pause(taskId: string, reason: string): Promise<void>
  resume(taskId: string): Promise<void>
  cancel(taskId: string, reason: string): Promise<void>

  // 检查点
  checkpoint(taskId: string, label?: string): Promise<Checkpoint>
  restoreFromCheckpoint(taskId: string, checkpointId?: string): Promise<void>

  // 查询
  getStatus(taskId: string): Promise<TaskRuntime>
  getRunningTasks(): Promise<TaskRuntime[]>
}
```

### 关键机制

#### 1. Checkpoint 机制

```typescript
async function checkpoint(taskId, label):
  task = await store.get(taskId)
  runtime = runtimes.get(taskId)

  # 创建 git commit (如果配置启用)
  commitSha = null
  if config.gitCheckpoint:
    await execa('git', ['add', '-A'])
    const result = await execa('git', ['commit', '-m', `checkpoint: ${taskId}`, '--allow-empty'])
    commitSha = parseCommitSha(result.stdout)

  # 序列化运行时状态
  state = {
    currentStepIndex: runtime.currentStepIndex,
    completedSteps: runtime.completedSteps,
    context: runtime.context,
    eventOffset: await eventBus.getCurrentOffset(),
    commitSha
  }

  checkpointId = `CKP-${Date.now()}`
  await fs.writeJSON(
    `.scale/checkpoints/${taskId}/${checkpointId}.json`,
    state
  )

  await eventBus.emit('task.checkpointed', {taskId, checkpointId})
  return {id: checkpointId, ...state}
```

#### 2. Resume 协议

```typescript
async function restoreFromCheckpoint(taskId, checkpointId?):
  if not checkpointId:
    checkpointId = await getLatestCheckpointId(taskId)
  state = await fs.readJSON(`.scale/checkpoints/${taskId}/${checkpointId}.json`)

  # 恢复 git 工作区（可选）
  if state.commitSha and config.restoreWorkingTree:
    await execa('git', ['reset', '--hard', state.commitSha])

  # 重建任务运行时
  runtime = {
    taskId,
    currentStepIndex: state.currentStepIndex,
    completedSteps: state.completedSteps,
    context: state.context,
    status: 'PAUSED'
  }
  runtimes.set(taskId, runtime)

  # 修正 Artifact 状态
  await fsm.transition(taskId, 'pause', {
    actor: {kind: 'system', component: 'TaskEngine'},
    reason: 'Restored from checkpoint'
  })

  await eventBus.emit('task.restored', {taskId, checkpointId})
```

#### 3. 子任务派发

```typescript
async function executeStep(task, step):
  if step.requiresSubagent:
    # 派发子代理（独立上下文，限定工具集）
    subagent = await subagentManager.spawn({
      role: step.requiredRole,
      tools: step.allowedTools,
      maxTokens: step.tokenBudget,
      timeoutMs: step.timeoutMs ?? 30 * 60 * 1000
    })

    try:
      result = await subagent.run(step.prompt, step.context)
      step.result = result
      step.status = 'completed'
    catch (e) {
      if e instanceof TimeoutError:
        step.status = 'failed'
        step.error = 'timeout'
        await fsm.transition(task.id, 'fail', {reason: 'subagent timeout'})
      else: throw e
    } finally {
      await subagent.cleanup()
    }
  else:
    # 简单步骤，直接在主进程执行
    step.result = await step.execute(task.context)
```

#### 4. 漂移检测

```typescript
# 每完成 N 步触发
async function checkDrift(task):
  spec = await store.findParents(task.id, 'Spec')[0]
  if not spec: return

  northStar = (spec.payload as SpecPayload).northStar

  # 调用 LLM 评估当前进度是否还在 northStar 上
  judgment = await llm.judge({
    prompt: `当前任务的 northStar 是: "${northStar}"
             已完成步骤: ${task.completedSteps.map(s => s.name).join(', ')}
             这些步骤是否还在 northStar 范围内？`,
    schema: {drift: 'boolean', confidence: 'number', reason: 'string'}
  })

  if judgment.drift and judgment.confidence > 0.7:
    await eventBus.emit('task.drift_detected', {taskId, judgment})
    await fsm.transition(task.id, 'pause', {reason: 'drift detected'})
```

---

## §3.4 KnowledgeBase 模块

### 职责
存储、检索、衰减、升级知识。

### 核心接口

```typescript
interface IKnowledgeBase {
  // 写入（仅 LessonExtractor 调用）
  add(entry: KnowledgeEntry): Promise<KnowledgeEntry>

  // 检索
  recall(query: KnowledgeQuery): Promise<KnowledgeEntry[]>
  recallByVector(text: string, topK: number): Promise<KnowledgeEntry[]>

  // 反馈（提升/降低 relevance）
  markHelpful(id: string, sessionId: string): Promise<void>
  markUseless(id: string, sessionId: string): Promise<void>

  // 验证（人审）
  verify(id: string, verifiedBy: string): Promise<void>

  // 维护
  decay(): Promise<void>                          # 定期降低 relevance
  prune(threshold: number): Promise<number>       # 删除 relevance < threshold
  merge(ids: string[]): Promise<KnowledgeEntry>   # 合并相似条目
}
```

### LessonExtractor 4 道 Gate

```typescript
class LessonExtractor:
  triggers = [
    'defect.closed_with_root_cause',
    'task.completed_after_3+_retries',
    'release.succeeded',
    'release.rolled_back'
  ]

  async extract(triggerEvent):
    # 让 LLM 提议 Lesson
    candidate = await llm.complete({
      prompt: lessonExtractionPrompt(triggerEvent),
      schema: LessonProposalSchema
    })

    # Gate 1: 触发事件类型
    if triggerEvent.type not in this.triggers:
      return reject('not in trigger list')

    # Gate 2: 非 Google 可得（防止 AI 总结大众常识）
    googleHits = await this.searchEngine.count(candidate.problem)
    if googleHits > 1000:
      return reject('too generic, googleable')

    # Gate 3: 上下文特定（必须引用具体 Artifact）
    referencedArtifacts = extractArtifactRefs(candidate.solution)
    if referencedArtifacts.length === 0:
      return reject('no specific context, too abstract')

    # Gate 4: 不重复
    similar = await knowledgeBase.recallByVector(candidate.problem, topK=3)
    for item in similar:
      similarity = cosineSimilarity(candidate.embedding, item.embedding)
      if similarity > 0.85:
        # 合并而不是重复
        return await knowledgeBase.merge([item.id, candidate.id])

    # 通过所有 Gate，写入
    await knowledgeBase.add({...candidate, verified: false})
    await eventBus.emit('lesson.proposed', {lessonId: ..., source: triggerEvent})
```

### Relevance 衰减算法

```typescript
# 每天凌晨执行
async function decay():
  entries = await db.query('SELECT * FROM knowledge_entries')
  for entry of entries:
    # 公式：relevance = base * recency * accessBoost
    daysSinceAccess = (now - entry.last_accessed) / DAY_MS
    recencyFactor = exp(-daysSinceAccess / 30)        # 30 天半衰期
    accessBoost = log(1 + entry.access_count) / 5
    newRelevance = clamp(0.05, 1.0,
                         entry.relevance * 0.95 +     # 自然衰减 5%
                         recencyFactor * 0.05 +
                         accessBoost * 0.1)
    await db.update('knowledge_entries', {relevance: newRelevance})
```

### Vector Recall 实现

```typescript
async function recallByVector(text, topK=5):
  embedding = await embedder.embed(text)
  results = await qdrant.search('knowledge', {
    vector: embedding,
    limit: topK * 2,                                  # 多取一些用于过滤
    filter: {must: [{key: 'verified', match: true}]}  # 只召回人审过的
  })

  # 加权重排：相似度 × relevance
  reranked = results.map(r => ({
    id: r.payload.id,
    score: r.score * 0.7 + r.payload.relevance * 0.3
  }))
  reranked.sort((a, b) => b.score - a.score)

  # 只取 topK
  topIds = reranked.slice(0, topK).map(r => r.id)
  entries = await db.query('SELECT * FROM knowledge_entries WHERE id IN (?)', topIds)

  # 副作用：更新 access stats
  for entry of entries:
    await db.update('knowledge_entries', {
      access_count: entry.access_count + 1,
      last_accessed: Date.now()
    }, {id: entry.id})

  await eventBus.emit('lesson.recalled', {ids: topIds, query: text})
  return entries
```

---

## §3.5 Guardrails 模块（最关键）

### 职责
**这是反幻觉、反惰性、反越权的总闸门。** 通过 Hook + Role 网关把"应该做"变成"必须做"。

### 核心接口

```typescript
interface IGateway {
  # 入口：每个 PreToolUse Hook 调用
  preTool(input: ToolUseInput): Promise<GateDecision>

  # 入口：每个 PostToolUse Hook 调用
  postTool(input: ToolResultInput): Promise<void>

  # 入口：Stop Hook 调用
  beforeStop(input: StopInput): Promise<GateDecision>
}

interface GateDecision {
  allow: boolean
  reason?: string                                # 拒绝原因（注入回 AI）
  suggestion?: string                            # 建议下一步
  injectContext?: string[]                       # 注入额外上下文
}
```

### 5 种懒惰检测器

#### Detector 1: BruteRetryDetector（暴力重试）

```typescript
class BruteRetryDetector:
  constructor:
    this.windowMs = 3 * 60 * 1000        # 3 分钟窗口
    this.threshold = 3                   # 同命令 ≥3 次

  async check(input: ToolUseInput): Promise<DetectorResult>:
    cacheKey = `${input.sessionId}:${input.tool}:${hashArgs(input.args)}`
    history = await cache.get(cacheKey, []) as number[]
    history = history.filter(t => Date.now() - t < this.windowMs)
    history.push(Date.now())
    await cache.set(cacheKey, history)

    if history.length >= this.threshold:
      return {
        triggered: true,
        severity: 'block',
        reason: `检测到「暴力重试」：${input.tool}(${summarize(input.args)}) 在 ${this.windowMs/60000} 分钟内已运行 ${history.length} 次。请换策略，并说明你这次的新假设是什么。`
      }
    return {triggered: false}
```

#### Detector 2: IdleToolDetector（工具闲置）

```typescript
class IdleToolDetector:
  # 检测：报错/失败后，未读 log/未搜索就直接改代码
  async check(currentInput: ToolUseInput): Promise<DetectorResult>:
    if currentInput.tool not in ['Edit', 'Write']: return {triggered: false}

    # 看最近 10 个事件
    recent = await eventBus.query({
      sessionId: currentInput.sessionId,
      limit: 10,
      types: ['tool.failed', 'tool.completed']
    })

    # 如果最近有失败，但中间没有任何 Read/Grep/WebSearch
    failureIdx = recent.findIndex(e => e.type === 'tool.failed')
    if failureIdx < 0: return {triggered: false}

    afterFailure = recent.slice(failureIdx)
    investigationTools = ['Read', 'Grep', 'WebSearch', 'Bash']  # Bash 用于看 log
    hasInvestigation = afterFailure.some(e =>
      investigationTools.includes(e.payload.tool)
    )

    if not hasInvestigation:
      return {
        triggered: true,
        severity: 'warn',
        reason: '检测到「工具闲置」：上次工具失败后，你未读任何文件/日志就直接改代码。请先 Read 相关文件或 Bash 看错误日志。',
        suggestion: 'Read the failing test output, OR Grep for similar patterns'
      }
    return {triggered: false}
```

#### Detector 3: BusyLoopDetector（忙碌假象）

```typescript
class BusyLoopDetector:
  # 检测：反复编辑同一文件同一行，但 diff 互相抵消
  async check(input: ToolUseInput): Promise<DetectorResult>:
    if input.tool != 'Edit': return {triggered: false}

    file = input.args.file_path
    edits = await eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: e => e.payload.tool === 'Edit' && e.payload.args.file_path === file,
      limit: 5
    })

    if edits.length < 4: return {triggered: false}

    # 提取所有 oldString → newString
    diffs = edits.map(e => ({old: e.payload.args.old_string, new: e.payload.args.new_string}))

    # 检测来回反复：A→B→A→B 模式
    seen = new Set()
    cycleDetected = false
    for d of diffs:
      key = `${hash(d.old)}:${hash(d.new)}`
      reverseKey = `${hash(d.new)}:${hash(d.old)}`
      if seen.has(reverseKey):
        cycleDetected = true
        break
      seen.add(key)

    if cycleDetected:
      return {
        triggered: true,
        severity: 'block',
        reason: `检测到「忙碌假象」：你在 ${file} 的同一处反复来回修改。请停下来——你最近这次修改是否产生了新信息？没有 = 换思路（不要再改这一行）`,
        suggestion: 'Read the surrounding context, or run a test to get new information'
      }
    return {triggered: false}
```

#### Detector 4: PrematureDoneDetector（声称完成但未验证）

```typescript
class PrematureDoneDetector:
  # 在 StopGate 触发
  async check(input: StopInput): Promise<DetectorResult>:
    sessionId = input.sessionId

    # 本会话中是否声称要修改代码？
    edits = await eventBus.query({
      sessionId,
      types: ['tool.completed'],
      filter: e => ['Edit', 'Write'].includes(e.payload.tool)
    })
    if edits.length === 0: return {triggered: false}      # 没改代码，无需验证

    # 是否跑过验证命令？
    verifications = await eventBus.query({
      sessionId,
      types: ['tool.completed'],
      filter: e => e.payload.tool === 'Bash' && /test|lint|build|typecheck/i.test(e.payload.args.command)
    })

    if verifications.length === 0:
      return {
        triggered: true,
        severity: 'block',
        reason: '检测到「声称完成但未验证」：本会话修改了代码，但未运行任何 test/lint/build 命令。\n请先运行：pnpm test (或对应命令)，确认通过后才能 stop。',
        suggestion: this.suggestCommand(input.projectType)
      }

    # 验证命令必须最近运行过（不能是会话开头的）
    lastVerify = verifications[verifications.length - 1]
    lastEdit = edits[edits.length - 1]
    if lastVerify.timestamp < lastEdit.timestamp:
      return {
        triggered: true,
        severity: 'block',
        reason: '你修改了代码，但最后一次验证是在修改之前运行的。请重新运行验证。'
      }

    # 验证必须通过
    if lastVerify.payload.exitCode != 0:
      return {
        triggered: true,
        severity: 'block',
        reason: '最后一次验证命令失败，不能声称完成。请修复后重试。'
      }

    return {triggered: false}
```

#### Detector 5: BlameShiftDetector（甩锅）

```typescript
class BlameShiftDetector:
  blamePatterns = [
    /可能是环境问题/i,
    /建议你手动/i,
    /it might be|maybe (an?|the) (environment|version|setup)/i,
    /not sure why/i,
    /unable to (determine|figure out|resolve)/i
  ]

  # 在 PostToolUse 钩子（检查 AI 的输出）
  # 注意：需要从 Claude Code 的 hook input 拿到 AI 当前输出文本
  async check(aiOutput: string, sessionId: string): Promise<DetectorResult>:
    if not this.blamePatterns.some(p => p.test(aiOutput)):
      return {triggered: false}

    # 看本次"甩锅"前是否有验证证据
    verifications = await eventBus.query({
      sessionId,
      since: now - 60_000,                # 最近 1 分钟
      types: ['tool.completed'],
      filter: e => e.payload.tool === 'Bash'
    })

    if verifications.length < 2:
      return {
        triggered: true,
        severity: 'warn',
        reason: '检测到「甩锅」迹象：你说"可能是环境问题"但未做足够验证。请至少：\n1. 验证版本（node -v / python --version）\n2. 验证依赖（pnpm list ... / pip show ...）\n3. 重现问题，看完整错误栈\n证据齐了再下结论。'
      }
    return {triggered: false}
```

### Role 权限网关

```typescript
const ROLES: Record<string, RoleDefinition> = {
  Explorer: {
    canCreateArtifacts: ['Insight'],
    canReadArtifacts: ['Need', 'Spec', 'Insight'],
    allowedTools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
    deniedTools: ['Edit', 'Write', 'Bash'],     # 物理隔离，防越权
    requiresUpstream: []
  },
  SpecWriter: {
    canCreateArtifacts: ['Spec'],
    canModifyArtifacts: [{type: 'Spec', statuses: ['DRAFT', 'REVIEWING']}],
    allowedTools: ['Read', 'Write', 'WebSearch'],
    requiresUpstream: ['Need', 'Insight']
  },
  Planner: {
    canCreateArtifacts: ['Plan', 'TestPlan', 'Task'],
    allowedTools: ['Read', 'Grep', 'WebSearch', 'Write'],
    requiresUpstream: [{type: 'Spec', status: 'FROZEN'}]
  },
  Implementer: {
    canCreateArtifacts: ['Change'],
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
    requiresUpstream: [{type: 'Task', status: 'READY'}],
    mustRunAfterEdit: ['lint', 'typecheck']     # 自动 PostToolUse 强制
  },
  Verifier: {
    canCreateArtifacts: ['Evidence', 'Defect'],
    allowedTools: ['Read', 'Bash', 'Browser', 'Grep'],
    deniedTools: ['Edit', 'Write']              # 不允许"自己写测试自己改代码"
  },
  Releaser: {
    canCreateArtifacts: ['Release'],
    allowedTools: ['Read', 'Bash'],
    requiresUpstream: [
      {type: 'Defect', allMatch: 'CLOSED'},
      {type: 'Evidence', allMatch: 'PASS'}
    ]
  }
}
```

### Role 切换协议

```typescript
async function activateRole(sessionId, roleName):
  role = ROLES[roleName]
  if not role: throw UnknownRole

  # 检查上游条件
  for req of role.requiresUpstream:
    artifacts = await store.query({type: req.type, ...req.filter})
    if artifacts.length === 0:
      throw RoleDenied(`需要 ${req.type} 状态为 ${req.status}`)

  await session.update(sessionId, {activeRole: roleName})
  await eventBus.emit('role.activated', {role: roleName})

  # 返回该 Role 的 system prompt 片段（注入回 AI）
  return {
    rolePrompt: await templates.render(`roles/${roleName}.md`),
    allowedTools: role.allowedTools,
    deniedTools: role.deniedTools
  }
```

---

## §3.6 ContextBuilder 模块

### 职责
组装"恰到好处"的上下文，平衡精准度和 Token 预算。

### 核心算法

```typescript
async function buildContext(roleId, currentArtifactId, sessionId):
  budget = {total: 200_000, reserved: 30_000}        # 留给工作区/缓冲
  available = budget.total - budget.reserved          # 170K

  # 优先级队列（高 → 低）
  layers = []

  # P1: 常驻系统规则（必有）
  layers.push({
    name: 'system_rules',
    content: await templates.render('core/system_prompt.md'),
    priority: 1,
    estimatedTokens: 3_000
  })

  # P2: 当前 Role 指令
  if roleId:
    layers.push({
      name: 'role_prompt',
      content: await templates.render(`roles/${roleId}.md`),
      priority: 2,
      estimatedTokens: 1_500
    })

  # P3: 当前 Artifact 内容（North Star + Spec/Plan）
  if currentArtifactId:
    artifact = await store.get(currentArtifactId)
    layers.push({
      name: 'current_artifact',
      content: await renderArtifact(artifact),
      priority: 3,
      estimatedTokens: estimateTokens(content)
    })

    # 如果是 Task，加 northStar
    if artifact.type === 'Task':
      spec = await findRootSpec(artifact)
      layers.push({
        name: 'north_star',
        content: `## NORTH STAR (任务边界，禁止偏离)\n${spec.payload.northStar}\nOUT OF SCOPE: ${spec.payload.outOfScope.join(', ')}`,
        priority: 2.5,
        estimatedTokens: 500
      })

  # P4: 父 Artifact 摘要（不全文，只摘要）
  if currentArtifactId:
    parents = await store.findParents(currentArtifactId)
    summary = parents.map(p => summarize(p, maxTokens=300)).join('\n')
    layers.push({
      name: 'parent_summary',
      content: summary,
      priority: 4,
      estimatedTokens: estimateTokens(summary)
    })

  # P5: 召回相关 Lesson（top 3，verified only）
  if config.enableLessonRecall:
    query = artifact ? artifact.title : ''
    lessons = await knowledgeBase.recallByVector(query, topK=3)
    if lessons.length > 0:
      content = '## 相关历史经验\n' + lessons.map(l => `- ${l.title}: ${truncate(l.content, 200)}`).join('\n')
      layers.push({
        name: 'recalled_lessons',
        content,
        priority: 5,
        estimatedTokens: estimateTokens(content)
      })

  # P6: 项目代码图谱摘要（按需）
  if currentArtifactId and artifact.type in ['Plan', 'Task', 'Change']:
    relevantModules = await codeGraph.findRelevant(artifact)
    if relevantModules.length > 0:
      layers.push({
        name: 'code_graph',
        content: renderModuleGraph(relevantModules),
        priority: 6,
        estimatedTokens: 2_000
      })

  # 按优先级累加，超预算停止
  selected = []
  used = 0
  for layer of layers.sort((a,b) => a.priority - b.priority):
    if used + layer.estimatedTokens > available: break
    selected.push(layer)
    used += layer.estimatedTokens

  await eventBus.emit('context.built', {
    layers: selected.map(l => l.name),
    totalTokens: used
  })

  return {
    system: selected.map(l => l.content).join('\n\n---\n\n'),
    metadata: {totalTokens: used, layers: selected.length}
  }
```

---

## §3.7 BehaviorTracker 模块

### 职责
订阅事件流，统计行为指标，发现模式，触发自进化。

### 核心接口

```typescript
interface IBehaviorTracker {
  start(): void                                      # 订阅事件
  stop(): void

  # 查询当前指标
  getSessionMetrics(sessionId: string): Promise<SessionMetrics>
  getProjectMetrics(): Promise<ProjectMetrics>

  # 模式检测
  detectPatterns(): Promise<DetectedPattern[]>
}
```

### 关键指标

```typescript
interface SessionMetrics {
  sessionId: string
  duration: number
  toolCalls: number
  toolFailures: number
  bruteRetryCount: number
  blameShiftCount: number
  prematureDoneCount: number
  artifactsCreated: number
  rolesUsed: string[]
  modelsUsed: Record<string, number>
  tokensUsed: number
  estimatedCost: number
}

interface ProjectMetrics {
  totalArtifacts: number
  averageLifecycleDuration: number      # Need → Release 平均时长
  successRate: number                   # Release / Need
  topFailurePatterns: Pattern[]
  topLessons: KnowledgeEntry[]
}
```

### 模式发现示例

```typescript
async function detectPatterns():
  patterns = []

  # 模式 1: 某类 Defect 反复出现
  defectsByCategory = await groupBy(
    await store.query({type: 'Defect'}),
    d => d.payload.rootCauseCategory
  )
  for [category, defects] of defectsByCategory:
    if defects.length >= 3:
      patterns.push({
        type: 'recurring_defect',
        category,
        count: defects.length,
        suggestion: 'Promote to Lesson + Hook',
        evidence: defects.map(d => d.id)
      })

  # 模式 2: 某种工具调用反复失败
  failedTools = await groupBy(
    await eventBus.query({type: 'tool.failed'}),
    e => `${e.payload.tool}:${truncate(e.payload.args, 50)}`
  )
  ...

  # 模式 3: Spec 反复修改（不稳定需求）
  specsByVersion = await groupBy(
    await store.query({type: 'Spec'}),
    s => s.id.split('-v')[0]
  )
  for [baseId, versions] of specsByVersion:
    if versions.length >= 5:
      patterns.push({
        type: 'unstable_requirement',
        spec: baseId,
        versions: versions.length,
        suggestion: 'Trigger formal stakeholder review'
      })

  return patterns
```

---

## 模块依赖关系汇总

```
api (CLI/MCP/HTTP)
  ↓
context, orchestration, memory, observability, guardrails
  ↓
artifact (含 FSM)
  ↓
core (EventBus / DI / Logger)
```

**违反这个依赖方向 = 立即 lint 失败。**

