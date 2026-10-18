"""Propose updates to prices.json from LiteLLM's public price list.

Usage: python3 scripts/update_prices.py [prices.json] [pr-body.md]
(LITELLM_JSON=<file> reads a downloaded copy of the list instead.)

Reads the Claude models LiteLLM lists for the anthropic provider, in USD per
million tokens, and merges them into prices.json: a new model is added, a
changed price replaced; nothing is deleted, so entries LiteLLM lacks (the
Haiku 5.5 long-prompt tier) stay. A price outside $0-$1000 is ignored, and a
change of more than half is flagged in the pull request's body for review.
Prints "changed" or "unchanged".
"""
import json
import os
import re
import sys
import urllib.request
from datetime import date

SOURCE = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
FIELDS = {
    "input": "input_cost_per_token",
    "output": "output_cost_per_token",
    "cacheRead": "cache_read_input_token_cost",
    "write5m": "cache_creation_input_token_cost",
    "write1h": "cache_creation_input_token_cost_above_1hr",
}

path = sys.argv[1] if len(sys.argv) > 1 else "prices.json"
body_path = sys.argv[2] if len(sys.argv) > 2 else "pr-body.md"

with open(path, encoding="utf-8") as fh:
    current = json.load(fh)
if os.environ.get("LITELLM_JSON"):
    with open(os.environ["LITELLM_JSON"], encoding="utf-8") as fh:
        litellm = json.load(fh)
else:
    with urllib.request.urlopen(SOURCE, timeout=60) as res:
        litellm = json.load(res)

proposed = {}
for key, entry in litellm.items():
    if not isinstance(entry, dict) or entry.get("litellm_provider") != "anthropic":
        continue
    if not key.startswith("claude-") or "/" in key:
        continue
    prefix = re.sub(r"-\d{8}$", "", key[len("claude-"):])
    price = {}
    for name, field in FIELDS.items():
        per_token = entry.get(field)
        if isinstance(per_token, (int, float)) and 0 <= per_token * 1e6 < 1000:
            price[name] = round(per_token * 1e6, 4)
    if all(k in price for k in ("input", "output", "cacheRead")):
        # An undated key wins over a dated one of the same model.
        if prefix not in proposed or key == "claude-" + prefix:
            proposed[prefix] = price

models = current["models"]
added, changed, flagged = [], [], []
for prefix, price in sorted(proposed.items()):
    old = models.get(prefix)
    if old is None:
        models[prefix] = price
        added.append(prefix)
        continue
    diffs = {k: (old.get(k), v) for k, v in price.items() if old.get(k) != v}
    if not diffs:
        continue
    models[prefix] = {**old, **price}
    changed.append((prefix, diffs))
    for k, (a, b) in diffs.items():
        if a and abs(b - a) / a > 0.5:
            flagged.append(f"{prefix} {k}: {a} -> {b}")

if not added and not changed:
    print("unchanged")
    sys.exit(0)

current["updated"] = date.today().isoformat()
current["models"] = dict(sorted(models.items(), key=lambda kv: (-len(kv[0]), kv[0])))
with open(path, "w", encoding="utf-8") as fh:
    fh.write(json.dumps(current, indent=2) + "\n")

lines = ["Proposed from [LiteLLM's price list](" + SOURCE + "), in USD per million tokens.", ""]
lines.append("Check each change against Anthropic's pricing page before merging: LiteLLM is a third party.")
if flagged:
    lines += ["", "**Changes of more than half, check these first:**", *[f"- {f}" for f in flagged]]
if added:
    lines += ["", "**New models:**", *[f"- `{p}`: {json.dumps(models[p])}" for p in added]]
if changed:
    lines += ["", "**Changed prices:**"]
    for prefix, diffs in changed:
        lines.append(f"- `{prefix}`: " + ", ".join(f"{k} {a} -> {b}" for k, (a, b) in diffs.items()))
with open(body_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")
print("changed")
