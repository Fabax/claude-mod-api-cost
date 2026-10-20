# api-cost

A Claude Code mod that shows what your usage would cost if you paid Claude API
list prices instead of a subscription: for the current request, the session,
and your billing month, compared with what your plan costs.

![The band above the prompt, then /api-cost and /api-cost month](docs/demo.gif)

<sub>A mockup with sample data, drawn by `docs/make_gif.py` (Pillow): `python3 docs/make_gif.py docs/demo.gif`.</sub>

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install api-cost --marketplace Fabax/claude-mod-api-cost
```

Answer `y` to add the marketplace, then press Enter to install for your user.

From a shell:

```
claude plugin install api-cost --marketplace Fabax/claude-mod-api-cost
```

In the desktop app: click **+** next to the prompt box, then **Plugins**,
**Add marketplace** with `Fabax/claude-mod-api-cost`, then **Add plugin**.

This repository is private: you need read access on GitHub, and a git
credential for github.com on your machine (an SSH key, or `gh auth login`
then `gh auth setup-git`).

Needs `python3` (on macOS it comes with the Xcode command line tools).

## What it shows

- **The band above the prompt**: the last request, the session, the billing
  month against your plan, and your 5-hour and weekly usage limits. It moves
  as each model response ends, and settles on the transcript's exact figures
  when the turn does.
- **`/api-cost`**: the same in a panel, with your plan and the session by model.
- **`/api-cost month`**: the billing month by day, by project and by model.

## How it counts

Everything is read from Claude Code's own transcripts in `~/.claude/projects`,
so the month includes sessions from before you installed the mod. Each API
response is counted once and priced on its own model:

- input, output and cache reads at each model's list price;
- cache writes at 2x input for 1-hour entries (what Claude Code writes) and
  1.25x for 5-minute entries;
- fast mode at 2x, web searches at $10 per 1,000;
- Haiku 5.5 prompts over 100K tokens at its higher tier.

Your usage never leaves your machine; the only download is the price list.

## Where prices come from

First match wins:

1. **Price overrides** in `/config`.
2. **`prices.json` in this repository**, downloaded once a day (kept for
   offline use). A new model's price reaches every install within a day of
   merging it here.
3. **The table built into the mod** (prices of 2026-10-06).
4. **An estimate from Claude Code's own count.** When a session uses a model
   none of the above knows, Claude Code's own cost for the session, less what
   the mod can price, is that model's cost; Anthropic's prices keep the same
   shape (output 5x input, cache reads about 0.1x), so that gives its price per
   token. It is refined with each session and shown as `≈ estimated`.

### Keeping prices.json current

`.github/workflows/update-prices.yml` runs daily (or by hand from the Actions
tab). It reads [LiteLLM's public price list](https://github.com/BerriAI/litellm),
merges its Claude prices into `prices.json` (adding models, updating changed
prices, never deleting) and opens a pull request listing each change. LiteLLM
is a third party: check the changes against
[Anthropic's pricing](https://docs.claude.com/en/docs/about-claude/pricing)
before merging. Changes of more than half are flagged.

It needs *Settings > Actions > General > Workflow permissions > Allow GitHub
Actions to create and approve pull requests*. The download needs the
repository to be public.

## Settings

All in `/config`, under api-cost:

| Setting | Default | |
| --- | --- | --- |
| Billing day | 0 (auto) | The day your subscription renews; auto reads it from your Claude login. |
| Plan price | 0 (auto) | USD per month; auto reads the plan from your Claude login (Pro $20, Max $100 or $200). |
| Prices URL | this repository's `prices.json` | Where the daily price list comes from; empty uses the built-in table only. |
| Price overrides | empty | JSON of model prefix to `[input, output, cache read]` USD per million tokens, e.g. `{"opus-5-5": [4, 20, 0.2]}`. |

Auto-detection reads three fields of `~/.claude.json` (the plan, its usage
tier and when the subscription started), never your name or email. The renewal
day is a guess from the start date: set it yourself if you changed plans.
