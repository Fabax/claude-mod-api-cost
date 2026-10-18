// The billing period holding `now` starts on `billingDay` (1-28) of a month
// at local midnight.
export const periodStartMs = (now: number, billingDay: number): number => {
  const day = Math.min(28, Math.max(1, Math.round(billingDay) || 1))
  const d = new Date(now)

  return new Date(d.getFullYear(), d.getMonth() - (d.getDate() < day ? 1 : 0), day).getTime()
}

// The same start, named as YYYY-MM-DD.
export const periodStart = (now: number, billingDay: number): string => {
  const start = new Date(periodStartMs(now, billingDay))
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
}
