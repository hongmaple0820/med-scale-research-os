import { defineCommand } from 'citty'
import { CostAnalyzer } from '../runtime/CostAnalyzer.js'

export const costReportCommand = defineCommand({
  meta: {
    name: 'cost-report',
    description: 'Show token usage and estimated cost by model, task, and day',
  },
  args: {
    days: { type: 'string', default: '30', description: 'Lookback days' },
    format: { type: 'string', default: 'text', description: 'Output format: text|json' },
  },
  async run({ args }) {
    const analyzer = new CostAnalyzer()
    const records = analyzer.loadRecords()
    const breakdown = analyzer.analyze(records, parseInt(args.days as string, 10) || 30)
    const suggestions = analyzer.suggestOptimizations(breakdown)

    if ((args.format as string) === 'json') {
      console.log(JSON.stringify({ breakdown: { total: breakdown.total, byModel: breakdown.byModel, byDay: breakdown.byDay }, suggestions }, null, 2))
    } else {
      console.log(analyzer.renderReport(breakdown, suggestions))
    }
  },
})

export const costOptimizeCommand = defineCommand({
  meta: {
    name: 'cost-optimize',
    description: 'Show cost optimization recommendations',
  },
  args: {},
  async run() {
    const analyzer = new CostAnalyzer()
    const records = analyzer.loadRecords()
    const breakdown = analyzer.analyze(records)
    const suggestions = analyzer.suggestOptimizations(breakdown)

    console.log('--- Cost Optimization Recommendations ---\n')
    for (const s of suggestions) {
      console.log(`  Category: ${s.category}`)
      console.log(`  ${s.description}`)
      console.log(`  Estimated monthly savings: $${s.estimatedMonthlySavings.toFixed(2)}`)
      console.log(`  Confidence: ${Math.round(s.confidence * 100)}%\n`)
    }

    if (suggestions.length === 0) {
      console.log('  No optimization suggestions available.')
    }
  },
})
