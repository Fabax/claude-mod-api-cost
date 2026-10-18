"""Draw an animated mockup of the api-cost mod in a terminal, with sample data.

Usage: python3 docs/make_gif.py docs/demo.gif
"""
import sys

from PIL import Image, ImageDraw, ImageFont

COLS, ROWS = 94, 33
FONT = "/System/Library/Fonts/Menlo.ttc"
SIZE = 15
SCALE = 2  # drawn at 2x, then shrunk, for smooth text

BG = (24, 24, 27)
BAR = (39, 39, 44)
TEXT = (220, 223, 228)
DIM = (125, 130, 140)
CLAUDE = (217, 119, 87)
CYAN = (86, 182, 194)
MAGENTA = (198, 120, 221)
YELLOW = (229, 192, 123)
GREEN = (152, 195, 121)
RED = (224, 108, 117)
TRACK = (52, 54, 60)

regular = ImageFont.truetype(FONT, SIZE * SCALE, index=0)
bold = ImageFont.truetype(FONT, SIZE * SCALE, index=1)
CW = round(regular.getlength("M"))
LH = round(SIZE * SCALE * 1.45)
PAD = 18 * SCALE
TOP = 34 * SCALE
W = PAD * 2 + CW * COLS
H = TOP + PAD + LH * ROWS


def seg(text, color=TEXT, b=False):
    return (text, color, b)


def frame(lines):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, TOP - 8 * SCALE], fill=BAR)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        x = PAD + i * 20 * SCALE
        d.ellipse([x, 9 * SCALE, x + 12 * SCALE, 21 * SCALE], fill=c)
    d.text((W // 2, 15 * SCALE), "claude — api-cost", fill=DIM, font=regular, anchor="mm")
    for row, line in enumerate(lines[:ROWS]):
        x = PAD
        y = TOP + row * LH
        for text, color, b in line:
            d.text((x, y), text, fill=color, font=bold if b else regular)
            x += CW * len(text)
    return img.resize((W // SCALE, H // SCALE), Image.LANCZOS)


def boxed(body, width=COLS - 2):
    """Wraps segment lines in a rounded box in Claude's color."""
    out = [[seg("╭" + "─" * (width - 2) + "╮", CLAUDE)]]
    for line in body:
        n = sum(len(t) for t, _, _ in line)
        out.append([seg("│ ", CLAUDE), *line, seg(" " * max(0, width - 4 - n)), seg(" │", CLAUDE)])
    out.append([seg("╰" + "─" * (width - 2) + "╯", CLAUDE)])
    return out


def band(req, session, month, pct):
    return [
        seg("◆ API ", CLAUDE, True), seg(req, CYAN, True), seg(" req"), seg(" │ ", DIM),
        seg(session, MAGENTA, True), seg(" session"), seg(" │ ", DIM),
        seg(month, YELLOW, True), seg(" / $20.00 plan ", DIM), seg(f"{pct}%", GREEN, True), seg(" │ ", DIM),
        seg("5h ", DIM), seg("31%", GREEN, True), seg(" "), seg("7d ", DIM), seg("12%", GREEN, True),
    ]


def screen(transcript, typed, req="$1.84", session="$6.20", month="$48.30", pct=242, cursor=True):
    body = transcript[-(ROWS - 5):]
    pad = [[]] * (ROWS - 5 - len(body))
    prompt = [seg("─" * COLS, DIM)]
    return [
        *pad, *body, [],
        band(req, session, month, pct),
        prompt,
        [seg("> ", TEXT, True), seg(typed), seg("▌" if cursor else " ", CLAUDE)],
        prompt,
    ]


HISTORY = [
    [seg("> ", DIM), seg("split the parser into a lexer and add tests", DIM)],
    [],
    [seg("● ", TEXT), seg("Done. The parser now lives in lexer.py and parser.py, with 14 new tests.")],
    [seg("  ", TEXT), seg("All tests pass.", DIM)],
]


def row(label, value, color, note=""):
    return [seg(label.ljust(18), DIM), seg(value, color, True), seg(" " + note if note else "", DIM)]


SESSION_PANEL = boxed([
    [seg("◆ API-equivalent cost", CLAUDE, True), seg(" · list prices as of 2026-10-06", DIM)],
    row("Last request", "$1.84", CYAN),
    row("Session", "$6.20", MAGENTA, "Claude Code counts $6.31"),
    row("Plan", "Pro · $20.00/month · renews on day 22", CLAUDE, "(detected from your login)"),
    row("Month since 09-22", "$48.30", YELLOW, "/ $20.00 plan · 242% of what you pay"),
    [seg("Usage limits".ljust(18), DIM), seg("5h ", DIM), seg("31%", GREEN, True), seg(" · ", DIM), seg("7d ", DIM), seg("12%", GREEN, True)],
    [],
    [seg("By model (this session)", CLAUDE, True)],
    [seg("claude-opus-5-5 ", TEXT, True), seg("$6.20", YELLOW, True), seg("  in 0.1k · out 41.2k · cache read 6.8M · cache write 180.4k", DIM)],
    [],
    [seg("/api-cost month · the billing month by day, project and model", DIM)],
])

DAYS = [("09-22", 3.10), ("09-24", 7.95), ("09-26", 2.40), ("09-29", 9.80), ("10-01", 6.15), ("10-03", 4.90), ("10-06", 8.20), ("10-09", 5.80)]
PROJECTS = [("website", 17.40), ("data-pipeline", 12.85), ("blog", 8.10), ("scripts", 6.20), ("notes", 3.75)]


def bars(entries, color, grow):
    width = 30
    top = max(v for _, v in entries)
    pad = max(len(k) for k, _ in entries)
    out = []
    for key, v in entries:
        fill = round(v / top * width * grow)
        out.append([
            seg(key.ljust(pad) + " ", DIM),
            seg("▆" * fill, YELLOW if v == top else color),
            seg("▆" * (width - fill), TRACK), seg(" "),
            seg(f"${v * grow:.2f}", TEXT, True),
        ])
    return out


def month_panel(grow):
    return boxed([
        [seg("◆ Billing month since 2026-09-22", CLAUDE, True), seg(" · 23 sessions", DIM)],
        row("API-equivalent", f"${48.30 * grow:.2f}", YELLOW, "/ $20.00 plan · 242% of what you pay"),
        [],
        [seg("By day", CLAUDE, True)],
        *bars(DAYS, CYAN, grow),
        [],
        [seg("By project", CLAUDE, True)],
        *bars(PROJECTS, MAGENTA, grow),
        [],
        [seg("By model", CLAUDE, True)],
        [seg("claude-opus-5-5 ", TEXT, True), seg(f"${48.30 * grow:.2f}", YELLOW, True), seg("  in 3.2k · out 1.1M · cache read 98.4M · cache write 3.9M", DIM)],
    ])


frames = []


def add(lines, ms):
    frames.append((frame(lines), ms))


def typing(transcript, text, **kw):
    for i in range(len(text) + 1):
        add(screen(transcript, text[:i], **kw), 55)


# 1. The band above the prompt, then typing /api-cost.
add(screen(HISTORY, ""), 1800)
typing(HISTORY, "/api-cost")
add(screen(HISTORY, "/api-cost"), 400)

# 2. The session panel.
t2 = HISTORY + [[], [seg("> ", DIM), seg("/api-cost", DIM)], *SESSION_PANEL]
add(screen(t2, ""), 3200)

# 3. /api-cost month, bars growing.
typing(t2, "/api-cost month")
add(screen(t2, "/api-cost month"), 400)
t3 = [[seg("> ", DIM), seg("/api-cost month", DIM)]]
for step in range(1, 13):
    g = 1 - (1 - step / 12) ** 3
    add(screen(t3 + month_panel(g), ""), 60)
add(screen(t3 + month_panel(1), ""), 4500)

out = sys.argv[1]
# One palette for every frame, so no frame loses a color.
# Each color of the theme blended into the background in steps, for the
# antialiased edges of the text.
colors = [BG, BAR]
for c in (TEXT, DIM, TRACK, CLAUDE, CYAN, MAGENTA, YELLOW, GREEN, RED, (255, 95, 86), (255, 189, 46), (39, 201, 63)):
    for step in range(1, 17):
        t = step / 16
        colors.append(tuple(round(b + (v - b) * t) for b, v in zip(BG, c)))
colors = colors[:256]
palette = Image.new("P", (1, 1))
palette.putpalette([v for c in colors for v in c] + [0, 0, 0] * (256 - len(colors)))
images = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f, _ in frames]
images[0].save(out, save_all=True, append_images=images[1:], duration=[ms for _, ms in frames], loop=0, optimize=False, disposal=1)
print(out, len(images), "frames", images[0].size)
