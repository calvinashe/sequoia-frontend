#!/bin/bash
# Sequoia frontend smoke test — boots the REAL app in headless Chrome (demo
# mode) and asserts the load-bearing behaviors that manual QA keeps catching:
#   1. Demo boots without wedging on the splash
#   2. "Your Priorities" is actually priority-sorted (35% midterm ranked #1)
#   3. Both JSON-LD blocks parse
#   4. Service worker has a sane cache version
#
# Usage: ./scripts/smoke_test.sh   (from the repo root)
set -u
PORT=8746
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DOM="$(mktemp -t sequoia-smoke).html"

command -v python3 >/dev/null || { echo "FAIL: python3 not found"; exit 1; }
[ -x "$CHROME" ] || { echo "FAIL: Chrome not found at $CHROME"; exit 1; }

python3 -m http.server "$PORT" --directory "$DIR" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
sleep 1

# ?demo=1 auto-enters demo mode once Firebase auth resolves; the virtual time
# budget lets Chrome run the app long enough for the dashboard to render.
"$CHROME" --headless --dump-dom --virtual-time-budget=20000 \
  --disable-gpu --hide-scrollbars \
  "http://localhost:$PORT/?demo=1" > "$DOM" 2>/dev/null

python3 - "$DOM" "$DIR" <<'EOF'
import json, re, sys

dom = open(sys.argv[1], encoding="utf-8", errors="replace").read()
repo = sys.argv[2]
failures = []

# 1. App actually booted into the dashboard (not stuck on splash/landing)
if 'id="assign-list"' not in dom:
    failures.append("dashboard never rendered (#assign-list missing)")

# 2. Priority sort: first rendered assignment must be the 35% midterm.
# Strip <style> AND <script> blocks first. The stylesheet contains
# ".a-name-text" selectors, and the app's inline JS contains the row
# template literal itself — so if the app fails to boot, the regex would
# match `${esc(a.title)}` out of the source and report a confusing
# "priority sort broken" instead of the truth, which is that no rows
# rendered at all. Strip both so a boot failure reports as a boot failure.
body = re.sub(r'<style.*?</style>', '', dom, flags=re.S)
body = re.sub(r'<script.*?</script>', '', body, flags=re.S)
titles = re.findall(r'class="a-name-text"[^>]*>([^<]+)<', body)
if not titles:
    failures.append("no assignment rows rendered in demo")
elif "Organic Chemistry II Midterm" not in titles[0]:
    failures.append(f"priority sort broken: top row is {titles[0]!r}, expected the 35% midterm")

# 3. JSON-LD blocks parse
blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', dom, re.S)
if len(blocks) < 2:
    failures.append(f"expected 2 JSON-LD blocks, found {len(blocks)}")
for b in blocks:
    try:
        json.loads(b)
    except Exception as e:
        failures.append(f"JSON-LD parse error: {e}")

# 4. Service worker cache version sanity
sw = open(f"{repo}/sw.js", encoding="utf-8").read()
if not re.search(r"const CACHE = 'sequoia-v\d+'", sw):
    failures.append("sw.js CACHE version string malformed")

if failures:
    print("SMOKE TEST FAIL")
    for f in failures:
        print(" ✗", f)
    sys.exit(1)
print(f"SMOKE TEST PASS — top priority: {titles[0].strip()!r}, {len(titles)} rows, schemas OK")
EOF
exit $?
