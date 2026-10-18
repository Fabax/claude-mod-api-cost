"""Sum API usage from Claude Code transcripts, one row per session, project,
local day, model and speed.

Usage: python3 -I scan.py <since_ms> [session_id]
Prints JSON {"rows": [[session, project, day, model, fast, input, output,
cache_read, cache_write_5m, cache_write_1h, web_searches], ...]}.

Each API response is counted once (transcripts repeat a response on one line
per content block, and a forked session copies its parent's). A Haiku 5.5
call whose prompt passes 100K tokens is reported as model "...@long", its
higher price tier.
"""
import json
import os
import sys
from datetime import datetime

since_ms = int(sys.argv[1])
only = sys.argv[2] if len(sys.argv) > 2 else None
root = os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude"), "projects")
seen = set()
rows = {}

for dirpath, _, files in os.walk(root):
    for name in files:
        if not name.endswith(".jsonl"):
            continue
        path = os.path.join(dirpath, name)
        if only and only not in path:
            continue
        try:
            if os.path.getmtime(path) * 1000 < since_ms:
                continue
            fh = open(path, encoding="utf-8", errors="replace")
        except OSError:
            continue
        with fh:
            for line in fh:
                if '"assistant"' not in line or '"usage"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                m = d.get("message") or {}
                u = m.get("usage")
                model = m.get("model")
                if d.get("type") != "assistant" or not u or not model or model.startswith("<"):
                    continue
                key = (m.get("id"), d.get("requestId"))
                if key in seen:
                    continue
                seen.add(key)
                try:
                    ts = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00")).timestamp()
                except (KeyError, ValueError):
                    continue
                if ts * 1000 < since_ms:
                    continue
                inp = u.get("input_tokens") or 0
                read = u.get("cache_read_input_tokens") or 0
                write = u.get("cache_creation_input_tokens") or 0
                split = u.get("cache_creation") or {}
                w5 = split.get("ephemeral_5m_input_tokens") or 0
                w1 = split.get("ephemeral_1h_input_tokens") or 0
                if w5 + w1 != write:
                    w5, w1 = 0, write
                if "haiku-5-5" in model and inp + read + write > 100_000:
                    model += "@long"
                fast = 1 if u.get("speed") == "fast" else 0
                web = (u.get("server_tool_use") or {}).get("web_search_requests") or 0
                session = d.get("sessionId") or name[:-6]
                project = os.path.basename(d.get("cwd") or "") or os.path.relpath(path, root).split(os.sep)[0]
                day = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
                row = rows.setdefault((session, project, day, model, fast), [0, 0, 0, 0, 0, 0])
                for i, n in enumerate((inp, u.get("output_tokens") or 0, read, w5, w1, web)):
                    row[i] += n

json.dump({"rows": [list(k) + v for k, v in rows.items()]}, sys.stdout)
