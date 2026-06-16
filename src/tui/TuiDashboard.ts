import * as readline from 'node:readline'
import type { IArtifactStore } from '../artifact/store.js'
import type { IEventBus } from '../core/eventBus.js'

interface TuiState {
  artifacts: Array<{ id: string; type: string; state: string; title: string }>
  gateStatuses: Array<{ stage: string; name: string; status: 'PASS' | 'FAIL' | 'SKIP' | 'PENDING' }>
  recentEvents: string[]
  selectedPane: number // 0=artifacts, 1=gates, 2=events
  selectedIndex: number
}

export async function runTuiDashboard(
  artifactStore: IArtifactStore,
  eventBus: IEventBus,
): Promise<void> {
  const state: TuiState = {
    artifacts: [],
    gateStatuses: [],
    recentEvents: [],
    selectedPane: 0,
    selectedIndex: 0,
  }

  async function refreshState() {
    try {
      const all = await artifactStore.query({ limit: 50 })
      state.artifacts = all.map(a => ({
        id: a.id,
        type: a.type,
        state: (a.status ?? '?') as string,
        title: (a.title ?? a.id ?? '?') as string,
      }))
    } catch {
      state.artifacts = []
    }
    state.gateStatuses = [
      { stage: 'G0', name: 'Build', status: 'PENDING' },
      { stage: 'G3', name: 'TDD', status: 'PENDING' },
      { stage: 'G4', name: 'Lint', status: 'PENDING' },
      { stage: 'G5', name: 'Test', status: 'PENDING' },
      { stage: 'G6', name: 'Coverage', status: 'PENDING' },
      { stage: 'G7', name: 'Security', status: 'PENDING' },
      { stage: 'G8', name: 'Smoke', status: 'PENDING' },
    ]
    state.recentEvents.push(`${new Date().toISOString().slice(11, 19)}  TUI refreshed`)
    if (state.recentEvents.length > 100) state.recentEvents = state.recentEvents.slice(-50)
  }

  await refreshState()

  // Set up raw mode for keyboard input
  readline.emitKeypressEvents(process.stdin)
  if (process.stdin.isTTY) process.stdin.setRawMode(true)

  const WIDTH = process.stdout.columns ?? 80
  const HEIGHT = process.stdout.rows ?? 24

  function render() {
    // Clear screen
    process.stdout.write('\x1b[2J\x1b[H')

    const leftW = Math.floor(WIDTH * 0.35)
    const midW = Math.floor(WIDTH * 0.35)
    const rightW = WIDTH - leftW - midW - 2

    // Header
    console.log(`\x1b[7m SCALE Engine TUI \x1b[0m  [Q]uit [1/2/3]pane [↑↓]nav [R]efresh\n`)

    // Three-column layout
    const maxRows = HEIGHT - 5

    // Artifact pane
    const artifactHeader = `${state.selectedPane === 0 ? '\x1b[7m' : '\x1b[1m'}Artifacts${state.selectedPane === 0 ? '' : ''}\x1b[0m`.padEnd(leftW)
    process.stdout.write(artifactHeader + ' ')
    const gateHeader = `${state.selectedPane === 1 ? '\x1b[7m' : '\x1b[1m'}Gates${state.selectedPane === 1 ? '' : ''}\x1b[0m`.padEnd(midW)
    process.stdout.write(gateHeader + ' ')
    const eventHeader = `${state.selectedPane === 2 ? '\x1b[7m' : '\x1b[1m'}Events${state.selectedPane === 2 ? '' : ''}\x1b[0m`
    process.stdout.write(eventHeader + '\n')
    process.stdout.write('─'.repeat(leftW) + ' ' + '─'.repeat(midW) + ' ' + '─'.repeat(rightW) + '\n')

    for (let i = 0; i < maxRows; i++) {
      // Artifact column
      const a = state.artifacts[i]
      const aSelected = state.selectedPane === 0 && state.selectedIndex === i
      const aLine = a
        ? `${aSelected ? '>' : ' '} ${a.type.slice(0, 4).padEnd(4)} ${(a.state ?? '?').padEnd(10)} ${a.title.slice(0, leftW - 18)}`
        : ''
      process.stdout.write(aLine.padEnd(leftW).slice(0, leftW) + ' ')

      // Gate column
      const g = state.gateStatuses[i]
      const gSelected = state.selectedPane === 1 && state.selectedIndex === i
      const statusIcon = g?.status === 'PASS' ? '\x1b[32m✓\x1b[0m' : g?.status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m○\x1b[0m'
      const gLine = g
        ? `${gSelected ? '>' : ' '} ${g.stage.padEnd(3)} ${g.name.padEnd(12)} ${statusIcon}`
        : ''
      process.stdout.write(gLine.padEnd(midW).slice(0, midW) + ' ')

      // Event column
      const e = state.recentEvents[state.recentEvents.length - maxRows + i]
      const eLine = e ? e.slice(0, rightW - 2) : ''
      process.stdout.write(eLine + '\n')
    }

    // Status bar
    const statusLine = `\n\x1b[7m ${state.artifacts.length} artifacts | ${state.gateStatuses.filter(g => g.status === 'PASS').length}/${state.gateStatuses.length} gates passed | ${state.recentEvents.length} events \x1b[0m`
    process.stdout.write(statusLine.slice(0, WIDTH) + '\n')
  }

  render()

  return new Promise<void>((resolve) => {
    const onKeypress = (str: string, key: readline.Key) => {
      if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
        if (process.stdin.isTTY) process.stdin.setRawMode(false)
        process.stdin.removeListener('keypress', onKeypress)
        process.stdout.write('\x1b[2J\x1b[H')
        resolve()
        return
      }
      if (key.name === 'up') state.selectedIndex = Math.max(0, state.selectedIndex - 1)
      if (key.name === 'down') state.selectedIndex = Math.min(19, state.selectedIndex + 1)
      if (key.name === '1') { state.selectedPane = 0; state.selectedIndex = 0 }
      if (key.name === '2') { state.selectedPane = 1; state.selectedIndex = 0 }
      if (key.name === '3') { state.selectedPane = 2; state.selectedIndex = 0 }
      if (key.name === 'r') void refreshState()
      render()
    }
    process.stdin.on('keypress', onKeypress)
  })
}
