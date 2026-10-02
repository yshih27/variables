import pathlib, subprocess, sys, datetime
ROOT = pathlib.Path("/Users/workstation/Documents/AI created dashboards/tcg-market")
OUT = pathlib.Path(sys.argv[1])
LOCKUP_DARK = (ROOT/"public/brand/varible-lockup-on-dark.svg").read_text().replace('width="333" height="118"', 'class="lockup"')
LOCKUP_LIGHT = (ROOT/"public/brand/varible-lockup-on-light.svg").read_text().replace('width="333" height="118"', 'class="lockup"')
MARK = (ROOT/"public/brand/varible-mark-lime.svg").read_text().replace('width="150" height="150"', 'class="mark"')
DATE = "September 2026"

CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
@page { size: A4; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; }
body { font-family: Inter, "Helvetica Neue", Arial, sans-serif; color: #17191a; font-size: 10.5pt; line-height: 1.5; }
.mono { font-family: "JetBrains Mono", Menlo, monospace; font-variant-numeric: tabular-nums; }
.page { width: 210mm; height: 297mm; padding: 16mm 18mm 14mm; position: relative; overflow: hidden; page-break-after: always; background: #f7f8f4; }
.page:last-child { page-break-after: auto; }
.page.dark { background: #0b0d0c; color: #ecefe7; }
.lockup { height: 26px; width: auto; display: block; }
.dark .lockup { height: 34px; }
.mark { width: 150px; height: 150px; }
.head { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #dce0d6; padding-bottom: 8px; margin-bottom: 26px; }
.eyebrow { font-family: "JetBrains Mono", Menlo, monospace; font-size: 8.5pt; letter-spacing: .1em; text-transform: uppercase; color: #5d6660; }
.dark .eyebrow { color: #9aa396; }
h1 { font-weight: 600; font-size: 30pt; line-height: 1.1; letter-spacing: -.02em; margin: 0 0 16px; text-wrap: balance; }
h2 { font-weight: 600; font-size: 20pt; line-height: 1.15; letter-spacing: -.015em; margin: 0 0 6px; }
h3 { font-weight: 600; font-size: 11.5pt; margin: 0 0 4px; }
p { margin: 0 0 8px; }
.lede { font-size: 12pt; color: #5d6660; max-width: 66ch; margin-bottom: 18px; }
.dark .lede { color: #b7bfb2; }
.lime { color: #bfef01; }
.limebg { background: #bfef01; color: #0b0d0c; }
.foot { position: absolute; left: 18mm; right: 18mm; bottom: 10mm; display: flex; justify-content: space-between; font-family: "JetBrains Mono", Menlo, monospace; font-size: 8pt; color: #5d6660; border-top: 1px solid #dce0d6; padding-top: 6px; }
.dark .foot { color: #9aa396; border-color: #262b27; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.stat { border: 1px solid #262b27; padding: 10px 12px; }
.stat b { display: block; font-family: "JetBrains Mono", Menlo, monospace; font-weight: 500; font-size: 17pt; color: #bfef01; letter-spacing: -.02em; }
.stat span { font-size: 8pt; letter-spacing: .06em; text-transform: uppercase; color: #9aa396; display: block; margin-top: 2px; }
.stats.light .stat { border-color: #dce0d6; background: #fff; }
.stats.light .stat b { color: #17191a; }
.stats.light .stat span { color: #5d6660; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
th { text-align: left; font-weight: 500; font-size: 8pt; letter-spacing: .06em; text-transform: uppercase; color: #5d6660; padding: 0 8px 6px 0; border-bottom: 1px solid #17191a; }
td { padding: 7px 8px 7px 0; border-bottom: 1px solid #dce0d6; vertical-align: top; }
td.k { font-weight: 600; white-space: nowrap; }
td.n { font-family: "JetBrains Mono", Menlo, monospace; color: #5d6660; width: 22px; }
.chip { display: inline-block; font-family: "JetBrains Mono", Menlo, monospace; font-size: 7.5pt; letter-spacing: .05em; text-transform: uppercase; padding: 2px 6px; white-space: nowrap; }
.ok { background: #e2f5b0; color: #3a4d00; } .none { background: #ecdcdc; color: #7a2a2a; } .part { background: #f3e5cc; color: #7a4a0e; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.card { background: #fff; border: 1px solid #dce0d6; padding: 12px 14px; }
.card .num { font-family: "JetBrains Mono", Menlo, monospace; font-size: 8pt; color: #5d6660; letter-spacing: .08em; margin-bottom: 4px; }
.card p { font-size: 9.5pt; margin: 0; color: #2f3531; }
.callout { border-left: 3px solid #bfef01; background: #fff; padding: 10px 14px; margin: 14px 0 0; font-size: 10pt; }
.callout.dark { background: #0b0d0c; color: #ecefe7; border-color: #bfef01; }
ul { margin: 0; padding-left: 16px; } li { margin-bottom: 5px; }
.steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.step { border-top: 2px solid #17191a; padding-top: 8px; }
.step b { display: block; font-family: "JetBrains Mono", Menlo, monospace; font-weight: 500; font-size: 8.5pt; letter-spacing: .06em; text-transform: uppercase; color: #5d6660; margin-bottom: 4px; }
.step p { font-size: 9.5pt; margin: 0; }
.small { font-size: 9pt; color: #5d6660; }
.pill { display: inline-block; background: #bfef01; color: #0b0d0c; font-family: "JetBrains Mono", Menlo, monospace; font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; padding: 3px 8px; margin-bottom: 14px; }
.keybox { background: #0b0d0c; color: #ecefe7; padding: 14px 16px; margin-top: 14px; display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px; }
.keybox h3 { color: #bfef01; }
.keybox p, .keybox li { font-size: 9.5pt; color: #cfd5c9; }
.keybox ul { padding-left: 14px; }
</style>
"""

def cover(venue_line, headline):
    return f"""
<section class="page dark">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">{LOCKUP_DARK}<div class="eyebrow">Venue data partnership · {DATE}</div></div>
  <div style="position:absolute;right:18mm;top:70mm;opacity:.9">{MARK}</div>
  <div style="position:absolute;left:18mm;right:18mm;top:118mm">
    <div class="eyebrow" style="margin-bottom:14px">A proposal for venue partners</div>
    <h1 style="font-size:36pt;max-width:24ch">{headline}</h1>
    <p class="lede" style="max-width:56ch">A read-only data partnership: five feeds and one key, in return for full coverage on the terminal the tokenized collectibles market reads.</p>
  </div>
  <div style="position:absolute;left:18mm;right:18mm;bottom:28mm">
    <div class="stats">
      <div class="stat"><b>5</b><span>venues counted today</span></div>
      <div class="stat"><b>$62.7M</b><span>market cap tracked</span></div>
      <div class="stat"><b>45.7K</b><span>holders across venues</span></div>
      <div class="stat"><b>128K</b><span>items resolved to identity</span></div>
      <div class="stat"><b>Weekly</b><span>report and thread, every Monday</span></div>
    </div>
  </div>
  <div class="foot"><span>{venue_line}</span><span>varible.rarible.com · Varible, by Rarible</span></div>
</section>"""

def head(eyebrow):
    return f'<div class="head">{LOCKUP_LIGHT}<div class="eyebrow">{eyebrow}</div></div>'

def foot(n, total):
    return f'<div class="foot"><span>Venue data partnership · {DATE}</span><span>{n} / {total}</span></div>'

def page_one_page(n, total, g):
    return f"""
<section class="page">
  {head("Varible in one page")}
  <h2>The terminal for tokenized collectibles</h2>
  <p class="lede">Prices, volume, holders, pack and claw economics and a resale index across every venue that tokenizes physical collectibles: graded cards, sealed product, memorabilia and more. Built from on-chain data and venue feeds.</p>
  <div class="cols">
    <div>
      <h3>The standard</h3>
      <p>Every figure carries its window and its source. Anything we cannot defend is withheld and says so. The index publishes with its skew disclosed. Deltas are only printed against days every source has finished reporting. This is why the numbers get quoted rather than argued with.</p>
      <h3 style="margin-top:12px">Who reads it</h3>
      <p>Collectors deciding where to buy, allocators sizing the category, venue teams benchmarking against each other, and writers covering the market. A weekly report and a public thread go out every Monday, naming venues and their moves.</p>
      <h3 style="margin-top:12px">What we already count</h3>
      <p>Collector Crypt, Courtyard, Phygitals, Beezie and DYLI, on Solana, Base and Polygon. Marketplace resales, primary and pack spend, holders, listings and floors, item metadata down to the cert number, and the payout side of packs and claws where a venue has shared it.</p>
    </div>
    <div>
      <h3>Where a venue appears</h3>
      <table>
        <tr><th>Surface</th><th>What it shows for you</th></tr>
        <tr><td class="k">Platforms board</td><td>Rank, 24h and 7d resale, {g["noun"]} volume, share, sparkline</td></tr>
        <tr><td class="k">Your venue page</td><td>KPI strip, scoped Index Studio, 14-day cards, top sales with art, items and IPs tables</td></tr>
        <tr><td class="k">Economics</td><td>Spend, payouts, net and player concentration, with a coverage matrix that says what is counted</td></tr>
        <tr><td class="k">Stats and exports</td><td>Volume by venue; every chart exports PNG and CSV with a cite line, and embeds</td></tr>
        <tr><td class="k">Item pages</td><td>Realized sales, listings and buy links back to your marketplace</td></tr>
        <tr><td class="k">Weekly report</td><td>Named movers, biggest sales, the venue table, every Monday, on site and on X</td></tr>
        <tr><td class="k">Index Studio</td><td>Your resales inside the monthly resale comparables index and its benchmarks</td></tr>
      </table>
    </div>
  </div>
  <div class="stats light" style="margin-top:22px">
    <div class="stat"><b>20.9K</b><span>resales in the index panel</span></div>
    <div class="stat"><b>6h</b><span>refresh on the board</span></div>
    <div class="stat"><b>Daily</b><span>spine, gated on completeness</span></div>
    <div class="stat"><b>Monthly</b><span>resale index with bands</span></div>
    <div class="stat"><b>11</b><span>invariants a build must pass</span></div>
  </div>
  {foot(n, total)}
</section>"""

def page_opportunity(n, total, venue, g):
    return f"""
<section class="page">
  {head("The opportunity")}
  <h2>What a fully counted venue gets</h2>
  <p class="lede">Coverage on Varible is earned by data, not by size. A venue that shares its feeds is measured by the same rules as every other venue, and shows up everywhere the market looks.</p>
  <div class="cards">
    <div class="card"><div class="num">01 · A PAGE OF YOUR OWN</div><h3>Your venue, fully instrumented</h3><p>KPI strip, a scoped Index Studio with BTC and ETH overlays, 14-day cards, top sales with item art, the items and IPs behind your volume. Refreshed every six hours.</p></div>
    <div class="card"><div class="num">02 · CITABLE NUMBERS</div><h3>Third-party measured</h3><p>When Varible says a venue's resale volume grew 114% in a week, it is citable, because the number carries its window and source and was computed the same way for everyone. Your own numbers become something others can quote.</p></div>
    <div class="card"><div class="num">03 · DISTRIBUTION</div><h3>Named every Monday</h3><p>The weekly report and the public thread name venues and their moves. Item pages carry buy links back to your listings, so a reader who finds an item on Varible finishes on your marketplace.</p></div>
    <div class="card"><div class="num">04 · EMBEDS AND EXPORTS</div><h3>Charts you can reuse</h3><p>Every chart exports as PNG and CSV with a cite line, and every chart embeds. Put your own venue chart, computed by a neutral party, on your site or in your investor update.</p></div>
    <div class="card"><div class="num">05 · ECONOMICS</div><h3>Your {g["cap"]} story, told honestly</h3><p>Spend against payouts, realized odds against stated odds, player tiers and concentration. The page that answers the question every serious buyer asks before they play.</p></div>
    <div class="card"><div class="num">06 · THE INDEX</div><h3>Shape the benchmark</h3><p>Your resales move the resale comparables index. The more of your feed resolves to an item identity, the more your market shapes the number the category is measured by.</p></div>
  </div>
  <div class="callout dark">
    <b style="color:#bfef01">What readers see when a venue is not counted.</b> A dash where a number should be, "no source" on the coverage matrix, and an exclusion note in player analytics. We label every gap as a data gap, never as a venue fault. Readers still see the blank.
  </div>
  {foot(n, total)}
</section>"""

def page_api(n, total, g):
    return f"""
<section class="page">
  {head("The partner data API")}
  <div class="pill">Five feeds · one key</div>
  <h2>What we need, and what each feed powers</h2>
  <p class="lede">Read-only access to your marketplace and {g["noun"]} data. We adapt to what exists: REST and JSON, a webhook, or contract addresses and events we index ourselves. A history export plus a cursor for new rows is enough to start.</p>
  <table>
    <tr><th></th><th>Feed</th><th>Fields</th><th>What it powers on Varible</th></tr>
    <tr><td class="n">01</td><td class="k">Trades</td><td>Token id, price and currency, buyer, seller, timestamp, transaction hash, fee. Full history from launch, then a cursor or webhook for new sales. On-chain venues: contract addresses, payment token and event signatures.</td><td>Volume, trades, top sales, item pages, market cap, the resale index</td></tr>
    <tr><td class="n">02</td><td class="k">Listings</td><td>Token id, ask price, timestamp, or the marketplace's listing events.</td><td>Floors, market cap, buy links</td></tr>
    <tr><td class="n">03</td><td class="k">Pulls</td><td>Pull id, {g["unit"]} id, price paid, prize token id, prize value where stated, buyer, timestamp. Stated odds per {g["unit"]}, with a history of changes.</td><td>Realized odds against stated odds, player analytics, notable pulls on the tape and in the report</td></tr>
    <tr><td class="n">04</td><td class="k">Payout wallets</td><td>The addresses your {g["cap"]} pays prizes and buybacks from, and a note when they change.</td><td>The economics page: spend against payouts, net, concentration. The one input that moves a venue from "no source" to counted</td></tr>
    <tr><td class="n">05</td><td class="k">Item metadata</td><td>Per token: name, set or edition, number, grade, grader, cert number, year, language, image.</td><td>Identity resolution, the index, grade and set pages, cert lookups</td></tr>
  </table>
  <div class="keybox">
    <div>
      <h3>One key</h3>
      <p>A partner API key with documented rate limits, a status page or webhook for outages, the terms under which we display your data with attribution, and a named technical contact on each side.</p>
    </div>
    <div>
      <h3>Formats we take</h3>
      <ul>
        <li>REST JSON with pagination or a cursor</li>
        <li>Webhooks for new trades and pulls</li>
        <li>On-chain: addresses plus ABI, we run the indexer</li>
        <li>CSV history to backfill, any of the above from then on</li>
      </ul>
    </div>
  </div>
  <p class="small" style="margin-top:12px">Public tiers of ten requests a day cannot run a venue. Our usage is predictable: one history backfill, then incremental reads on a six-hour cycle, plus a daily metadata pass.</p>
  {foot(n, total)}
</section>"""

def page_trust(n, total, g):
    return f"""
<section class="page">
  {head("How we handle it")}
  <h2>Rules we hold ourselves to</h2>
  <p class="lede">The data is yours. These are the commitments that make sharing it safe, and they apply to every venue equally.</p>
  <div class="cols">
    <div>
      <h3>Payout wallets under rule R3</h3>
      <p>Payouts are credited only to wallets that spent into {g["the"]}. Partner, vendor and treasury flows from the same wallet never appear, and outbound is shown as an aggregate, never as a wallet list.</p>
      <h3 style="margin-top:12px">Read-only, always</h3>
      <p>We never write, never trade and never hold a key with write scope. Feeds are pulled on a fixed cycle and stored in our own database.</p>
      <h3 style="margin-top:12px">Attribution on every surface</h3>
      <p>Your name and a link wherever your data appears, including exports and embeds. Your attribution format, your logo rules.</p>
    </div>
    <div>
      <h3>Withheld beats wrong</h3>
      <p>A cell with no source says so. Nothing is estimated in your name. If a build fails a completeness or sanity gate, the figure is held and the reason is printed.</p>
      <h3 style="margin-top:12px">Tell us what not to show</h3>
      <p>If there is data you would rather keep off the page, say so. We will show it as withheld rather than guess, and we would rather know than infer.</p>
      <h3 style="margin-top:12px">A named channel</h3>
      <p>One technical contact on each side, a shared expectation on uptime, and a heads-up before schema changes in either direction.</p>
    </div>
  </div>
  <h2 style="margin-top:26px">From key to live</h2>
  <div class="steps">
    <div class="step"><b>Day 1</b><p>Key received. We pull a sample, check fields and identity resolution, and send back what we found.</p></div>
    <div class="step"><b>Week 1</b><p>History backfilled into the spine. Completeness and sanity gates run. Board and venue page go up.</p></div>
    <div class="step"><b>Week 2</b><p>Economics and player analytics live where the feeds allow. Your first named appearance in the Monday report.</p></div>
    <div class="step"><b>Ongoing</b><p>Six-hour refresh, daily spine, weekly report. Schema changes agreed in advance, both ways.</p></div>
  </div>
  <div class="callout" style="margin-top:22px">
    <b>Next step.</b> Reply with a technical contact and the feeds you can share first. Trades and metadata alone put a venue on the board. The other three complete the story.
  </div>
  <p class="small" style="margin-top:14px">Yong Shih · Varible, by Rarible · varible.rarible.com</p>
  {foot(n, total)}
</section>"""

def page_standing(n, total, venue, intro, rows, note):
    trs = "".join(f'<tr><td class="k">{leg}</td><td><span class="chip {cls}">{state}</span></td><td>{today}</td><td>{fills}</td></tr>' for leg, cls, state, today, fills in rows)
    return f"""
<section class="page">
  {head(f"Where {venue} stands today")}
  <h2>Coverage today, cell by cell</h2>
  <p class="lede">{intro}</p>
  <table>
    <tr><th>Leg</th><th>State</th><th>Source today</th><th>What fills it</th></tr>
    {trs}
  </table>
  <div class="callout">{note}</div>
  {foot(n, total)}
</section>"""

BEEZIE_ROWS = [
  ("Resales and listings", "ok", "counted", "Activity feed, pulled whole, unauthenticated", "Partner key with pagination and a cursor"),
  ("Holders", "ok", "counted", "Base collection on-chain", "Flow EVM contract or feed for completeness"),
  ("Claw spend", "ok", "counted", "USDC inflow to the Claw contract", "Already sound"),
  ("Stated odds", "ok", "counted", "/claw per claw", "History of changes"),
  ("Realized odds", "none", "no source", "No per-pull feed", "Pulls feed"),
  ("Player analytics", "none", "no source", "No buyers per pull", "Pulls feed with buyer wallets"),
  ("Economics outbound", "none", "no source", "No payout wallet known", "Claw payout wallet addresses"),
  ("Card metadata", "ok", "counted", "Token URI traits, including cert numbers", "Already sound"),
]
RENAISS_ROWS = [
  ("Resales", "none", "not yet", "No feed, no contract addresses", "Trades feed, or the marketplace contract and events on BNB Chain"),
  ("Listings and floors", "none", "not yet", "None", "Listings feed or listing events"),
  ("Holders", "none", "not yet", "None", "Card NFT contract addresses"),
  ("Pull spend and stated odds", "none", "not yet", "None", "Pulls feed with the odds per pack; the chain may carry the randomness"),
  ("Realized odds", "none", "not yet", "None", "Pulls feed"),
  ("Economics outbound", "none", "not yet", "None", "Gacha payout wallet addresses"),
  ("Card metadata", "none", "not yet", "None", "Per-token metadata with cert numbers"),
]

def build(name, venue, venue_line, headline, standing, g=None):
    g = g or {"noun": "gacha", "cap": "gacha", "the": "the gacha", "unit": "machine or pack"}
    total = 5 + (1 if standing else 0)
    pages = [cover(venue_line, headline), page_one_page(2, total, g), page_opportunity(3, total, venue, g), page_api(4, total, g), page_trust(5, total, g)]
    if standing: pages.append(page_standing(6, total, venue, *standing))
    html = f"<!doctype html><html><head><meta charset='utf-8'><title>Varible · Venue Data Partnership</title>{CSS}</head><body>{''.join(pages)}</body></html>"
    h = OUT/f"{name}.html"; h.write_text(html)
    pdf = OUT/f"{name}.pdf"
    subprocess.run(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=25000", f"--print-to-pdf={pdf}", h.as_uri()], check=True, capture_output=True)
    print(name, pdf.stat().st_size)

build("Varible-Venue-Data-Partnership", "your venue", "Prepared for venue partners", "Every number on Varible carries its source. Here is how your venue becomes one of them.", None)
build("Varible-Venue-Data-Partnership-Beezie", "Beezie", "Prepared for Beezie", "Every number on Varible carries its source. Here is how Beezie becomes fully counted.",
      ("Beezie is already the largest contributor to the resale index panel and is named in the weekly thread. Three feeds turn it from a venue we observe into one we can fully account for.", BEEZIE_ROWS,
       "<b>In unlock order.</b> A partner key for activity and listings, a realized-pulls feed for the Claw, and the Claw payout wallets. Stated odds history and the Flow EVM marketplace complete the picture."),
      g={"noun": "Claw", "cap": "Claw", "the": "the Claw", "unit": "claw"})
build("Varible-Venue-Data-Partnership-Renaiss", "Renaiss", "Prepared for Renaiss", "Every number on Varible carries its source. Here is how Renaiss becomes the sixth venue.",
      ("Renaiss would be the sixth venue on the board and the first on BNB Chain. Nothing is counted yet, so every cell is open and every feed lands as new coverage.", RENAISS_ROWS,
       "<b>Trades and metadata alone put Renaiss on the board.</b> Pulls, payout wallets and listings complete the economics page. The Renaiss Index is a separate conversation through the partner program, and a spread chart of tokenized against physical is the piece both sides would want cited."))

POCKETPULL_ROWS = [
  ("Resales", "none", "not yet", "No feed, no program addresses", "Marketplace sales feed, or the marketplace program and its events on Solana"),
  ("Listings and floors", "none", "not yet", "None", "Listings feed or listing events"),
  ("Holders", "none", "not yet", "None", "Collection addresses; we resolve owners on-chain"),
  ("Pack spend and stated odds", "none", "not yet", "None", "Packs feed with the price and stated odds per pack"),
  ("Realized pulls", "none", "not yet", "None", "Pulls feed, or the pack program address"),
  ("Economics outbound", "none", "not yet", "None", "Sellback and payout wallet addresses"),
  ("Card metadata", "none", "not yet", "None", "Per-token metadata with cert numbers; binder identity if you expose it"),
]
build("Varible-Venue-Data-Partnership-PocketPull", "PocketPull", "Prepared for PocketPull", "Every number on Varible carries its source. Here is how PocketPull becomes the sixth venue.",
      ("PocketPull would be the sixth venue on the board, on Solana alongside Collector Crypt and Phygitals. Nothing is counted yet, so every cell is open and every feed lands as new coverage from launch.", POCKETPULL_ROWS,
       "<b>Sales and metadata alone put PocketPull on the board.</b> Pulls, payout wallets and listings complete the economics page, and the binder identity, if exposed, is a page no other venue can have."),
      g={"noun": "pack", "cap": "Pack", "the": "the packs", "unit": "pack"})
