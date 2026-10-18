// USD per million tokens at Anthropic first-party list prices, the table the
// mod ships with. Cache writes default to 2x input for 1-hour entries (what
// Claude Code writes) and 1.25x for 5-minute ones; fast mode doubles every
// token rate; a web search is $10 per 1,000.
export const PRICES_DATE = '2026-10-06'

export type Price = {
  input: number
  output: number
  cacheRead: number
  write5m?: number
  write1h?: number
  // `estimated`: worked out from Claude Code's own count (calibrate).
  source?: 'estimated'
}
export type PriceTable = [string, Price][]

const BUILT_IN: PriceTable = [
  ['fable-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['mythos-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['fable-5', { input: 10, output: 50, cacheRead: 1 }],
  ['mythos-5', { input: 10, output: 50, cacheRead: 1 }],
  ['opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
  ['opus-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['opus-4-8', { input: 5, output: 25, cacheRead: 0.5 }],
  ['opus-4-7', { input: 5, output: 25, cacheRead: 0.5 }],
  ['opus-4-6', { input: 5, output: 25, cacheRead: 0.5 }],
  ['opus-4-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['opus-4', { input: 15, output: 75, cacheRead: 1.5 }],
  ['sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['sonnet-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['sonnet-4', { input: 3, output: 15, cacheRead: 0.3 }],
  ['haiku-5-5@long', { input: 0.5, output: 2.5, cacheRead: 0.05 }],
  ['haiku-5-5', { input: 0.1, output: 0.5, cacheRead: 0.01 }],
  ['haiku-4-5', { input: 1, output: 5, cacheRead: 0.1 }],
  ['haiku-3-5', { input: 0.8, output: 4, cacheRead: 0.08 }],
]

const CACHE_WRITE_1H = 2
const CACHE_WRITE_5M = 1.25
const FAST = 2
const WEB_SEARCH = 0.01

const isRate = (n: unknown): n is number => typeof n === 'number' && n >= 0 && n < 1000

// Longest prefix first, so `opus-5` never answers for `opus-5-5`.
const sorted = (table: PriceTable): PriceTable => [...table].sort(([a], [b]) => b.length - a.length)

// The `prices` setting: model prefix to [input, output, cache read], e.g.
// {"opus-5-5": [4, 20, 0.2]}. What does not parse is left out.
export const parseOverrides = (setting: string): PriceTable => {
  let parsed: unknown
  try {
    parsed = setting.trim() ? JSON.parse(setting) : {}
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const out: PriceTable = []
  for (const [prefix, v] of Object.entries(parsed)) {
    if (!Array.isArray(v)) continue
    const [input, output, cacheRead] = v as unknown[]
    if (isRate(input) && isRate(output) && isRate(cacheRead)) {
      out.push([prefix.replace(/^claude-/, ''), { input, output, cacheRead }])
    }
  }

  return sorted(out)
}

// The published prices.json: {"updated", "models": {prefix: {input, output,
// cacheRead, write5m?, write1h?}}}. A model whose rates do not check out is
// left out; a file with none is no file.
export const parseRemote = (json: unknown): { updated?: string; table: PriceTable } | undefined => {
  if (typeof json !== 'object' || json === null) return undefined
  const { updated, models } = json as { updated?: unknown; models?: unknown }
  if (typeof models !== 'object' || models === null) return undefined
  const table: PriceTable = []
  for (const [prefix, v] of Object.entries(models)) {
    if (typeof v !== 'object' || v === null) continue
    const { input, output, cacheRead, write5m, write1h } = v as Record<string, unknown>
    if (!isRate(input) || !isRate(output) || !isRate(cacheRead)) continue
    const price: Price = { input, output, cacheRead }
    if (isRate(write5m)) price.write5m = write5m
    if (isRate(write1h)) price.write1h = write1h
    table.push([prefix.replace(/^claude-/, ''), price])
  }
  if (!table.length) return undefined

  return { ...(typeof updated === 'string' ? { updated } : {}), table: sorted(table) }
}

// Where a model's price comes from, first match wins: the setting, the
// published prices.json, the table above, then estimates.
export const buildTable = (overrides: PriceTable, remote: PriceTable = [], estimated: PriceTable = []): PriceTable => [
  ...overrides,
  ...remote,
  ...BUILT_IN,
  ...sorted(estimated),
]

export const priceTable = (setting: string): PriceTable => buildTable(parseOverrides(setting))

export const priceOf = (model: string, table: PriceTable = BUILT_IN): Price | undefined => {
  const id = model.toLowerCase().replace(/^(anthropic\.|us\.anthropic\.)?claude-/, '')

  return table.find(([prefix]) => id.startsWith(prefix))?.[1]
}

// One scan row: who, where, when, which model, and the tokens it used.
export type Row = [
  session: string,
  project: string,
  day: string,
  model: string,
  fast: number,
  input: number,
  output: number,
  cacheRead: number,
  write5m: number,
  write1h: number,
  webSearches: number,
]

export const costOfRow = (row: Row, table: PriceTable = BUILT_IN): number => {
  const [, , , model, fast, input, output, cacheRead, write5m, write1h, web] = row
  const price = priceOf(model, table)
  if (!price) return web * WEB_SEARCH
  const tokens =
    input * price.input +
    output * price.output +
    cacheRead * price.cacheRead +
    write5m * (price.write5m ?? price.input * CACHE_WRITE_5M) +
    write1h * (price.write1h ?? price.input * CACHE_WRITE_1H)

  return (tokens * (fast ? FAST : 1)) / 1_000_000 + web * WEB_SEARCH
}

// Anthropic prices keep one shape: output 5x input, cache reads about 0.1x,
// cache writes 1.25x and 2x. So a model's tokens weighed in units of its input
// price; its cost is units x input price / 1M.
export const unitsOf = (row: Row): number => {
  const [, , , , fast, input, output, cacheRead, write5m, write1h] = row

  return (input + 5 * output + 0.1 * cacheRead + CACHE_WRITE_5M * write5m + CACHE_WRITE_1H * write1h) * (fast ? FAST : 1)
}

// What one session says of the one model it used that no table prices: Claude
// Code's own count for the session, less what the table prices, is that model's
// cost. Nothing when the session used two such models, or too little of one to
// tell, or the rest comes out negative.
export const calibrate = (
  rows: readonly Row[],
  table: PriceTable,
  engineUsd: number,
): { model: string; usd: number; units: number } | undefined => {
  const isListed = (model: string) => {
    const price = priceOf(model, table)
    return price !== undefined && price.source !== 'estimated'
  }
  const unknown = new Set(rows.filter(r => !isListed(r[3])).map(r => r[3].replace(/\[.*\]$/, '')))
  const [model] = unknown
  if (unknown.size !== 1 || !model) return undefined
  let known = 0
  let units = 0
  for (const r of rows) {
    if (isListed(r[3])) known += costOfRow(r, table)
    else {
      units += unitsOf(r)
      known += r[10] * WEB_SEARCH
    }
  }
  const usd = engineUsd - known
  // An input price outside $0.05-$200 per million is a count that did not
  // price the model (an older Claude Code) or noise, not a price.
  const input = (usd / units) * 1_000_000
  if (units < 50_000 || input < 0.05 || input > 200) return undefined

  return { model: model.replace(/^claude-/, ''), usd, units }
}

// The estimated price of a model from its sessions' sums, kept in the price
// shape unitsOf assumes.
export const estimatedPrice = (usd: number, units: number): Price => {
  const input = (usd / units) * 1_000_000

  return { input, output: 5 * input, cacheRead: 0.1 * input, source: 'estimated' }
}

export const usd = (n: number): string => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)
