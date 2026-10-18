// USD per million tokens at Anthropic first-party list prices.
// Cache writes: 1-hour entries (what Claude Code writes) at 2x input,
// 5-minute entries at 1.25x. Fast mode doubles every token rate; a web
// search is $10 per 1,000.
export const PRICES_DATE = '2026-10-06'

export type Price = { input: number; output: number; cacheRead: number }
export type PriceTable = [string, Price][]

const PRICES: PriceTable = [
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

// The built-in table under the `prices` setting's overrides, a JSON object of
// model prefix to [input, output, cache read]: {"opus-5-5": [4, 20, 0.2]}.
// A setting that does not parse leaves the built-in table as it is.
export const priceTable = (overrides: string): PriceTable => {
  let parsed: unknown
  try {
    parsed = overrides.trim() ? JSON.parse(overrides) : {}
  } catch {
    return PRICES
  }
  if (typeof parsed !== 'object' || parsed === null) return PRICES
  const extra: PriceTable = []
  for (const [prefix, v] of Object.entries(parsed)) {
    if (!Array.isArray(v)) continue
    const [input, output, cacheRead] = v as unknown[]
    if (typeof input === 'number' && typeof output === 'number' && typeof cacheRead === 'number') {
      extra.push([prefix.replace(/^claude-/, ''), { input, output, cacheRead }])
    }
  }

  return [...extra, ...PRICES]
}

export const priceOf = (model: string, table: PriceTable = PRICES): Price | undefined => {
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

export const costOfRow = (row: Row, table: PriceTable = PRICES): number => {
  const [, , , model, fast, input, output, cacheRead, write5m, write1h, web] = row
  const price = priceOf(model, table)
  if (!price) return web * WEB_SEARCH
  const tokens =
    input * price.input +
    output * price.output +
    cacheRead * price.cacheRead +
    write5m * price.input * CACHE_WRITE_5M +
    write1h * price.input * CACHE_WRITE_1H

  return (tokens * (fast ? FAST : 1)) / 1_000_000 + web * WEB_SEARCH
}

export const usd = (n: number): string => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)
