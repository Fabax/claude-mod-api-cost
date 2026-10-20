import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROWS = [
  ['s1', 'website', '2026-10-01', 'claude-opus-5-5', 0, 0, 1_000_000, 0, 0, 0, 0],
  ['s1', 'notes', '2026-10-02', 'claude-opus-5-5', 0, 0, 500_000, 0, 0, 0, 3],
]

const ACCOUNT = { type: 'claude_pro', tier: 'default_claude_ai', since: '2026-01-01T12:00:00Z' }

// The engine beneath the mod: a clock on 2026-10-18, the month already
// imported, scan.py answering ROWS, and a session with usage limits.
const engine = (on: On) => {
  const clock = mock.clock(on, { now: new Date(2026, 9, 18, 12).getTime() })
  mock.store(on, { 'imported:2026-10-01': true })
  on('process.run', (_$, e) => {
    const isAccount = e.argv.some(arg => arg.endsWith('account.py'))
    const stdout = JSON.stringify(isAccount ? ACCOUNT : { rows: ROWS })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.usage', () =>
    ({ value: {
      startedAt: 0,
      context: {},
      rateLimits: [
        { kind: 'five_hour', percentUsed: 85 },
        { kind: 'seven_day', percentUsed: 40 },
      ],
      cost: { usd: 30.5 },
    } }) as never,
  )

  return clock
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`month and session outputs grow into place on ${surface}`, { options: { planPrice: 20 } }, async ($, on) => {
    const clock = engine(on)
    for (const args of ['month', '']) {
      const { text } = await $.command.run({ command: 'api-cost', args, origin: { kind: 'plugin', name: 'test' } } as never)
      // drawn from a reflowed copy of the text, before the animation moved
      const first = await $.ui.mount({
        plugin: 'api-cost',
        surface,
        component: 'CommandOutput',
        requestId: `first-${args}`,
        props: { command: 'api-cost', args, text: `api-cost:  ${text.replace(/\n/g, '\n ')}`, isErrored: false, isExpanded: false } as never,
      })
      expect(await first.find({ type: 'Text', text: /\$0\.00/ })).toBeDefined()
      await first.unmount()
      await clock.advance(2000)
      const ui = await $.ui.mount({
        plugin: 'api-cost',
        surface,
        component: 'CommandOutput',
        requestId: `msg-${args}`,
        props: { command: 'api-cost', args, text, isErrored: false, isExpanded: false } as never,
      })
      expect(await ui.find({ type: 'Text', text: /\$30\.03/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test(`band shows the month against the plan on ${surface}`, { options: { planPrice: 20 } }, async ($, on) => {
    engine(on)
    await $.command.run({ command: 'api-cost', args: 'month', origin: { kind: 'plugin', name: 'test' } } as never)
    const ui = await $.ui.mount({
      plugin: 'api-cost',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /150%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /85%/ })).toBeDefined()
    await ui.unmount()
  })
}

test('band adds each response as it ends, before the turn does', { options: { planPrice: 20 } }, async ($, on) => {
  engine(on)
  const usage = { model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }) as never)
  await $.command.run({ command: 'api-cost', args: '', origin: { kind: 'plugin', name: 'test' } } as never)
  await $.prompt.submit({ text: 'go' } as never)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void _
  await $.session.measure({ context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 95 }], changed: ['rateLimits'] } as never)
  const ui = await $.ui.mount({
    plugin: 'api-cost',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /^\$2\.00$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\$32\.03$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /95%/ })).toBeDefined()
  await ui.unmount()
})
