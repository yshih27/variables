/**
 * The alert run — every 6 hours, after warm-listings and warm-core-dune.
 *
 *   npx tsx scripts/run-alerts.ts              # DRY RUN (default): what would fire, to whom (by position)
 *   npx tsx scripts/run-alerts.ts --send       # the real run: insert events, write state, send digests
 *
 * Measurement modes — IN-MEMORY store, CAPTURED notifiers, live snapshots, never
 * a production write, never a real send:
 *   … --fixture [--send] [--state=<in.json>] [--state-out=<out.json>] [--html=<dir>]
 *       Five watches (three identities, one IP, one platform) picked from the
 *       live data, with each signal's prior state SEEDED so it has something to
 *       compare against (every seed is printed). `--send` here fires into the
 *       memory store and the capture transport; `--state-out` saves the store,
 *       and a second run with `--state=` that file proves the dedupe.
 *   … --synthetic=1000
 *       1,000 watches over real entities, a dry run, timed: the budget check.
 *
 * ⚠️ PRIVACY. Readers appear as positions ("reader 3"), never addresses; no
 * token or chat id is printed.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAlerts, type DirectoryEntry, type RunReport } from "../src/lib/alerts/run";
import { loadReadings } from "../src/lib/alerts/readings";
import { resolveEntity } from "../src/lib/alerts/entities";
import { supabaseAlertStore, type AlertSubscription } from "../src/lib/alerts/store";
import { memoryAlertStore, emptyMemoryData, type MemoryAlertData } from "../src/lib/alerts/memoryStore";
import { eventLine } from "../src/lib/alerts/render";
import { listAlertRecipients, ensureManageToken } from "../src/lib/subscribe/subscribers";
import { listIdentityIndex } from "../src/lib/data/identityDetail";
import { IP_CATALOG } from "../src/lib/data/ipCatalog";
import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { createEmailNotifier } from "../src/lib/notify/email";
import { createTelegramNotifier } from "../src/lib/notify/telegram";
import { alertDigestEmail } from "../src/lib/email/templates";
import { runWarmer } from "../src/lib/db/runWarmer";
import type { AlertEntityType, AlertKind, EntityRef, FloorState, ListingState, ClearState } from "../src/lib/alerts/signals";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? null;
const SEND = flag("send");
const FIXTURE = flag("fixture");
const SYNTHETIC = Number(opt("synthetic") ?? 0);

let slugKeys: ((slug: string) => string[] | undefined) | undefined;
const resolve = (type: AlertEntityType, key: string) => resolveEntity(type, key, type === "identity" ? slugKeys : undefined);

function print(r: RunReport, label: string): void {
  console.log(`\n── ${label} ──`);
  console.log(`  watches ${r.subscriptions} · active (confirmed readers) ${r.active} · entities: ${r.entities.identity} identities, ${r.entities.ip} IPs, ${r.entities.platform} platforms`);
  console.log(`  fired: floor ${r.fired.floor} · volume ${r.fired.volume} · clear ${r.fired.clear} · listing ${r.fired.listing} · deduped ${r.deduped}`);
  console.log(`  digests ${r.digests.length}${r.digests.length ? `: ${r.digests.map((d) => `reader ${d.subscriber} (${d.channel}, ${d.events} event${d.events === 1 ? "" : "s"})`).join(", ")}` : ""}`);
  if (SEND || FIXTURE) console.log(`  sent ${r.sent} · failed ${r.failed} · undeliverable ${r.undeliverable} · states written ${r.statesWritten}`);
  console.log(`  timings ${Object.entries(r.timings).map(([k, v]) => `${k} ${v}ms`).join(" · ")}`);
  for (const e of r.events.slice(0, 20)) console.log(`   • [${e.kind}] ${eventLine(e)}`);
  if (r.events.length > 20) console.log(`   … and ${r.events.length - 20} more`);
}

// ── the fixture: five watches on live data, seeded state ─────────────────────

const FIXTURE_READER = "fixture-reader";
const fixtureDirectory = async (ids: string[]) =>
  new Map<string, DirectoryEntry>(
    ids.map((id, i) => [id, { subscriberId: id, email: `reader${i + 1}@example.invalid`, unsubscribeToken: `unsub-${id}`, manageToken: `manage-${id}` }]),
  );
const sub = (id: string, subscriberId: string, entityType: AlertEntityType, entityKey: string, kinds: AlertKind[], now: string): AlertSubscription => ({
  id, subscriberId, entityType, entityKey, kinds, channel: "email", createdAt: now, pausedAt: null,
});

async function buildFixture(now: string): Promise<MemoryAlertData> {
  const idx = await listIdentityIndex();
  // Candidates: every identity that has a sale in the store's lookback (a clear
  // can only fire on those) plus a broad slice of the index; one read.
  const probe = await loadReadings([resolve("ip", "pokemon")!, resolve("ip", "one_piece")!].filter(Boolean) as EntityRef[], { now: Date.parse(now) });
  const saleSlugs = [...probe.sales.byIdentity.keys()];
  const pool = [...new Set([...saleSlugs, ...[...idx.bySlug.keys()].slice(0, 4000)])]
    .map((s) => resolve("identity", s))
    .filter((e): e is EntityRef => !!e);
  const r = await loadReadings(pool, { now: Date.parse(now) });
  const ids = [...r.identities.values()];
  // A: a plausible floor against a reference (the floor signal's case).
  const a = ids.find((x) => x.floor?.plausible && x.reference) ?? ids.find((x) => x.floor?.plausible);
  // B: the most live asks (the listing signal's case), not A.
  const b = [...ids].filter((x) => x !== a).sort((x, y) => y.listed.length - x.listed.length)[0];
  // C: the largest sale-to-reference multiple in the store's lookback (the clear's case).
  const c = [...ids]
    .filter((x) => x !== a && x !== b && x.reference)
    .map((x) => ({ x, m: Math.max(0, ...(r.sales.byIdentity.get(x.entity.key) ?? []).map((s) => s.priceUsd / x.reference!.priceUsd)) }))
    .sort((p, q) => q.m - p.m)[0]?.x;
  if (!a || !b || !c) throw new Error("fixture: could not find identities for every signal in the live data");
  const seedAt = new Date(Date.parse(now) - 86_400_000).toISOString();
  const cursor = new Date(Date.parse(now) - 72 * 3_600_000).toISOString();
  const data = emptyMemoryData([
    sub("w1-identity-floor", FIXTURE_READER, "identity", a.entity.key, ["floor", "clear", "listing"], now),
    sub("w2-identity-listing", FIXTURE_READER, "identity", b.entity.key, ["floor", "clear", "listing"], now),
    sub("w3-identity-clear", FIXTURE_READER, "identity", c.entity.key, ["floor", "clear", "listing"], now),
    sub("w4-ip", FIXTURE_READER, "ip", "pokemon", ["volume", "clear"], now),
    sub("w5-platform", FIXTURE_READER, "platform", "beezie", ["volume", "clear"], now),
  ]);
  const floorSeed = (x: typeof a): FloorState =>
    x.floor?.plausible ? { priceUsd: Math.round((x.floor.priceUsd / 1.15) * 100) / 100, venue: x.floor.venue, at: seedAt } : { priceUsd: null, venue: null, at: seedAt };
  const listingSeed = (x: typeof a): ListingState => ({ seen: x.listed.map((l) => l.cardId).sort().slice(2) });
  const clearSeed: ClearState = { cursor };
  data.state["w1-identity-floor"] = { floor: floorSeed(a), listing: { seen: a.listed.map((l) => l.cardId).sort() }, clear: clearSeed };
  data.state["w2-identity-listing"] = { floor: b.floor?.plausible ? { priceUsd: b.floor.priceUsd, venue: b.floor.venue, at: seedAt } : { priceUsd: null, venue: null, at: seedAt }, listing: listingSeed(b), clear: clearSeed };
  data.state["w3-identity-clear"] = { floor: c.floor?.plausible ? { priceUsd: c.floor.priceUsd, venue: c.floor.venue, at: seedAt } : { priceUsd: null, venue: null, at: seedAt }, listing: { seen: c.listed.map((l) => l.cardId).sort() }, clear: clearSeed };
  data.state["w4-ip"] = { clear: clearSeed };
  data.state["w5-platform"] = { clear: clearSeed };
  console.log(`fixture (live data, ${now}):`);
  console.log(`  w1 identity ${a.entity.label} (${a.entity.key}): floor seeded as last fired at ${(data.state["w1-identity-floor"].floor as FloorState).priceUsd} (the live floor ÷ 1.15)`);
  console.log(`  w2 identity ${b.entity.label} (${b.entity.key}): ${b.listed.length} live asks; listing seed = all but two (by card id)`);
  console.log(`  w3 identity ${c.entity.label} (${c.entity.key}): clear cursor seeded 72 h back`);
  console.log(`  w4 ip pokemon · w5 platform beezie: clear cursors seeded 72 h back; volume unseeded (it needs no memory)`);
  return data;
}

async function main(): Promise<void> {
  const now = opt("now") ?? new Date().toISOString();
  const idx = await listIdentityIndex();
  slugKeys = (s) => idx.bySlug.get(s);

  const captured: { subject: string; html: string }[] = [];
  const telegramCalls: string[] = [];
  const fakeTelegramFetch: typeof fetch = async (url) => {
    telegramCalls.push(String(url).replace(/bot[^/]+\//, "bot<token>/"));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  if (FIXTURE || SYNTHETIC) {
    let data: MemoryAlertData;
    const stateIn = opt("state");
    if (stateIn) data = JSON.parse(readFileSync(stateIn, "utf8")) as MemoryAlertData;
    else if (FIXTURE) data = await buildFixture(now);
    else {
      // --synthetic: N watches over real entities, one to three per reader.
      const slugs = [...idx.bySlug.keys()].filter((_, i) => i % 97 === 0).slice(0, Math.ceil(SYNTHETIC * 0.6));
      const targets: [AlertEntityType, string, AlertKind[]][] = [
        ...slugs.map((s) => ["identity", s, ["floor", "clear", "listing"]] as [AlertEntityType, string, AlertKind[]]),
        ...IP_CATALOG.map((i) => ["ip", i.key, ["volume", "clear"]] as [AlertEntityType, string, AlertKind[]]),
        ...PLATFORM_SOURCES.map((p) => ["platform", p.key, ["volume", "clear"]] as [AlertEntityType, string, AlertKind[]]),
      ];
      const subs: AlertSubscription[] = [];
      for (let i = 0; i < SYNTHETIC; i++) {
        const [t, k, kinds] = targets[i % targets.length];
        subs.push(sub(`syn-${i}`, `reader-${Math.floor(i / 2)}`, t, k, kinds, now));
      }
      data = emptyMemoryData(subs);
    }
    const store = memoryAlertStore(data);
    const report = await runAlerts({
      store,
      directory: fixtureDirectory,
      resolve,
      readings: (e) => loadReadings(e, { now: Date.parse(now) }),
      notifiers: {
        email: createEmailNotifier({
          send: async (m) => {
            captured.push({ subject: m.subject, html: m.html });
            return { ok: true, delivered: false };
          },
        }),
        telegram: createTelegramNotifier({ config: { token: "fixture", username: "VaribleAlertsBot", webhookSecret: "fixture" }, fetchImpl: fakeTelegramFetch }),
      },
      now,
      send: SEND,
    });
    print(report, `${SYNTHETIC ? `synthetic ×${SYNTHETIC}` : "fixture"} · ${SEND ? "send (memory store, captured transport)" : "dry run"}`);
    const html = opt("html");
    if (html) {
      mkdirSync(html, { recursive: true });
      for (const [i, d] of report.rendered.entries()) {
        const mail = alertDigestEmail(d, { hrefOf: (e) => e.entity.href, manageToken: "SAMPLE_MANAGE_TOKEN", unsubscribeToken: "SAMPLE_UNSUB_TOKEN" });
        writeFileSync(join(html, `digest-${i + 1}.html`), mail.html);
        writeFileSync(join(html, `digest-${i + 1}.txt`), `Subject: ${mail.subject}\n\n${mail.text}`);
        console.log(`  digest ${i + 1} → ${join(html, `digest-${i + 1}.html`)} · subject "${mail.subject}"`);
      }
    }
    const out = opt("state-out");
    if (out) {
      writeFileSync(out, JSON.stringify(store.data, null, 1));
      console.log(`  store saved → ${out} (${store.data.events.length} events, ${Object.keys(store.data.state).length} states)`);
    }
    if (captured.length) console.log(`  captured emails: ${captured.length} (subjects: ${captured.map((c) => `"${c.subject}"`).join(", ")})`);
    return;
  }

  // ── the real run (dry by default) ──
  const run = () =>
    runAlerts({
      store: supabaseAlertStore,
      directory: async (ids) => {
        const m = await listAlertRecipients(ids);
        return new Map([...m].map(([id, r]) => [id, { subscriberId: id, email: r.email, unsubscribeToken: r.unsubscribeToken, manageToken: r.manageToken }]));
      },
      ensureManageToken,
      resolve,
      readings: (e) => loadReadings(e),
      notifiers: { email: createEmailNotifier(), telegram: createTelegramNotifier() },
      now,
      send: SEND,
    });
  if (!SEND) {
    print(await run(), "DRY RUN — nothing inserted, written or sent");
    return;
  }
  await runWarmer("alerts", async () => {
    const r = await run();
    print(r, "SEND");
    if (r.failed) throw new Error(`${r.failed} digest(s) failed`);
    return { rowsWritten: r.events.length };
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
