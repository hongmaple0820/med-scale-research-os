#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const options = parseArgs(process.argv.slice(2))
const smokeRoot = options.tempDir ? resolve(options.tempDir) : join(tmpdir(), `medscale-release-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const medscaleInvocation = parseCommandLine(options.medscaleCommand ?? 'node dist/api/medscale.js')
const results = []

try {
  mkdirSync(smokeRoot, { recursive: true })
  runSmoke()
  writeSummary('passed')
} catch (error) {
  writeSummary('failed', error)
  process.exitCode = 1
} finally {
  if (!options.keepTemp && !options.tempDir) rmSync(smokeRoot, { recursive: true, force: true })
}

function runSmoke() {
  assertPackageMetadata()
  assertEntrypointExists()
  assertSetupPlan()
  assertSetupApply()
  assertVisualSetup()
  assertDoctor()
  assertUsageEnvelopeIngest()
  assertPackContents()
}

function assertPackageMetadata() {
  const metadata = runJson('package-metadata', 'node', ['-e', [
    "const p=require('./package.json')",
    "console.log(JSON.stringify({name:p.name,bin:p.bin,repository:p.repository,files:p.files,scripts:p.scripts}))",
  ].join(';')])

  assert(metadata.name === '@hongmaple0820/med-scale-research-os', 'package name should be the MedSCALE npm identity')
  assert(Object.keys(metadata.bin ?? {}).join(',') === 'medscale', 'package bin should expose only medscale')
  assert(String(metadata.repository?.url ?? '').includes('hongmaple0820/med-scale-research-os'), 'repository should point to the MedSCALE GitHub repo')
  assert(Array.isArray(metadata.files) && metadata.files.includes('target-research-platform/src'), 'package files should include the medical Python kernel')
  assert(
    typeof metadata.scripts?.['smoke:medscale-release'] === 'string',
    'package scripts should expose smoke:medscale-release',
  )
}

function assertEntrypointExists() {
  const entrypoint = join(repoRoot, 'dist', 'api', 'medscale.js')
  assert(existsSync(entrypoint), 'dist/api/medscale.js is missing; run npm run build before release smoke')
}

function assertSetupPlan() {
  const setup = runMedscaleJson('medscale-setup-json', ['setup', '--json'])
  const capabilities = Object.fromEntries((setup.capabilities ?? []).map(capability => [capability.id, capability]))
  const releaseCapabilities = [
    'native-cli',
    'medical-workflow',
    'medical-skills',
    'mcp-server-map',
    'pubmed-openalex',
    'package-audit',
    'figure-refs',
    'token-cost',
  ]
  assert(setup.schema === 'medscale.setup_plan.v1', 'setup should emit medscale.setup_plan.v1')
  assert(setup.product === 'MedSCALE Research OS', 'setup should report MedSCALE Research OS')
  assert(setup.summary?.requiredMissing?.length === 0, 'setup should not report required missing capabilities')
  for (const capabilityId of releaseCapabilities) {
    assert(capabilities[capabilityId], `setup should list ${capabilityId}`)
    assert(capabilities[capabilityId]?.status !== 'missing', `setup should not report ${capabilityId} as missing`)
  }
  assert(capabilities['native-cli']?.status === 'ready', 'native CLI should be ready')
  assert(capabilities['token-cost']?.status === 'partial', 'token/cost should remain partial until real workspace usage exists')
}

function assertSetupApply() {
  const workspace = join(smokeRoot, 'empty-medscale-workspace')
  mkdirSync(workspace, { recursive: true })
  const setup = runMedscaleJson('medscale-setup-apply-json', ['setup', '--dir', workspace, '--apply', '--json'])
  assert(setup.applyReport?.ok === true, 'setup --apply should initialize an empty workspace')
  assert(setup.applyReport?.copied >= 5, 'setup --apply should copy bundled medical platform resources')

  const doctor = runMedscaleJson('medscale-doctor-applied-json', ['doctor', '--dir', workspace, '--json'])
  const cards = Object.fromEntries((doctor.runtimeReadiness?.cards ?? []).map(card => [card.id, card]))
  assert(doctor.runtimeReadiness?.requiredMissing?.length === 0, 'applied workspace should not have required missing capabilities')
  assertDoctorCardNonFail(cards, 'medical_workflow')
  assertDoctorCardNonFail(cards, 'medical_retrieval')
  assertDoctorCardNonFail(cards, 'package_audit')
}

function assertVisualSetup() {
  const en = runMedscaleText('medscale-visual-en', ['setup', '--visual', '--lang', 'en'])
  assert(en.includes('MedSCALE Research OS Visual Setup Guide'), 'English visual setup should render its title')
  assert(en.includes('Capability lanes'), 'English visual setup should include capability lanes')
  assert(en.includes('npx -y @hongmaple0820/med-scale-research-os setup --visual --lang en'), 'English visual setup should include npx command')

  const zh = runMedscaleText('medscale-visual-zh', ['setup', '--visual', '--lang', 'zh'])
  assert(zh.includes('MedSCALE Research OS'), 'Chinese visual setup should render the product name')
  assert(zh.includes('@hongmaple0820/med-scale-research-os'), 'Chinese visual setup should include package identity')
}

function assertDoctor() {
  const doctor = runMedscaleJson('medscale-doctor-json', ['doctor', '--json'])
  const readiness = doctor.runtimeReadiness ?? {}
  const cards = Object.fromEntries((readiness.cards ?? []).map(card => [card.id, card]))
  assert(doctor.ok === true, 'doctor should be ok even when optional capabilities warn')
  assert(readiness.requiredMissing?.length === 0, 'doctor should not report required missing capabilities')
  assertDoctorCardNonFail(cards, 'medical_retrieval')
  assertDoctorCardNonFail(cards, 'package_audit')
  assertDoctorCardNonFail(cards, 'figure_refs')
  assert(cards.token_cost?.state === 'warning', 'doctor should warn for empty token/cost ledger')
}

function assertDoctorCardNonFail(cards, cardId) {
  const state = cards[cardId]?.state
  assert(state === 'pass' || state === 'warning', `doctor should expose ${cardId} without failing`)
}

function assertUsageEnvelopeIngest() {
  const meta = join(smokeRoot, 'usage-meta.json')
  const manifest = join(smokeRoot, 'usage-manifest.json')
  const payload = {
    usage_envelopes: [{
      schema: 'medscale.usage_envelope.v1',
      usage_id: 'MSU-release-smoke-envelope',
      provider: 'openai',
      model: 'gpt-4o-mini',
      medical_lane: 'literature',
      source_role: 'literature_deep_review',
      target: 'CDK4',
      disease: 'breast cancer',
      usage: {
        prompt_tokens: 700,
        completion_tokens: 80,
        cache_read_input_tokens: 100,
      },
    }],
  }
  writeFileSync(meta, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
  writeFileSync(manifest, `${JSON.stringify({ usage: { envelopes: payload.usage_envelopes } }, null, 2)}\n`, 'utf-8')

  const report = runMedscaleJson('medscale-token-ingest-envelope', [
    'token',
    'ingest',
    '--dir',
    smokeRoot,
    '--file',
    `${meta},${manifest}`,
    '--json',
  ])
  assert(report.schema === 'medscale.token_ingest.v1', 'token ingest should emit medscale.token_ingest.v1')
  assert(report.recorded === 1, 'token ingest should record one unique envelope')
  assert(report.duplicates === 1, 'token ingest should deduplicate the repeated envelope')
  assert(report.tokenCost?.summary?.totalRecords === 1, 'token ledger should contain one record in the smoke dir')
  assert(report.tokenCost?.summary?.totalTokens === 780, 'token ledger should sum prompt and completion tokens')
}

function assertPackContents() {
  const pack = runJson('npm-pack-dry-run', 'npm', ['pack', '--dry-run', '--json'])
  const entry = Array.isArray(pack) ? pack[0] : pack
  const files = new Set((entry.files ?? []).map(file => file.path))
  const required = [
    'dist/api/medscale.js',
    'dist/cli/targetCommands.js',
    'target-research-platform/main.py',
    'target-research-platform/src/dashboard/app.py',
    'target-research-platform/src/output/usage_envelope.py',
    'target-research-platform/src/output/literature_reviewer.py',
    '.scale/skills.json',
    '.scale/mcp-servers.yaml',
    'README.md',
    'README.en.md',
    'docs/zh/quickstart.md',
    'scripts/workflow/medscale-release-smoke.mjs',
  ]
  for (const path of required) {
    assert(files.has(path), `npm pack should include ${path}`)
  }
  assert(![...files].some(path => path.startsWith('target-research-platform/output/')), 'npm pack should exclude target runtime output')
  assert(![...files].some(path => path.startsWith('output/')), 'npm pack should exclude root runtime output')
  assert(![...files].some(path => path.includes('__pycache__/') || /\.py[cod]$/i.test(path)), 'npm pack should exclude Python bytecode caches')
}

function runMedscaleJson(name, args) {
  return runJson(name, medscaleInvocation.file, [...medscaleInvocation.args, ...args])
}

function runMedscaleText(name, args) {
  return runCommand(name, medscaleInvocation.file, [...medscaleInvocation.args, ...args]).stdout
}

function runJson(name, command, args) {
  const result = runCommand(name, command, args)
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`${name} did not return valid JSON: ${error.message}\n${result.stdout}`)
  }
}

function runCommand(name, command, args) {
  const startedAt = new Date().toISOString()
  const invocation = resolveInvocation(command, args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 30 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  })
  const stdout = String(result.stdout ?? '')
  const stderr = String(result.stderr ?? '')
  const exitCode = typeof result.status === 'number' ? result.status : 1
  results.push({
    name,
    command: formatCommand(invocation.command, invocation.args),
    exitCode,
    startedAt,
    endedAt: new Date().toISOString(),
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr + (result.error ? `\n${result.error.message}` : '')),
  })
  if (exitCode !== 0) {
    throw new Error(`${name} failed with exit code ${exitCode}\n${tail(stderr) || tail(stdout)}`)
  }
  return { stdout, stderr, exitCode }
}

function resolveInvocation(command, args) {
  const resolved = resolveWindowsCommandShim(resolveCommandPath(command) ?? command)
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const comspec = process.env.ComSpec || 'cmd.exe'
    return { command: comspec, args: ['/d', '/c', 'call', resolved, ...args] }
  }
  return { command: resolved, args }
}

function resolveWindowsCommandShim(command) {
  if (process.platform !== 'win32') return command
  if (!/[\\/]/.test(command) || extname(command)) return command
  for (const extension of ['.cmd', '.exe', '.bat', '.com']) {
    const candidate = `${command}${extension}`
    if (existsSync(candidate)) return candidate
  }
  return command
}

function resolveCommandPath(command) {
  if (/[\\/]/.test(command)) return command
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(lookup, [command], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (result.status !== 0) return null
  return String(result.stdout ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) ?? null
}

function parseArgs(args) {
  const parsed = {
    keepTemp: false,
    timeoutMs: 120_000,
    tempDir: undefined,
    medscaleCommand: undefined,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--keep-temp') parsed.keepTemp = true
    else if (arg === '--temp-dir') parsed.tempDir = args[++index]
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number.parseInt(args[++index] ?? '', 10)
    else if (arg === '--medscale-command') parsed.medscaleCommand = args[++index]
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('Usage: node scripts/workflow/medscale-release-smoke.mjs [--medscale-command "node dist/api/medscale.js"] [--keep-temp]\n')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) parsed.timeoutMs = 120_000
  return parsed
}

function parseCommandLine(command) {
  const tokens = []
  let current = ''
  let quote = null
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (quote) throw new Error(`Unterminated quote in command: ${command}`)
  if (current) tokens.push(current)
  if (tokens.length === 0) throw new Error('Command is empty')
  return { file: tokens[0], args: tokens.slice(1) }
}

function writeSummary(status, error) {
  const report = {
    schema: 'medscale.release_smoke.v1',
    status,
    repoRoot,
    smokeRoot,
    medscaleCommand: formatCommand(medscaleInvocation.file, medscaleInvocation.args),
    results,
    error: error ? String(error.stack ?? error.message ?? error) : undefined,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

function formatCommand(command, args) {
  return [command, ...args].map(quoteArg).join(' ')
}

function quoteArg(value) {
  const raw = String(value)
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(raw)) return raw
  return `"${raw.replace(/(["\\$`])/g, '\\$1')}"`
}

function tail(value) {
  return String(value ?? '').split(/\r?\n/).filter(Boolean).slice(-20).join('\n')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
