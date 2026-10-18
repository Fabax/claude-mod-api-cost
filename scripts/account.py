"""Print the subscription facts Claude Code's login record keeps, and nothing else.

Usage: python3 -I account.py
Prints JSON {"type": ..., "tier": ..., "since": ...}: the plan
(organizationType, e.g. claude_pro), its rate-limit tier (e.g.
default_claude_max_20x) and when the subscription started. Fields the record
lacks are null; no record prints all three null.
"""
import json
import sys
import os

base = os.environ.get("CLAUDE_CONFIG_DIR")
paths = [os.path.join(base, ".claude.json")] if base else []
paths.append(os.path.expanduser("~/.claude.json"))
account = {}
for path in paths:
    try:
        with open(path, encoding="utf-8") as fh:
            account = json.load(fh).get("oauthAccount") or {}
        break
    except (OSError, ValueError, AttributeError):
        continue

json.dump(
    {
        "type": account.get("organizationType"),
        "tier": account.get("organizationRateLimitTier") or account.get("userRateLimitTier"),
        "since": account.get("subscriptionCreatedAt"),
    },
    sys.stdout,
)
