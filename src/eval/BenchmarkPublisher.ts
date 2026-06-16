import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface BenchmarkData {
  timestamp: string
  version: string
  summary: {
    passAt1: number     // 0-1
    passAt3: number     // 0-1
    totalCases: number
    avgDurationMs: number
    avgTokens: number
    avgCostUsd: number
  }
  byCategory: Record<string, {
    total: number
    passed: number
    avgDurationMs: number
    avgTokens: number
  }>
  trends: Array<{
    date: string
    passAt1: number
    totalCases: number
  }>
}

export function publishBenchmark(data: BenchmarkData, outputDir: string = '.scale/benchmarks'): string {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const filename = `benchmark-${data.version}-${data.timestamp.replace(/[:.]/g, '-')}.json`
  const path = join(outputDir, filename)
  writeFileSync(path, JSON.stringify(data, null, 2))
  return path
}

export function createBenchmarkSummary(version: string): BenchmarkData {
  return {
    timestamp: new Date().toISOString(),
    version,
    summary: {
      passAt1: 0,
      passAt3: 0,
      totalCases: 0,
      avgDurationMs: 0,
      avgTokens: 0,
      avgCostUsd: 0,
    },
    byCategory: {},
    trends: [],
  }
}
