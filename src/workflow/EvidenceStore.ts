import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GateEvidence, GateResult, GateStage } from './types.js'

export interface GateEvidenceRecord {
  id: string
  gate: GateStage
  status: GateResult['status']
  passed: boolean
  evidence: string
  evidenceItems: GateEvidence[]
  blockers: string[]
  durationMs: number
  createdAt: number
}

export class EvidenceStore {
  private evidenceDir: string

  constructor(scaleDir = process.env.SCALE_DIR ?? '.scale') {
    this.evidenceDir = join(scaleDir, 'evidence')
    if (!existsSync(this.evidenceDir)) mkdirSync(this.evidenceDir, { recursive: true })
  }

  saveGateResult(result: GateResult): GateEvidenceRecord {
    const record: GateEvidenceRecord = {
      id: `GATE-${result.gate}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      gate: result.gate,
      status: result.status,
      passed: result.passed,
      evidence: result.evidence,
      evidenceItems: result.evidenceItems ?? [],
      blockers: result.blockers,
      durationMs: result.durationMs,
      createdAt: Date.now(),
    }
    const file = join(this.evidenceDir, `${record.id}.json`)
    writeFileSync(file, JSON.stringify(record, null, 2), 'utf-8')
    return record
  }

  listGateResults(limit = 20): GateEvidenceRecord[] {
    if (!existsSync(this.evidenceDir)) return []
    return readdirSync(this.evidenceDir)
      .filter(file => file.endsWith('.json'))
      .map(file => this.readRecordFile(join(this.evidenceDir, file)))
      .filter((record): record is GateEvidenceRecord => Boolean(record))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }

  getGateResult(id: string): GateEvidenceRecord | null {
    const file = join(this.evidenceDir, `${id}.json`)
    return this.readRecordFile(file)
  }

  private readRecordFile(file: string): GateEvidenceRecord | null {
    try {
      return JSON.parse(readFileSync(file, 'utf-8')) as GateEvidenceRecord
    } catch {
      return null
    }
  }
}
