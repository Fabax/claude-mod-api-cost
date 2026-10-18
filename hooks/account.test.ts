import { expect, test } from 'claude-code/testing'

import { detectPlan } from './account'

test('Pro and both Max tiers have their prices', async () => {
  expect(detectPlan({ type: 'claude_pro', tier: 'default_claude_ai', since: null })).toEqual({ name: 'Pro', price: 20 })
  expect(detectPlan({ type: 'claude_max', tier: 'default_claude_max_20x', since: null }).price).toBe(200)
  expect(detectPlan({ type: 'claude_max', tier: 'default_claude_max_5x', since: null }).price).toBe(100)
})

test('unknown plans get no price', async () => {
  expect(detectPlan({ type: 'claude_team', tier: null, since: null }).price).toBeUndefined()
  expect(detectPlan({ type: null, tier: null, since: null })).toEqual({})
})

test('the billing day is the subscription start, the 28th at most', async () => {
  expect(detectPlan({ type: 'claude_pro', tier: null, since: '2026-01-22T19:37:31Z' }).billingDay).toBe(22)
  expect(detectPlan({ type: 'claude_pro', tier: null, since: '2026-01-31T12:00:00Z' }).billingDay).toBe(28)
})
