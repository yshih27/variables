/**
 * post-card — render a branded 16:9 stat card for X from a JSON spec.
 *
 *   npx tsx scripts/post-card.ts docs/post-cards/day01-tape.json
 *   npx tsx scripts/post-card.ts docs/post-cards/*.json        # batch
 *
 * Output: ~/Desktop/varible-posts/<name>.png (3200×1800, 2× of a 1600×900 canvas)
 * unless the spec sets `out`. Renders through headless Google Chrome — the same
 * brand primitives as the site (src/lib/brand.ts), so cards and OG images can't drift.
 *
 * Why not screenshot the site: X shows images ~600px wide on a phone, so page
 * chrome at 12px is unreadable. A card sets its own type scale and stamps the
 * source + date in the footer — every image that leaves is a receipt.
 *
 * Spec (all strings; every field optional except kind):
 *   kind      "tape"  → one hero number + up to 4 label/value rows
 *             "list"  → a title + up to 6 rows (movers, benchmarks, top IPs)
 *             "quote" → a statement, large (RECEIPTS posts)
 *   eyebrow   small mono line above the content, e.g. "THE TOKENIZED CARD MARKET · RIGHT NOW"
 *   hero      { value, label }             (tape)
 *   title     big sans headline            (list / quote)
 *   rows      [{ label, value, delta? }]   delta "+9.7%" / "−5.4%" colors itself
 *   text      the statement                (quote)
 *   asOf      footer date, default = today
 *   source    footer path, default "varible.rarible.com"
 *   name      output basename (default: spec filename)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  BRAND_LIME,
  BRAND_LOCKUP_MARK_PATH,
  BRAND_LOCKUP_VIEWBOX,
  BRAND_LOCKUP_WORDMARK_PATH,
} from "../src/lib/brand";

type Row = { label: string; value: string; delta?: string };
type Spec = {
  kind: "tape" | "list" | "quote";
  eyebrow?: string;
  hero?: { value: string; label: string };
  title?: string;
  rows?: Row[];
  text?: string;
  asOf?: string;
  source?: string;
  name?: string;
  out?: string;
};

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = 1600;
const H = 900;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function deltaColor(d: string): string {
  if (/^[+▲]/.test(d)) return "#8bd17c";
  if (/^[−\-▼]/.test(d)) return "#ff5c8a";
  return "#9aa093";
}

/** Signed values ("+9.7%", "−5.4%") color themselves; everything else stays ink. */
function signColor(v: string): string {
  if (/^\+/.test(v)) return "#8bd17c";
  if (/^[−\-]\d/.test(v)) return "#ff5c8a";
  return "#e9ece3";
}

function rowsHtml(rows: Row[], big: boolean): string {
  return rows
    .map(
      (r) => `
      <div class="row${big ? " big" : ""}">
        <span class="lbl">${esc(r.label)}</span>
        <span class="fill"></span>
        <span class="val" style="color:${signColor(r.value)}">${esc(r.value)}</span>
        ${r.delta ? `<span class="dlt" style="color:${deltaColor(r.delta)}">${esc(r.delta)}</span>` : ""}
      </div>`,
    )
    .join("");
}

function body(spec: Spec): string {
  if (spec.kind === "tape") {
    const hero = spec.hero ?? { value: "", label: "" };
    return `
      <div class="tape">
        <div class="hero">
          <div class="hero-v">${esc(hero.value)}</div>
          <div class="hero-l">${esc(hero.label)}</div>
        </div>
        <div class="rows">${rowsHtml(spec.rows ?? [], true)}</div>
      </div>`;
  }
  if (spec.kind === "list") {
    return `
      <div class="list">
        <div class="title">${esc(spec.title ?? "")}</div>
        <div class="rows">${rowsHtml(spec.rows ?? [], false)}</div>
      </div>`;
  }
  return `
    <div class="quote">
      ${spec.title ? `<div class="title">${esc(spec.title)}</div>` : ""}
      <div class="text">${esc(spec.text ?? "")}</div>
    </div>`;
}

function html(spec: Spec): string {
  const asOf =
    spec.asOf ??
    new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const source = spec.source ?? "varible.rarible.com";
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
  html,body{margin:0;width:${W}px;height:${H}px;background:#0a0a0a;color:#e9ece3;
    font-family:Inter,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
  .card{position:relative;width:${W}px;height:${H}px;padding:72px 88px;box-sizing:border-box;
    display:flex;flex-direction:column;justify-content:space-between}
  .top{display:flex;align-items:center;justify-content:space-between}
  .eyebrow{font-family:"JetBrains Mono",monospace;font-size:22px;letter-spacing:.16em;text-transform:uppercase;color:#7d8377}
  .mono{font-family:"JetBrains Mono",monospace;font-variant-numeric:tabular-nums}
  .foot{display:flex;justify-content:space-between;align-items:baseline;
    font-family:"JetBrains Mono",monospace;font-size:22px;color:#7d8377;letter-spacing:.04em;
    border-top:1px solid #23261f;padding-top:26px}
  .foot b{color:#b9bfae;font-weight:500}

  /* tape */
  .tape{display:grid;grid-template-columns:1.05fr 1fr;gap:80px;align-items:center;flex:1;padding:24px 0}
  .hero-v{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:200px;line-height:.95;
    letter-spacing:-.04em;color:${BRAND_LIME};font-variant-numeric:tabular-nums}
  .hero-l{margin-top:22px;font-family:"JetBrains Mono",monospace;font-size:24px;letter-spacing:.14em;text-transform:uppercase;color:#9aa093}
  .rows{display:flex;flex-direction:column}
  .row{display:flex;align-items:baseline;gap:22px;padding:22px 0;border-bottom:1px solid #1f2219}
  .row:last-child{border-bottom:0}
  .row.big{padding:24px 0}
  .lbl{font-size:28px;color:#9aa093;white-space:nowrap}
  .row.big .lbl{font-size:30px}
  .fill{flex:1;border-bottom:1px dotted #2a2e25;transform:translateY(-10px)}
  .val{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:44px;font-variant-numeric:tabular-nums;white-space:nowrap}
  .row.big .val{font-size:54px}
  .dlt{font-family:"JetBrains Mono",monospace;font-weight:600;font-size:30px;min-width:150px;text-align:right}

  /* list */
  .list{flex:1;display:flex;flex-direction:column;justify-content:center;padding:10px 0}
  .list .title{font-weight:700;font-size:64px;letter-spacing:-.025em;line-height:1.05;margin-bottom:40px;max-width:24ch}
  .list .row{padding:18px 0}
  .list .lbl{font-size:34px;color:#d5d9cd}
  .list .val{font-size:40px}
  .list .dlt{font-size:34px}

  /* quote */
  .quote{flex:1;display:flex;flex-direction:column;justify-content:center;padding:10px 0}
  .quote .title{font-family:"JetBrains Mono",monospace;font-size:26px;letter-spacing:.14em;text-transform:uppercase;color:${BRAND_LIME};margin-bottom:34px}
  .quote .text{font-weight:600;font-size:66px;line-height:1.18;letter-spacing:-.025em;max-width:22ch;white-space:pre-line}
</style></head><body>
<div class="card">
  <div class="top">
    <svg width="238" height="${Math.round(238 / (311.09 / 71.09))}" viewBox="${BRAND_LOCKUP_VIEWBOX}" xmlns="http://www.w3.org/2000/svg">
      <path d="${BRAND_LOCKUP_MARK_PATH}" fill="${BRAND_LIME}"/>
      <path d="${BRAND_LOCKUP_WORDMARK_PATH}" fill="#ffffff"/>
    </svg>
    <div class="eyebrow">${esc(spec.eyebrow ?? "")}</div>
  </div>
  ${body(spec)}
  <div class="foot">
    <span>source · <b>${esc(source)}</b></span>
    <span>${spec.kind === "quote" ? "as of" : "figures as of"} <b>${esc(asOf)}</b>${spec.kind === "quote" ? "" : " · settled sales only"}</span>
  </div>
</div>
</body></html>`;
}

function render(specPath: string): string {
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as Spec;
  const name = spec.name ?? basename(specPath).replace(/\.json$/, "");
  const outDir = join(homedir(), "Desktop", "varible-posts");
  mkdirSync(outDir, { recursive: true });
  const out = spec.out ? resolve(spec.out) : join(outDir, `${name}.png`);
  const tmp = join(tmpdir(), `post-card-${name}.html`);
  writeFileSync(tmp, html(spec));
  execFileSync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--window-size=${W},${H}`,
    "--virtual-time-budget=8000",
    `--screenshot=${out}`,
    `file://${tmp}`,
  ], { stdio: "ignore" });
  return out;
}

const specs = process.argv.slice(2);
if (specs.length === 0) {
  console.error("usage: npx tsx scripts/post-card.ts <spec.json> [more.json…]");
  process.exit(1);
}
for (const s of specs) console.log(render(s));
