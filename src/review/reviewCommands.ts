import { defineCommand } from 'citty'

export const reviewCommand = defineCommand({
  meta: {
    name: 'review',
    description: 'Cross-model review — multiple models independently review a change',
  },
  args: {
    diff: { type: 'string', description: 'Git diff reference (e.g. HEAD~1)' },
    models: { type: 'string', default: 'claude-sonnet', description: 'Comma-separated model list' },
    files: { type: 'string', description: 'Specific files to review' },
  },
  async run({ args }) {
    const { CrossModelReviewer } = await import('./CrossModelReviewer.js')
    const reviewer = new CrossModelReviewer()

    console.log('Cross-model review requested')
    console.log(`  Models: ${args.models}`)
    console.log(`  Diff: ${args.diff ?? 'HEAD'}`)
    console.log('\nNote: Actual model invocation is delegated to the hosting agent.\n')
    console.log('Review framework initialized. Use individual model outputs as input to:')
    console.log('  reviewer.aggregate([review1, review2, ...])')
    console.log('  reviewer.renderReport(result)')
  },
})
