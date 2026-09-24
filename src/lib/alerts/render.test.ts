import { test } from "node:test";
import assert from "node:assert/strict";
import { eventLine, digestSubject, pctText, multipleText, dayTime, thresholdUsd } from "./render";
import { floorSignal, volumeSignal, clearSignal, listingSignal, composeDigests, type AlertEvent, type FiredEvent } from "./signals";
import { alertDigestEmail } from "@/lib/email/templates";
import { askText, dayShort, monthLong } from "@/lib/card/identityView";
import { formatCompactUsd } from "@/lib/format";
import { NOW, identity, volume, sale, charizard, pokemon, beezie, cc } from "./fixtures.test-helpers";

const firedAt = { priceUsd: 100, venue: "collector-crypt", at: "2026-09-20T00:00:00.000Z" };
const since = { cursor: "2026-09-20T00:00:00.000Z" };
const events: Record<string, AlertEvent> = {
  floorMoved: floorSignal(identity({ floor: { priceUsd: 123.45, venue: "beezie", plausible: true } }), firedAt, NOW).event!,
  floorGone: floorSignal(identity({ floor: { priceUsd: 1, venue: "beezie", plausible: false } }), firedAt, NOW).event!,
  floorBack: floorSignal(identity(), { priceUsd: null, venue: null, at: firedAt.at }, NOW).event!,
  volBeezie: volumeSignal(volume(), undefined).event!,
  volCc: volumeSignal(volume({ entity: cc }), undefined).event!,
  volIp: volumeSignal(volume({ entity: pokemon, packsUsd: null, resaleUsd: 240_000 }), undefined).event!,
  clearId: clearSignal(charizard, [sale(420, "2026-09-23T08:16:00.000Z")], identity().reference, since, NOW).event!,
  clearIp: clearSignal(pokemon, [sale(62_700, "2026-09-21T11:25:00.000Z", { name: "Lugia-Holo · PSA 10" }), sale(1_000, "2026-09-22T13:15:00.000Z")], null, since, NOW).event!,
  clearBeezie: clearSignal(beezie, [sale(2_500, "2026-09-23T01:00:00.000Z", { venue: "beezie", name: "Snorlax · PSA 9" })], null, since, NOW).event!,
  listing: listingSignal(
    identity({ listed: [{ cardId: "bz-1", venue: "beezie", priceUsd: 1, source: "OPEN_SEA" }, { cardId: "cc-B", venue: "collector-crypt", priceUsd: 130, source: "NATIVE" }] }),
    { seen: [] },
  ).event!,
};

/** Every value a payload carries, formatted every way the renderer may print it. */
function allowed(payload: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "number") {
      for (const s of [askText(v), formatCompactUsd(v), thresholdUsd(v), pctText(v), multipleText(v), `${v.toFixed(2)}×`, String(v)]) out.add(s);
    } else if (typeof v === "string" && /^\d{4}-\d{2}/.test(v)) {
      for (const s of [dayShort(v), monthLong(v), dayTime(v)]) out.add(s);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(payload);
  return out;
}

const FIGURE = /\$[\d,]+(?:\.\d+)?[KMB]?|[▲▼] \d+\.\d%|\d+\.\d{1,2}×|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(?:, \d{2}:\d{2} UTC)?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}|\d+ sales/g;

test("every figure printed is a payload value, formatted — nothing computed in the copy", () => {
  for (const [name, e] of Object.entries(events)) {
    const ok = allowed(e.payload);
    // "n sales" is the reference's own count
    const refN = (e.payload as { reference?: { n?: number } }).reference?.n ?? (e.payload as { rule?: { reference?: { n?: number } } }).rule?.reference?.n;
    if (refN != null) ok.add(`${refN} sales`);
    const line = eventLine(e);
    for (const fig of line.match(FIGURE) ?? []) {
      const alsoDate = [...ok].some((a) => a.startsWith(fig)); // "Sep 23" inside "Sep 23, 08:16 UTC"
      assert.ok(ok.has(fig) || alsoDate, `${name}: "${fig}" is not in the payload\n  ${line}`);
    }
  }
});

test("every line carries its window and its source", () => {
  assert.match(eventLine(events.floorMoved), /listings as of .* UTC/);
  assert.match(eventLine(events.floorMoved), /reference \(Aug 2026, 4 sales\)/);
  assert.match(eventLine(events.volBeezie), /daily mean of Sep 16 to Sep 22 .*Source-complete days, Varible spine/);
  assert.match(eventLine(events.volBeezie), /on Sep 23 UTC/);
  assert.match(eventLine(events.clearId), /Secondary-sales store as of/);
  assert.match(eventLine(events.clearIp), /Sales at or above \$1,000/);
  assert.match(eventLine(events.listing), /Listings as of/);
});

test("Beezie's machine is the Claw, and a Beezie line never says gacha; an IP's volume is resale only", () => {
  const bz = [eventLine(events.volBeezie), eventLine(events.clearBeezie)];
  assert.match(bz[0], /the Claw \$200K/);
  for (const l of bz) assert.doesNotMatch(l, /gacha/i);
  assert.match(eventLine(events.volCc), /gacha \$200K/);
  assert.match(eventLine(events.volIp), /resale only; packs carry no IP/);
});

test("a placeholder ask is an unverified ask, never a listing price or a floor", () => {
  const l = eventLine(events.listing);
  assert.match(l, /an unverified ask of \$1\.00 on Beezie/);
  assert.match(l, /\$130 on Collector Crypt, 1\.30× the \$100 reference/);
  assert.doesNotMatch(l, /listed at \$1/i);
  assert.match(eventLine(events.floorGone), /no plausible ask left/);
  assert.doesNotMatch(eventLine(events.floorGone), /\$1\.00/);
  assert.match(eventLine(events.floorBack), /a floor appeared at \$100 on Collector Crypt/);
});

test("the digest email: the subject names the count and the biggest move; manage + unsubscribe ride along", () => {
  const fired = Object.values(events).map((e, i): FiredEvent => ({ ...e, subscriptionId: "s", fingerprint: `f${i}`, firedAt: NOW }));
  const [d] = composeDigests(fired, () => ({ subscriberId: "r1", channel: "email" }));
  assert.equal(digestSubject(d), `${fired.length} alerts: Pokémon sale at $62.7K`);
  const mail = alertDigestEmail(d, { hrefOf: (e) => e.entity.href, manageToken: "MANAGE", unsubscribeToken: "UNSUB" });
  assert.equal(mail.subject, digestSubject(d));
  assert.match(mail.html, /\/alerts\?token=MANAGE/);
  assert.match(mail.html, /\/api\/unsubscribe\?token=UNSUB/);
  assert.match(mail.html, /\/i\/pokemon\/base-set\/4\/charizard\/psa-10/);
  for (const e of d.events) assert.ok(mail.text.includes(eventLine(e)), `text part carries: ${eventLine(e)}`);
  assert.doesNotMatch(mail.html + mail.text, /—\s*$|NaN|undefined|null/);
});
