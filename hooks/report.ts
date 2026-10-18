import type { ModelLine, Summary } from '../types'
import { costOfRow, priceOf, usd } from './pricing'
import type { PriceTable, Row } from './pricing'

export const summarize = (rows: readonly Row[], table: PriceTable, fromDay = ''): Summary => {
  const s: Summary = { total: 0, bySession: {}, byModel: {}, byDay: {}, byProject: {} }
  for (const row of rows) {
    const [session, project, day, model, fast, input, output, cacheRead, write5m, write1h, web] = row
    if (day < fromDay) continue
    const cost = costOfRow(row, table)
    const name = `${model}${fast ? ' (fast)' : ''}${priceOf(model, table) ? '' : ' (unpriced)'}`
    const line: ModelLine = s.byModel[name] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0, usd: 0 }
    s.byModel[name] = {
      input: line.input + input,
      output: line.output + output,
      cacheRead: line.cacheRead + cacheRead,
      cacheWrite: line.cacheWrite + write5m + write1h,
      webSearches: line.webSearches + web,
      usd: line.usd + cost,
    }
    s.total += cost
    s.bySession[session] = (s.bySession[session] ?? 0) + cost
    s.byDay[day] = (s.byDay[day] ?? 0) + cost
    s.byProject[project] = (s.byProject[project] ?? 0) + cost
  }

  return s
}

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${(n / 1000).toFixed(1)}k`)

export const modelLines = (byModel: Summary['byModel']): string[] =>
  Object.entries(byModel)
    .sort(([, a], [, b]) => b.usd - a.usd)
    .map(
      ([model, t]) =>
        `  ${model}: ${usd(t.usd)}  (in ${k(t.input)}, out ${k(t.output)}, cache read ${k(t.cacheRead)}, cache write ${k(t.cacheWrite)}${t.webSearches ? `, ${t.webSearches} web searches` : ''})`,
    )

// A bar per row, scaled to the largest.
export const bars = (entries: [string, number][], width = 24): string[] => {
  const max = Math.max(0, ...entries.map(([, v]) => v))
  const pad = Math.max(0, ...entries.map(([key]) => key.length))

  return entries.map(
    ([key, v]) => `  ${key.padEnd(pad)}  ${'█'.repeat(max ? Math.round((v / max) * width) : 0).padEnd(width)}  ${usd(v)}`,
  )
}

export const planLine = (month: number, plan: number): string =>
  plan > 0 ? `${usd(month)} / ${usd(plan)} plan (${Math.round((month / plan) * 100)}%)` : usd(month)

export const limitsLine = (limits: readonly { kind: string; percentUsed: number }[]): string => {
  const label: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

  return limits.map(l => `${label[l.kind] ?? l.kind} ${Math.round(l.percentUsed)}%`).join(' · ')
}
