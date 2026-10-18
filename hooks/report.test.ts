import { expect, test } from 'claude-code/testing'

import { priceTable } from './pricing'
import type { Row } from './pricing'
import { limitsLine, planLine, summarize } from './report'

const rows: Row[] = [
  ['a', 'website', '2026-09-30', 'claude-opus-5-5', 0, 0, 1_000_000, 0, 0, 0, 0],
  ['a', 'website', '2026-10-02', 'claude-opus-5-5', 0, 0, 1_000_000, 0, 0, 0, 0],
  ['b', 'notes', '2026-10-03', 'claude-sonnet-5-5', 0, 0, 1_000_000, 0, 0, 0, 0],
]

test('sums by session, day, project and model from a day on', async () => {
  const s = summarize(rows, priceTable(''), '2026-10-01')
  expect(s.total).toBe(30)
  expect(s.bySession).toEqual({ a: 20, b: 10 })
  expect(s.byProject).toEqual({ website: 20, notes: 10 })
  expect(Object.keys(s.byDay)).toEqual(['2026-10-02', '2026-10-03'])
})

test('plan share and limits read plainly', async () => {
  expect(planLine(108, 200)).toBe('$108.00 / $200.00 plan (54%)')
  expect(planLine(108, 0)).toBe('$108.00')
  expect(limitsLine([{ kind: 'five_hour', percentUsed: 23.5 }, { kind: 'seven_day', percentUsed: 40 }])).toBe('5h 24% · 7d 40%')
})
