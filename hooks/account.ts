// What the login record says of the subscription (scripts/account.py).
export type Account = { type: string | null; tier: string | null; since: string | null }

export type Plan = { name?: string; price?: number; billingDay?: number }

// Monthly US list prices by plan; Max by its tier. Team, Enterprise and
// anything unknown get no price, and the setting stands.
export const detectPlan = (a: Account): Plan => {
  const type = a.type ?? ''
  const tier = a.tier ?? ''
  const plan: Plan =
    type === 'claude_pro'
      ? { name: 'Pro', price: 20 }
      : type === 'claude_max'
        ? tier.includes('20x')
          ? { name: 'Max 20x', price: 200 }
          : tier.includes('5x')
            ? { name: 'Max 5x', price: 100 }
            : { name: 'Max' }
        : {}
  const since = a.since ? new Date(a.since) : undefined
  if (since && !Number.isNaN(since.getTime())) plan.billingDay = Math.min(28, since.getDate())

  return plan
}
