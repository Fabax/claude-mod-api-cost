import { expect, test } from 'claude-code/testing'

import { buildTable, calibrate, costOfRow, estimatedPrice, parseRemote, priceOf, priceTable } from './pricing'
import type { Row } from './pricing'

const M = 1_000_000
const row = (model: string, fast = 0, write5m = 0, write1h = M, web = 0): Row =>
  ['s', 'p', '2026-10-18', model, fast, M, M, M, write5m, write1h, web]
const near = (a: number, b: number) => expect(Math.abs(a - b) < 1e-9).toBe(true)

test('prices Opus 5.5 at list rates, 1-hour writes at 2x input', async () => {
  near(costOfRow(row('claude-opus-5-5')), 4 + 20 + 0.2 + 8)
  near(costOfRow(row('claude-opus-5-5', 0, M, 0)), 4 + 20 + 0.2 + 5)
})

test('fast mode doubles the tokens, web searches add $10 per 1,000', async () => {
  near(costOfRow(row('claude-opus-5-5', 1)), 2 * 32.2)
  near(costOfRow(row('claude-opus-5-5', 0, 0, M, 1000)), 32.2 + 10)
})

test('Haiku 5.5 long prompts take the higher tier', async () => {
  expect(priceOf('claude-haiku-5-5@long')?.input).toBe(0.5)
  expect(priceOf('claude-haiku-5-5')?.input).toBe(0.1)
})

test('longest prefix wins and suffixes are ignored', async () => {
  expect(priceOf('claude-opus-5-5[1m]')?.input).toBe(4)
  expect(priceOf('claude-opus-5')?.input).toBe(5)
  expect(priceOf('claude-sonnet-4-6')?.input).toBe(3)
})

test('overrides come first; a bad setting changes nothing', async () => {
  expect(priceOf('claude-opus-5-5', priceTable('{"claude-opus-5-5": [3, 15, 0.1]}'))?.input).toBe(3)
  expect(priceOf('claude-opus-5-5', priceTable('not json'))?.input).toBe(4)
})

test('unknown models cost nothing', async () => {
  expect(costOfRow(row('gpt-x'))).toBe(0)
})

test('prices.json entries come before the built-in table, bad ones are left out', async () => {
  const remote = parseRemote({
    updated: '2026-11-01',
    models: { 'opus-5-5': { input: 3, output: 15, cacheRead: 0.15, write1h: 6 }, 'opus-6': { input: 'x' } },
  })
  expect(remote?.updated).toBe('2026-11-01')
  expect(remote?.table.map(([k]) => k)).toEqual(['opus-5-5'])
  const table = buildTable([], remote?.table)
  expect(priceOf('claude-opus-5-5', table)?.input).toBe(3)
  // the explicit 1-hour write rate is used: 1M x $6
  near(costOfRow(['s', 'p', 'd', 'claude-opus-5-5', 0, 0, 0, 0, 0, M, 0], table), 6)
  expect(parseRemote({ models: {} })).toBeUndefined()
})

test('a session with one unknown model teaches its price from Claude Code count', async () => {
  const table = buildTable([])
  const rows: Row[] = [
    ['s', 'p', 'd', 'claude-opus-5-5', 0, 0, M, 0, 0, 0, 0], // $20 known
    ['s', 'p', 'd', 'claude-opus-6', 0, 0, M, 0, 0, 0, 0], // 5M units
  ]
  // Claude Code counted $35: opus-6 cost $15 for 5M units, so $3 per million input
  const learned = calibrate(rows, table, 35)
  expect(learned?.model).toBe('opus-6')
  const price = estimatedPrice(learned?.usd ?? 0, learned?.units ?? 1)
  near(price.input, 3)
  near(price.output, 15)
  expect(price.source).toBe('estimated')
  // an estimate does not stop the model from being learned again
  const withEstimate = buildTable([], [], [['opus-6', price]])
  expect(calibrate(rows, withEstimate, 35)?.model).toBe('opus-6')
})

test('no lesson from two unknown models, too little use, or a count without them', async () => {
  const table = buildTable([])
  const a: Row = ['s', 'p', 'd', 'claude-opus-6', 0, 0, M, 0, 0, 0, 0]
  const b: Row = ['s', 'p', 'd', 'claude-sonnet-6', 0, 0, M, 0, 0, 0, 0]
  expect(calibrate([a, b], table, 50)).toBeUndefined()
  expect(calibrate([['s', 'p', 'd', 'claude-opus-6', 0, 10, 10, 0, 0, 0, 0]], table, 1)).toBeUndefined()
  expect(calibrate([a], table, 0.0001)).toBeUndefined()
})
