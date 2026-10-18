import { expect, test } from 'claude-code/testing'

import { costOfRow, priceOf, priceTable } from './pricing'
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
