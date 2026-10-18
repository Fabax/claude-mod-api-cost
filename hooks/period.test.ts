import { expect, test } from 'claude-code/testing'

import { periodStart, periodStartMs } from './period'

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime()

test('calendar month by default', async () => {
  expect(periodStart(at(2026, 10, 18), 1)).toBe('2026-10-01')
  expect(periodStart(at(2026, 10, 1), 1)).toBe('2026-10-01')
})

test('billing day later in the month rolls back a month before it', async () => {
  expect(periodStart(at(2026, 10, 18), 20)).toBe('2026-09-20')
  expect(periodStart(at(2026, 10, 20), 20)).toBe('2026-10-20')
  expect(periodStart(at(2026, 1, 5), 15)).toBe('2025-12-15')
})

test('the start in ms is local midnight of that day', async () => {
  expect(periodStartMs(at(2026, 10, 18), 1)).toBe(new Date(2026, 9, 1).getTime())
})
