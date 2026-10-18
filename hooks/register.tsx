import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band, Ledger, Limit, ModelLine, MonthView, SessionView, View } from '../types'
import { detectPlan } from './account'
import type { Account } from './account'
import { periodStart, periodStartMs } from './period'
import { PRICES_DATE, priceTable, usd } from './pricing'
import type { PriceTable, Row } from './pricing'
import { limitsLine, modelLines, planLine, summarize } from './report'

// The settings, a 0 in either filled from the login record when it says.
type Config = {
  billingDay: number
  plan: number
  table: PriceTable
  planName?: string
  wantDay: number
  wantPlan: number
}

const EMPTY: Ledger = { session: 0, requestBase: 0, byModel: {} }
const ledger = atom({ plugin: 'api-cost', key: 'ledger' } as const, EMPTY)
const band = atom({ plugin: 'api-cost', key: 'band' } as const, { month: 0, plan: 0, limits: [] } as Band)
const views = atom({ plugin: 'api-cost', key: 'views' } as const, {} as Record<string, View>)

// The transcripts are the record: scan.py reads them (they can pass the 4 MiB
// a plugin read takes) and returns token rows, priced here.
const scan = async ($: EngineInterface, sinceMs: number, session?: string): Promise<Row[]> => {
  const argv = ['python3', '-I', `${$.plugin.root}/scripts/scan.py`, String(sinceMs), ...(session ? [session] : [])]
  const ran = await $.process.run(argv, { timeoutMs: 120_000 })
  if (ran.exitCode !== 0 || ran.isStdoutTruncated) {
    throw new Error(`scan failed (exit ${ran.exitCode}): ${ran.stderr.slice(0, 300)}`)
  }

  return (JSON.parse(ran.stdout) as { rows: Row[] }).rows
}

// Each session keeps its own total for the period under `m:<period>:<session>`
// in the store, so sessions running side by side never overwrite each other.
const monthTotal = async ($: EngineInterface, cfg: Config) => {
  const period = periodStart(await $.clock.now(), cfg.billingDay)
  let total = 0
  for (const key of await $.store.keys()) {
    if (key.startsWith(`m:${period}:`)) total += Number((await $.store.get(key)) ?? 0)
    else if (key.startsWith('m:') || (key.startsWith('imported:') && key !== `imported:${period}`))
      await $.store.delete(key)
  }

  return total
}

// Reads the plan and its renewal day from the login record (account.py reads
// those fields alone) for each setting left at 0.
const resolveAccount = async ($: EngineInterface, cfg: Config) => {
  const ran = await $.process.run(['python3', '-I', `${$.plugin.root}/scripts/account.py`], { timeoutMs: 10_000 })
  if (ran.exitCode !== 0) return
  const plan = detectPlan(JSON.parse(ran.stdout) as Account)
  cfg.planName = plan.name
  if (!cfg.wantPlan && plan.price) cfg.plan = plan.price
  if (!cfg.wantDay && plan.billingDay) cfg.billingDay = plan.billingDay
}

const refreshBand = async ($: EngineInterface, cfg: Config) => {
  const month = await monthTotal($, cfg)
  const limits = (await $.session.usage()).rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed }))
  await update($, band, () => ({ month, plan: cfg.plan, limits }))
}

// Re-reads this session's transcript: its whole cost for the ledger, and the
// part inside the billing period for the month.
const refreshSession = async ($: EngineInterface, cfg: Config) => {
  const sid = await $.session.id()
  const rows = await scan($, 0, sid)
  const now = await $.clock.now()
  const all = summarize(rows, cfg.table)
  const period = periodStart(now, cfg.billingDay)
  await update($, ledger, l => ({ ...l, session: all.total, byModel: all.byModel }))
  await $.store.set(`m:${period}:${sid}`, summarize(rows, cfg.table, period).total)
}

let running: Promise<void> | undefined

// One refresh at a time; a second asked for while one runs follows it. The
// transcript's last lines can land just after a turn ends, hence the re-read.
const refreshSoon = async ($: EngineInterface, cfg: Config, again = false) => {
  const previous = running
  const next = (async () => {
    await previous
    await refreshSession($, cfg)
    await refreshBand($, cfg)
    if (again) {
      await $.clock.sleep(2000)
      await refreshSession($, cfg)
      await refreshBand($, cfg)
    }
  })()
  running = next.catch(() => undefined)
  await next
}

// The whole period from every transcript: refreshes each session's total.
const monthView = async ($: EngineInterface, cfg: Config): Promise<MonthView> => {
  const now = await $.clock.now()
  const period = periodStart(now, cfg.billingDay)
  const rows = await scan($, periodStartMs(now, cfg.billingDay))
  const s = summarize(rows, cfg.table, period)
  for (const [sid, cost] of Object.entries(s.bySession)) await $.store.set(`m:${period}:${sid}`, cost)
  await $.store.set(`imported:${period}`, true)

  return {
    kind: 'month',
    period,
    total: s.total,
    plan: cfg.plan,
    sessions: Object.keys(s.bySession).length,
    days: Object.entries(s.byDay).sort(([a], [b]) => a.localeCompare(b)),
    projects: Object.entries(s.byProject).sort(([, a], [, b]) => b - a).slice(0, 15),
    byModel: s.byModel,
    pricesDate: PRICES_DATE,
  }
}

// The plain text the model reads and the transcript keeps; the view draws it.
const textOf = (v: View): string =>
  v.kind === 'month'
    ? [
        `Billing month since ${v.period}: ${planLine(v.total, v.plan)} across ${v.sessions} sessions`,
        'By day:',
        ...v.days.map(([day, n]) => `  ${day}  ${usd(n)}`),
        'By project:',
        ...v.projects.map(([project, n]) => `  ${project}  ${usd(n)}`),
        'By model:',
        ...modelLines(v.byModel),
        `Prices as of ${v.pricesDate}.`,
      ].join('\n')
    : [
        `API-equivalent cost (list prices as of ${v.pricesDate})`,
        `  Last request: ${usd(v.request)}`,
        `  Session: ${usd(v.session)}`,
        ...(v.engine !== undefined ? [`  Session (Claude Code's own count): ${usd(v.engine)}`] : []),
        `  Plan: ${v.planLabel} (${v.planSource})`,
        `  Billing month since ${v.period}: ${planLine(v.month, v.plan)}`,
        ...(v.limits.length ? [`  Usage limits: ${limitsLine(v.limits)}`] : []),
        ...(Object.keys(v.byModel).length ? ['By model (this session):', ...modelLines(v.byModel)] : []),
      ].join('\n')

// Keeps the view under its text (the last 20) and answers that text.
const answer = async ($: EngineInterface, view: View) => {
  const text = textOf(view)
  await update($, views, all => Object.fromEntries([...Object.entries(all), [text, view] as const].slice(-20)))

  return { text }
}

// The month scan runs by itself once per billing period.
const importOnce = async ($: EngineInterface, cfg: Config) => {
  if (await $.store.get(`imported:${periodStart(await $.clock.now(), cfg.billingDay)}`)) return
  const v = await monthView($, cfg)
  $.ui.toast(`api-cost: ${planLine(v.total, v.plan)} since ${v.period} across ${v.sessions} sessions`)
  await refreshBand($, cfg)
}

const limitColor = (pct: number) => (pct >= 80 ? 'error' : pct >= 50 ? 'warning' : 'success')
const limitLabel = (kind: string) => ({ five_hour: '5h', seven_day: '7d', spend_limit: 'spend' })[kind] ?? kind
const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${(n / 1000).toFixed(1)}k`)

export const register: Register = (on, options) => {
  const wantDay = Number(options.billingDay ?? 0)
  const wantPlan = Number(options.planPrice ?? 0)
  const cfg: Config = {
    billingDay: wantDay || 1,
    plan: wantPlan,
    table: priceTable(String(options.prices ?? '')),
    wantDay,
    wantPlan,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'api-cost',
      description: 'API-equivalent cost of this session; add month for the billing month by day, project and model',
    })
    $.ui.status(undefined)
    void resolveAccount($, cfg)
      .catch(() => undefined)
      .then(() => refreshSoon($, cfg))
      .then(() => importOnce($, cfg))

    return next(e)
  })

  // The request's cost is what the session grows by from here.
  on('prompt.submit', async ($, e, next) => {
    await update($, ledger, l => ({ ...l, requestBase: l.session }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    void refreshSoon($, cfg, true)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, ledger, () => EMPTY)
      await refreshBand($, cfg)
    }

    return next(e)
  })

  on('command.run', { command: 'api-cost' }, async ($, e) => {
    try {
      const arg = e.args.trim()
      if (arg === 'month' || arg === 'import') {
        const v = await monthView($, cfg)
        await refreshBand($, cfg)

        return answer($, v)
      }
      await refreshSoon($, cfg)
    } catch (err) {
      return { text: `api-cost: ${err instanceof Error ? err.message : String(err)}` }
    }
    const l = await read($, ledger)
    const b = await read($, band)
    const usage = await $.session.usage()
    const view: SessionView = {
      kind: 'session',
      request: l.session - l.requestBase,
      session: l.session,
      ...(usage.cost ? { engine: usage.cost.usd } : {}),
      period: periodStart(await $.clock.now(), cfg.billingDay),
      month: b.month,
      plan: cfg.plan,
      limits: b.limits,
      byModel: l.byModel,
      pricesDate: PRICES_DATE,
      planLabel: [
        cfg.planName,
        cfg.plan ? `${usd(cfg.plan)}/month` : undefined,
        `renews on day ${cfg.billingDay}`,
      ]
        .filter(Boolean)
        .join(' · '),
      planSource: cfg.wantPlan || cfg.wantDay ? 'set in /config' : 'detected from your login',
    }

    return answer($, view)
  })

  // The band above the prompt: request, session, month against the plan, limits.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const l = await read($, ledger)
    const b = await read($, band)
    const share = b.plan > 0 ? Math.round((b.month / b.plan) * 100) : 0
    const sep = <Text dimColor> │ </Text>

    return (
      <Box flexDirection="row" flexWrap="wrap">
        <Text color="claude" weight="bold">◆ API </Text>
        <Text color="cyan" weight="bold">{usd(l.session - l.requestBase)}</Text>
        <Text dimColor> req</Text>
        {sep}
        <Text color="magenta" weight="bold">{usd(l.session)}</Text>
        <Text dimColor> session</Text>
        {sep}
        <Text color="warning" weight="bold">{usd(b.month)}</Text>
        {b.plan > 0 ? <Text dimColor> / {usd(b.plan)} plan </Text> : <Text dimColor> month</Text>}
        {b.plan > 0 ? (
          <Text color={share >= 100 ? 'success' : 'text'} weight="bold">
            {share}%
          </Text>
        ) : null}
        {b.limits.length ? sep : null}
        {b.limits.map((lim: Limit, i: number) => (
          <Text>
            {i ? <Text> </Text> : null}
            <Text dimColor>{limitLabel(lim.kind)} </Text>
            <Text color={limitColor(lim.percentUsed)} weight="bold">
              {Math.round(lim.percentUsed)}%
            </Text>
          </Text>
        ))}
      </Box>
    )
  })

  // The command's output, drawn in color in its row.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.props.command !== 'api-cost' || e.props.isErrored) return next(e)
    const all = await read($, views)
    const view = all[e.props.text] ?? all[e.props.text.replace(/^api-cost: /, '')]
    if (!view) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(10, Math.min(30, (e.viewport?.columns ?? 100) - 60))

    const heading = (title: string) => (
      <Box marginTop={1}>
        <Text color="claude" weight="bold">
          {title}
        </Text>
      </Box>
    )
    const bars = (entries: [string, number][], color: string) => {
      const max = Math.max(0, ...entries.map(([, v]) => v))
      const pad = Math.min(28, Math.max(0, ...entries.map(([key]) => key.length)))
      return entries.map(([key, v]) => {
        const fill = max ? Math.round((v / max) * width) : 0
        return (
          <Text>
            <Text dimColor>{(key.length > pad ? key.slice(0, pad - 1) + '…' : key).padEnd(pad)} </Text>
            <Text color={v === max ? 'warning' : color}>{'█'.repeat(fill)}</Text>
            <Text dimColor>{'░'.repeat(width - fill)} </Text>
            <Text weight="bold">{usd(v)}</Text>
          </Text>
        )
      })
    }
    const models = (byModel: Record<string, ModelLine>) =>
      Object.entries(byModel)
        .sort(([, a], [, b]) => b.usd - a.usd)
        .map(([model, t]) => (
          <Text>
            <Text weight="bold">{model} </Text>
            <Text color="warning" weight="bold">
              {usd(t.usd)}
            </Text>
            <Text dimColor>
              {'  '}in {k(t.input)} · out {k(t.output)} · cache read {k(t.cacheRead)} · cache write {k(t.cacheWrite)}
              {t.webSearches ? ` · ${t.webSearches} web searches` : ''}
            </Text>
          </Text>
        ))
    const row = (label: string, value: string, color: string, note?: string) => (
      <Text>
        <Text dimColor>{label.padEnd(16)}</Text>
        <Text color={color} weight="bold">
          {value}
        </Text>
        {note ? <Text dimColor> {note}</Text> : null}
      </Text>
    )
    const planNote = (total: number, plan: number) =>
      plan > 0 ? `/ ${usd(plan)} plan · ${Math.round((total / plan) * 100)}% of what you pay` : undefined

    if (view.kind === 'month') {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          <Text>
            <Text color="claude" weight="bold">
              ◆ Billing month since {view.period}
            </Text>
            <Text dimColor> · {view.sessions} sessions</Text>
          </Text>
          {row('API-equivalent', usd(view.total), 'warning', planNote(view.total, view.plan))}
          {heading('By day')}
          {bars(view.days.map(([day, v]) => [day.slice(5), v]), 'cyan')}
          {heading('By project')}
          {bars(view.projects, 'magenta')}
          {heading('By model')}
          {models(view.byModel)}
          <Box marginTop={1}>
            <Text dimColor>Prices as of {view.pricesDate} · override them in /config</Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Text>
          <Text color="claude" weight="bold">
            ◆ API-equivalent cost
          </Text>
          <Text dimColor> · list prices as of {view.pricesDate}</Text>
        </Text>
        {row('Last request', usd(view.request), 'cyan')}
        {row('Session', usd(view.session), 'magenta', view.engine !== undefined ? `Claude Code counts ${usd(view.engine)}` : undefined)}
        {row('Plan', view.planLabel, 'claude', `(${view.planSource})`)}
        {row(`Month since ${view.period.slice(5)}`, usd(view.month), 'warning', planNote(view.month, view.plan))}
        {view.limits.length ? (
          <Text>
            <Text dimColor>{'Usage limits'.padEnd(16)}</Text>
            {view.limits.map((lim, i) => (
              <Text>
                {i ? <Text dimColor> · </Text> : null}
                <Text dimColor>{limitLabel(lim.kind)} </Text>
                <Text color={limitColor(lim.percentUsed)} weight="bold">
                  {Math.round(lim.percentUsed)}%
                </Text>
              </Text>
            ))}
          </Text>
        ) : null}
        {Object.keys(view.byModel).length ? heading('By model (this session)') : null}
        {models(view.byModel)}
        <Box marginTop={1}>
          <Text dimColor>/api-cost month · the billing month by day, project and model</Text>
        </Box>
      </Box>
    )
  })
}
