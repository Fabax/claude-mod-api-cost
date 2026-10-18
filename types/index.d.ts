export type ModelLine = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  webSearches: number
  usd: number
}

export type Summary = {
  total: number
  bySession: Record<string, number>
  byModel: Record<string, ModelLine>
  byDay: Record<string, number>
  byProject: Record<string, number>
}

// The session's cost as its transcript last read; the request is what grew
// since the prompt was submitted.
export type Ledger = { session: number; requestBase: number; byModel: Record<string, ModelLine> }

export type Limit = { kind: string; percentUsed: number }

// What the band above the prompt shows beside the ledger.
export type Band = { month: number; plan: number; limits: Limit[] }

export type SessionView = {
  kind: 'session'
  request: number
  session: number
  engine?: number
  period: string
  month: number
  plan: number
  limits: Limit[]
  byModel: Record<string, ModelLine>
  pricesDate: string
  planLabel: string
  planSource: string
}

export type MonthView = {
  kind: 'month'
  period: string
  total: number
  plan: number
  sessions: number
  days: [string, number][]
  projects: [string, number][]
  byModel: Record<string, ModelLine>
  pricesDate: string
}

// A command's output drawn in color, found by the text it printed.
export type View = SessionView | MonthView

declare module 'claude-code' {
  interface PluginState {
    'api-cost': { ledger: Ledger; band: Band; views: Record<string, View> }
  }
}
