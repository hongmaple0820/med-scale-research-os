// SCALE Engine — Artifact Store (内存版骨架, W3 升级 SQLite)
// 设计参考：docs/03-CORE-MODULES.md §3.2

import type { Artifact, ArtifactType, Gate, ArtifactId } from './types.js'
import { ArtifactNotFoundError } from './types.js'
import type { IEventBus } from '../core/eventBus.js'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface CreateArtifactInput {
  type: ArtifactType
  title: string
  payload: unknown
  parents?: ArtifactId[]
  tags?: string[]
  labels?: Record<string, string>
  createdBy?: import('./types.js').Actor
  initialStatus?: string
  contentBody?: string
}

export interface ArtifactFilter {
  type?: ArtifactType | ArtifactType[]
  status?: string | string[]
  tags?: string[]
  parentId?: ArtifactId
  limit?: number
}

export interface IArtifactStore {
  create(input: CreateArtifactInput): Promise<Artifact>
  get(id: ArtifactId): Promise<Artifact | null>
  update(id: ArtifactId, updates: Partial<Artifact>): Promise<Artifact>
  delete(id: ArtifactId): Promise<void>
  query(filter: ArtifactFilter): Promise<Artifact[]>
  findChildren(parentId: ArtifactId, type?: ArtifactType): Promise<Artifact[]>
  findParents(childId: ArtifactId): Promise<Artifact[]>
  setGate(artifactId: ArtifactId, gate: Gate): Promise<void>
}

export class InMemoryArtifactStore implements IArtifactStore {
  private artifacts = new Map<ArtifactId, Artifact>()
  private artifactsDir: string
  private seq = 0

  constructor(private eventBus: IEventBus, opts: { artifactsDir?: string } = {}) {
    this.artifactsDir = opts.artifactsDir ?? '.scale/artifacts'
    if (!existsSync(this.artifactsDir)) mkdirSync(this.artifactsDir, { recursive: true })
  }

  async create(input: CreateArtifactInput): Promise<Artifact> {
    const id = this.generateId(input.type)
    const contentRef = this.contentPath(input.type, id)
    if (input.contentBody) {
      mkdirSync(dirname(contentRef), { recursive: true })
      writeFileSync(contentRef, input.contentBody, 'utf-8')
    }
    const artifact: Artifact = {
      id, type: input.type, version: 1,
      status: input.initialStatus ?? 'DRAFT',
      statusHistory: [],
      parents: input.parents ?? [],
      children: [],
      title: input.title,
      contentRef,
      payload: input.payload,
      gates: [],
      createdBy: input.createdBy ?? { kind: 'system', component: 'CLI' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: input.tags ?? [],
      labels: input.labels ?? {},
    }
    this.artifacts.set(id, artifact)

    // 更新父 artifacts 的 children
    for (const parentId of artifact.parents) {
      const parent = this.artifacts.get(parentId)
      if (parent) parent.children.push(id)
    }

    this.eventBus.emit('artifact.created', { id, type: input.type, title: input.title }, { artifactId: id, actor: artifact.createdBy })
    return artifact
  }

  async get(id: ArtifactId): Promise<Artifact | null> {
    return this.artifacts.get(id) ?? null
  }

  async update(id: ArtifactId, updates: Partial<Artifact>): Promise<Artifact> {
    const existing = this.artifacts.get(id)
    if (!existing) throw new ArtifactNotFoundError(id)
    const updated: Artifact = { ...existing, ...updates, version: existing.version + 1, updatedAt: Date.now() }
    this.artifacts.set(id, updated)
    this.eventBus.emit('artifact.updated', { id, fields: Object.keys(updates) }, { artifactId: id })
    return updated
  }

  async delete(id: ArtifactId): Promise<void> {
    if (!this.artifacts.has(id)) throw new ArtifactNotFoundError(id)
    this.artifacts.delete(id)
    this.eventBus.emit('artifact.deleted', { id }, { artifactId: id })
  }

  async query(filter: ArtifactFilter): Promise<Artifact[]> {
    let result = Array.from(this.artifacts.values())
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type]
      result = result.filter((a) => types.includes(a.type))
    }
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
      result = result.filter((a) => statuses.includes(a.status))
    }
    if (filter.tags) {
      result = result.filter((a) => filter.tags!.every((t) => a.tags.includes(t)))
    }
    if (filter.parentId) {
      result = result.filter((a) => a.parents.includes(filter.parentId!))
    }
    if (filter.limit) result = result.slice(0, filter.limit)
    return result
  }

  async findChildren(parentId: ArtifactId, type?: ArtifactType): Promise<Artifact[]> {
    return this.query({ parentId, type })
  }

  async findParents(childId: ArtifactId): Promise<Artifact[]> {
    const child = this.artifacts.get(childId)
    if (!child) return []
    return child.parents.map((id) => this.artifacts.get(id)).filter(Boolean) as Artifact[]
  }

  async setGate(artifactId: ArtifactId, gate: Gate): Promise<void> {
    const artifact = this.artifacts.get(artifactId)
    if (!artifact) throw new ArtifactNotFoundError(artifactId)
    const idx = artifact.gates.findIndex((g) => g.name === gate.name)
    if (idx >= 0) artifact.gates[idx] = gate
    else artifact.gates.push(gate)
    this.eventBus.emit('artifact.gate_checked', { artifactId, gate }, { artifactId })
  }

  // ===== 内部 =====
  private generateId(type: ArtifactType): ArtifactId {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    this.seq = (this.seq + 1) % 10000
    return `${type.toUpperCase()}-${date}-${this.seq.toString().padStart(4, '0')}`
  }

  private contentPath(type: ArtifactType, id: ArtifactId): string {
    return join(this.artifactsDir, type.toLowerCase(), `${id}.md`)
  }
}
