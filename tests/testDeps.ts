// SCALE Engine — Test Dependency Declarations
// Register touchfile dependencies for diff-based test selection.

import { registerTestDependency } from '../src/testing/DiffTestSelector.js'

// Runtime
registerTestDependency({
  testFile: 'tests/runtime/aiOsRuntime.test.ts',
  touchfiles: ['src/runtime/**', 'src/workflow/**'],
  tier: 'gate',
})

// Workflow
registerTestDependency({
  testFile: 'tests/workflow/sessionPreamble.test.ts',
  touchfiles: ['src/workflow/SessionPreamble.ts'],
  tier: 'gate',
})

registerTestDependency({
  testFile: 'tests/workflow/shipPipeline.test.ts',
  touchfiles: ['src/workflow/ShipPipeline.ts', 'src/tools/**', 'src/workflow/ReviewAnalyzer.ts', 'src/workflow/VerificationProfile.ts'],
  tier: 'gate',
})

// Skills
registerTestDependency({
  testFile: 'tests/skills/skillFrontmatter.test.ts',
  touchfiles: ['src/skills/**'],
  tier: 'gate',
})

// Evolution
registerTestDependency({
  testFile: 'tests/evolution/sessionLearnings.test.ts',
  touchfiles: ['src/evolution/**'],
  tier: 'gate',
})

// Testing
registerTestDependency({
  testFile: 'tests/testing/diffTestSelector.test.ts',
  touchfiles: ['src/testing/**'],
  tier: 'gate',
})

// API
registerTestDependency({
  testFile: 'tests/api/aiOsCli.test.ts',
  touchfiles: ['src/api/**', 'src/cli/**'],
  tier: 'gate',
})
