# SCALE Engine — Project Glossary
# 借鉴 mattpocock/skills 的 CONTEXT.md 设计
# 定义项目领域语言，所有 phase command 执行前应读取此文件
# 格式: **术语**: 一句话定义。_避免_: 别名列表。

## Language

**Artifact**: A versioned, state-tracked work product (Spec, Plan, Task, Evidence, etc.) managed by the FSM.
_Avoid_: Document, record, item

**FSM (Finite State Machine)**: The state transition engine that enforces legal artifact state flows. Guards block illegal transitions (e.g., unfrozen Spec -> Plan creation).
_Avoid_: Workflow engine

**Gate**: A programmatic quality check (build, lint, test, coverage, security) that must pass before an artifact can transition. Gates produce persisted Evidence.
_Avoid_: Check, validation

**Evidence**: A persisted record of a Gate execution, stored in `.scale/evidence/`. Includes command, exit code, timestamp, and raw output.
_Avoid_: Proof, verification record

**Detector**: A behavioral pattern matcher (e.g., BruteRetryDetector, HallucinationDetector) that fires events when the Agent exhibits suspicious behavior.
_Avoid_: Guard, checker

**Hook**: A lifecycle-triggered command (SessionStart, PreToolUse, PostToolUse, Stop, SessionEnd) injected into the Agent platform's configuration. SCALE hooks call `scale gate ...` or `scale session ...`.
_Avoid_: Callback, trigger

**Phase**: One of six sequential workflow stages: define -> plan -> build -> verify -> review -> ship. Each phase has a dedicated CLI command and FSM guards.
_Avoid_: Step, stage

**Adapter**: A platform-specific integration module that implements `IAgentAdapter` and generates platform configuration (settings, knowledge doc, hooks).
_Avoid_: Plugin, connector

**EvidenceStore**: SQLite + JSON file-based storage for Gate execution results. Key-value with structured JSON records.
_Avoid_: Result store, verification DB

**ReviewStore**: File-based storage for code review records (`.scale/reviews/`). Each record includes findings, changed files, and severity summary.
_Avoid_: Review DB

**ReviewAnalyzer**: A deterministic scanner that inspects git diffs for risky patterns: empty catch, @ts-ignore, focused tests, dangerous shell commands, hardcoded secrets.
_Avoid_: Code scanner, linter

**Gateway**: The runtime guard that intercepts tool calls and evaluates them against registered Detectors. Can block, warn, or allow tool execution.
_Avoid_: Firewall, guard

**EventBus**: An append-only JSONL event stream (`.scale/events/`) that records every action: artifact creation, state transitions, gate results, detector triggers.
_Avoid_: Logger, audit log

**KnowledgeBase**: SQLite-backed persistent memory for lessons, patterns, and domain knowledge. Supports recall queries.
_Avoid_: Memory store

**Evolution**: The self-improvement pipeline: Defect -> Lesson -> Rule -> Hook. Automatically extracts patterns from failures and promotes them to enforceable rules.
_Avoid_: Learning loop

**Out-of-Scope**: A knowledge base (`.scale/out-of-scope/`) that records rejected feature requests with reasoning. Prevents re-litigating prior decisions.
_Avoid_: Rejected features

**Agent Brief**: A structured, durable work specification (category, current/desired behavior, key interfaces, acceptance criteria, out-of-scope) embedded in Task payloads.
_Avoid_: Task description, issue body

## Relationships

- An **Artifact** transitions through states governed by the **FSM**
- Each transition may require **Gates** to pass, producing **Evidence**
- **Detectors** run within the **Gateway** and emit events to the **EventBus**
- **Hooks** are injected by **Adapters** into the Agent platform
- **Phases** map to CLI commands that create/transition **Artifacts**
- **ReviewAnalyzer** inspects diffs during the **review** phase and writes to **ReviewStore**
- **Evolution** reads from **EventBus** (defects) and writes to **KnowledgeBase** (lessons/rules)

## Flagged ambiguities

- "Workflow" was used to mean both the six-phase pipeline and the YAML-based workflow presets — resolved: **Phase pipeline** (define->ship) vs **Workflow preset** (YAML definitions)
- "Guard" was used interchangeably with Gate, Detector, and Hook — resolved: **Gate** (quality check), **Detector** (pattern matcher), **Hook** (lifecycle command)
- "Evidence" was conflated with "Proof" — resolved: **Evidence** is the persisted record; proof is a human judgment about whether the evidence is sufficient
