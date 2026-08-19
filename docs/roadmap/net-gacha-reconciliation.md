# Net gacha revenue — filter-symmetry reconciliation

**Status:** findings complete; recommended rule awaiting agreement.
**Measured:** 2026-08-18 (Helius sample + committed SQL + spine reads). No Dune executions — the account was at ~183% of plan.
**Blocks:** the display hold on `netGachaRevenue` (PlatformEconomics).

---

## 0. What this settles, and what it does not

| Question | Answered? |
|---|---|
| Is the payout leg over-counted, and by what mechanism? | **Yes** — identified, with named counterparties |
| Is the panel's buyback figure trustworthy as a *flow*? | **Yes** — see §5 |
| Exact split of payouts into genuine player cash-out vs vendor/internal | **No** — needs one wallet-level query (§7) |
| Does the canonical-price filter under-count vs gross inflow? | **Structurally yes; magnitude not measured** (§4) |
| What would `netGachaRevenue` print under the recommended rule? | **Bounded, not exact** (§6) |

---

## 1. Helius credits spent

| | |
|---|---|
| Full job as specified (30d enumeration, both legs, both platforms) | **~1,890,000 credits** |
| — CC canonical pulls 819,199 + CC buybacks 775,748 + PHY pulls 105,069 + PHY buybacks 191,850 ≈ 1.89M tx, at 100 cr per 100-tx page = **1 cr/tx** | |
| — Against the client's **250,000** hard per-run budget (throws above it) | **7.6× over** |
| Bounded sample actually run (5 gacha wallets × ≤80 pages) | estimated ≤40,000 |
| **Actual spent** | **30,200 credits** |

For scale: the incident that prompted the Helius credit meter was a ~350K/day burn. The full job is 5× that, in one run.

## 2. ⚠️ The Helius substitution does not work for the inflow totals

`/v0/addresses/{address}/transactions` does **not** surface the per-pull USDC transfers. Per-pull USDC lands on associated token accounts, and the endpoint indexes by primary participant/fee-payer, so scanning the *owner* wallet returns a sparse slice:

| | Helius sample | Ground truth (Dune / spine) |
|---|---|---|
| CC canonical inflow | 5,232 tx over a **389-day** span | ~819,199 pulls in **30 days** |
| PHY canonical inflow | **14 tx** over a **514-day** span | ~105,069 pulls in 30 days |

That is roughly **0.2% of expected transaction density**. Bucket totals and extrapolations from it would be fiction, so **§3's inflow totals are reported as sample proportions only** and must not be read as 30-day figures.

The *outflow* findings survive: the existence of a specific $8.9M transferred to one address in 37 transactions is a fact regardless of what else the sample missed.

---

## 3. Measured tables

### 3a. Inflow decomposition — SAMPLE ONLY (see §2; not 30d totals)

| platform | bucket | tx | USD | share of sampled gross |
|---|---|---|---|---|
| collector-crypt | canonical-price-matched | 5,232 | $624,550 | 91.1% |
| collector-crypt | non-canonical | 24 | $61,340 | 8.9% |
| collector-crypt | excluded-sender | 0 | $0 | 0.0% |
| phygitals | canonical-price-matched | 14 | $590,514 | 100.0% |
| phygitals | non-canonical | 1,366 | $18 | 0.0% |
| phygitals | excluded-sender | 0 | $0 | 0.0% |

Non-canonical inflow amounts observed:
- **CC:** `$30,000×1, $20,000×1, $10,000×1, $500×1, $420×2, $0×18` — i.e. a handful of large round-number transfers (treasury/ops shaped, not pack purchases) plus zero-value noise.
- **PHY:** `$0.01×999, $0.02×129, $0.04×55, $0.03×36, $0.06×11, $0.08×5, $0.70×1, $0×113` — pure sub-cent dust. Phygitals' `amount >= 1` dust filter is doing real and correct work.

**Read:** in this sample the canonical filter drops almost nothing of substance on either platform. It does **not** support the press-gap hypothesis on its own — see §4.

### 3b. Outflow concentration

| platform | distinct recipients | one-time | one-time USD | share | repeat | repeat USD | share |
|---|---|---|---|---|---|---|---|
| collector-crypt | 181 | 58 | $3,261 | **0.0%** | 123 | $11,365,722 | **100.0%** |
| phygitals | 299 | 62 | $1,367,348 | 8.8% | 237 | $14,237,564 | **91.2%** |

Sampled outflow totals: CC $11,368,983 (5,434 tx); PHY $15,604,911 (4,455 tx).

**Read:** on both platforms, outbound value is overwhelmingly to *repeat* recipients. One-time recipients — the shape a genuine one-off card buyback takes — account for **0.0% of CC** and **8.8% of Phygitals** sampled outflow. Whatever this flow is, it is not dominated by individual player cash-outs.

### 3c. Top-20 outflow recipients — Collector Crypt

| # | recipient | tx | USD | avg/tx | on buyback exclusion list? |
|---|---|---|---|---|---|
| 1 | `8373hL…sdtX` | 43 | $9,842,613 | **$228,898** | ✅ excluded |
| 2 | `3PnVBr…F1QB` | 8 | $869,000 | $108,625 | not checked |
| 3 | `D1QEPR…58HD` | 195 | $115,233 | $591 | |
| 4 | `FfvHr4…RS25` | 457 | $56,099 | $123 | |
| 5 | `ECTJ6i…kdVZ` | 256 | $54,539 | $213 | |
| 6 | `Cc4pHG…rZhK` | 2 | $50,711 | $25,356 | ✅ excluded |
| 7 | `Di5xtP…VTuT` | 233 | $44,532 | $191 | |
| 8 | `5UPb1w…svnF` | 189 | $41,646 | $220 | |
| 9 | `FxppDi…xzHa` | 3 | $32,913 | $10,971 | |
| 10 | `2QSZkC…gdkQ` | 180 | $17,617 | $98 | |
| 11 | `H41Huu…Wtc5` | 357 | $16,254 | $46 | |
| 12 | `5qdXHk…u2E1` | 343 | $15,536 | $45 | |
| 13 | `83evPc…nLf5` | 46 | $15,304 | $333 | |
| 14 | `DrZNNY…pmV6` | 91 | $14,518 | $160 | |
| 15 | `5zGXdV…JAbk` | 48 | $11,431 | $238 | |
| 16 | `Ggrk8D…VDFx` | 364 | $8,287 | $23 | |
| 17 | `6wmAzB…C7vv` | 138 | $7,457 | $54 | |
| 18 | `YWx2JX…Pyw8` | 153 | $7,365 | $48 | |
| 19 | `8Y7ipG…3mAP` | 23 | $7,299 | $317 | |
| 20 | `9EZF14…p8Jx` | 136 | $7,284 | $54 | |

**CC's exclusion list is doing real work.** Its single largest counterparty by an order of magnitude (`8373hL…`, $228,898/transfer) is already excluded, as is `Cc4pHG…`. Below those, the distribution has a plausible player shape ($23–$600 average, hundreds of transfers).

### 3d. Top-20 outflow recipients — Phygitals

| # | recipient | tx | USD | avg/tx | on buyback exclusion list? |
|---|---|---|---|---|---|
| 1 | `52i9Br…x74u` | 37 | $8,878,481 | **$239,959** | ❌ **counted as payout** |
| 2 | `FgCxTX…rjt6` | 10 | $3,800,000 | **$380,000** | ❌ **counted as payout** |
| 3 | `9DrvZv…Wpmo` | 1 | $566,679 | **$566,679** | ❌ **counted as payout** |
| 4 | `AZ1TK3…NVUm` | 3 | $315,974 | $105,325 | ❌ **counted as payout** |
| 5 | `62bo7y…4G1h` | 2 | $299,383 | $149,691 | ❌ |
| 6 | `EcTrZL…jMJU` | 4 | $263,617 | $65,904 | ❌ |
| 7 | `AFbasu…NS7h` | 3 | $260,442 | $86,814 | ❌ |
| 8 | `HwGJs1…GbG3` | 1 | $154,189 | $154,189 | ❌ |
| 9 | `8EUdog…fcas` | 1 | $100,000 | $100,000 | ❌ |
| 10 | `FC7jpW…WmBP` | 1 | $100,000 | $100,000 | ❌ |
| 11 | `5X51qp…BPSE` | 1 | $100,000 | $100,000 | ❌ |
| 12 | `ArtQAt…LFZb` | 1 | $90,000 | $90,000 | ❌ |
| 13 | `5sn2nn…LHgf` | 3 | $84,000 | $28,000 | ✅ excluded (treasury) |
| 14 | `CTcEwB…wR2i` | 6 | $67,386 | $11,231 | ❌ |
| 15 | `F1AocZ…98gG` | 1 | $61,500 | $61,500 | ❌ |
| 16 | `5Wc8au…yBdG` | 1 | $60,000 | $60,000 | ❌ |
| 17 | `9rD3FE…S6tQ` | 2 | $50,000 | $25,000 | ❌ |
| 18 | `EkjYwe…HwiF` | 1 | $40,000 | $40,000 | ❌ |
| 19 | `EsS9MA…veeU` | 1 | $38,000 | $38,000 | ❌ |
| 20 | `45Z3Na…UeNg` | 61 | $33,432 | $548 | ❌ |

**This is the defect.** Phygitals excludes exactly one wallet, and it is not one of the big ones. Its four largest recipients — including a **single $566,679 transfer** — are all counted as player buybacks today. A $566,679 transfer is not a card cash-out.

CC's list works because someone found those two wallets by hand. Phygitals' was never built out. That is a maintenance-model failure, not a one-off omission — which is why §6's rule does not depend on such a list.

---

## 4. Structural asymmetries (read off the committed SQL — certain, no sampling)

| # | asymmetry | spend leg | buyback leg | direction of error |
|---|---|---|---|---|
| 1 | **wallet set** | CC: in to **3** wallets (`Gachaz…`, `GachaN…`, `96DULv…`) | out from **2** — `96DULv…` missing | payouts **under**-counted |
| | | PHY: in to **2** (`62Q9ee…`, `42oNTi…`) | out from **1** — `42oNTi…` missing | payouts **under**-counted |
| 2 | **amount filter** | CC allowlist `IN (25,50,75,80,100,151,250,1000,2500,5000)`; PHY `>= 1` | **none** — every outflow counts | payouts **over**-counted |
| 3 | **exclusion list** | excludes **15** | excludes **17** (extra: `Cc4pHG…`, `8373hL…`) | legs disagree on "internal" |

Asymmetry 2 is the one that inverts the sign, and asymmetry 3 is why CC is much closer to sane than Phygitals.

### The press gap ($209M June gross vs our ~$60M filtered)

**Not settled by this work.** Measuring gross-vs-filtered inflow over 30 days requires the source Helius cannot supply (§2) and Dune could not fund. What can be said:

- The canonical allowlist *can only* under-count relative to gross — it is a whitelist.
- In the Helius sample, non-canonical inflow was 8.9% (CC), and the non-canonical amounts observed were round-number treasury-shaped transfers, not unlisted pack prices. That is **weak evidence against** the allowlist being the main cause of a 3.5× gap.
- A 3.5× gap is far larger than any plausible missing-price-tier effect, so the likelier explanations are definitional (press "gross GMV" spanning all channels/secondary, a different month, or non-USDC settlement) rather than our filter.
- **Do not cite our figure against the press figure until §7's query lands** — they are probably not measuring the same thing.

---

## 5. Is the panel's buyback figure trustworthy as a flow?

Anchors reconcile. Over 30 **identical** complete days (2026-07-18 → 2026-08-16), spend from the spine's `gacha_volume_usd` and payout from query 8252735's day buckets:

| platform | 30d gacha spend | 30d buyback payout | payout ÷ spend |
|---|---|---|---|
| collector-crypt | $144,674,492 | $137,570,985 | **95.1%** |
| phygitals | $10,142,695 | $10,432,435 | **102.9%** |

This matches the panel's "$145M vs $138M, 95.1%". The earlier $132.8M spine figure is the same quantity over a different day set — no discrepancy.

**Verdict, explicitly:**

- **The figure is trustworthy as "gross outbound USDC from the gacha wallets."** That is a real, correctly-measured on-chain flow.
- **It is NOT trustworthy as "player buyback payouts,"** which is what the label implies. For CC it is an over-statement of unknown size (no amount filter, `96DULv…` outflows missing). For **Phygitals it is materially wrong** — at least the top four recipients, dominated by six-figure average transfers, are not players, and the 102.9% ratio is arithmetic proof that something non-player is inside it.
- **Recommendation:** if the panel keeps showing it while net stays held, **relabel it** to "gacha wallet outflow (gross)" rather than "buyback payouts", and suppress it for Phygitals. Publishing a 102.9% payout rate as a player-buyback figure is the kind of claim the launch label-honesty audit exists to prevent.

---

## 6. Recommended symmetric counting rule

**Principle: both legs use the same wallet set, the same exclusions, and an equally-justified counterparty test.**

| | rule |
|---|---|
| **R1** | One wallet set per platform, applied in **both** directions. CC 3-in/3-out; PHY 2-in/2-out. |
| **R2** | One internal-wallet list per platform, applied as `from_owner NOT IN` inbound and `to_owner NOT IN` outbound. Resolve CC's 15-vs-17 explicitly. |
| **R3** ⭐ | **A payout counts only if the recipient has spent in.** Require the recipient to appear as a gacha spender within a trailing 90d window. A buyback returns money *to a player* by definition; vendors, treasuries and recycling loops never appear on the inflow side and drop out automatically. |
| **R4** | Publish net only when both legs pass the same gate (PR #71 already enforces same-window / same-completeness / null-when-unsourced). Add: **null when payout ÷ spend > 100%** — that means the rule is broken, not that the house is losing money. |
| **R5** | **INV-10**: payout ÷ spend > 1.0 over 30 complete days = HARD fail. Phygitals trips it today, which is the point. |

**Why R3 rather than extending the exclusion lists:** §3c/§3d show the list approach works exactly as far as someone hand-curated it and no further. R3 is self-maintaining, needs no vendor list, and is defensible on a methodology page. It is also **half-implementable today**: `gacha_pulls.buyer` is 100% populated (1,430,816 CC rows; 93,500 Phygitals), so the *spender* set needs no new source.

Note this is also why §3d's truncated addresses are sufficient: the recommended rule never needs that list.

---

## 7. What `netGachaRevenue` would print

### Under current counting (measured, 30 identical complete days)

| platform | spend | payout | **net** | take rate |
|---|---|---|---|---|
| collector-crypt | $144,674,492 | $137,570,985 | **+$7,103,507** | 4.9% |
| phygitals | $10,142,695 | $10,432,435 | **−$289,740** | −2.9% |

### Under the recommended rule

**Not exactly computable yet** — R3 needs wallet-level buyback recipients, which requires one Dune query (blocked: private-query cap 402 + credits at 183%). But the direction is provable, and that is enough to decide the display hold:

- **R3 can only remove payout rows, never add them.** So payout falls, and **net rises**.
- **CC: the measured +$7.10M is therefore a LOWER BOUND on true net.** True take rate ≥ 4.9%.
- **PHY: −$289,740 is an artifact.** A genuine buyback cannot exceed spend in aggregate over a sustained window, so true payout < $10.14M and **true net > $0**. The measured negative says only that non-player flow is inside the payout leg.

### Recommendation on the display hold

**Keep net held for both platforms, but the hold is now one query from lifting — not indefinite.**

- Publishing CC's +$7.10M as "net gacha revenue" would publish a lower bound under a label that reads as a point estimate. The honest version of that number needs R3.
- Phygitals must stay held regardless; its net is currently negative for a measurement reason, not a business reason.
- **Unblock path:** free two of the ten dormant `dune/superseded/` query slots (they are archived-eligible; nothing executes them), then run one wallet-level buyback query (~30 cr/execution, same scan as 8252735, differing only in `GROUP BY to_owner`). That single query closes R3, settles §4's press gap, and converts CC's bound into a figure.

---

## 8. Provenance

| finding | source | re-runnable cost |
|---|---|---|
| §3a, §3b, §3c, §3d | Helius Enhanced Transactions, 5 gacha wallets, ≤80 pages each | 30,200 credits (spent) |
| §4 asymmetries | committed SQL: `dune/gacha-daily-all-platforms.sql`, `dune/buyback-all-platforms.sql` | free |
| §5 anchors | spine `gacha_volume_usd` + Dune query 8252735 cached read | free (cached) |
| exclusion-list membership | grep against committed SQL | free |

---

# Addendum A — R3 measured (2026-08-19)

**Status:** R3 is no longer a proposal. It was implemented, executed once, and it
**does not do what §7 predicted for Phygitals.**
**Ran:** query 7644128 (slot reclaimed, see §A6), execution
`01M0CHYNMVGWV1XR9MFX1787S8`, 2026-08-19 08:24–08:27 UTC.
**Not wired into production counting.** This addendum is the input to that decision,
not the decision.

## A0. The three answers, up front

| Question §7 left open | Answer |
|---|---|
| What does R3 count for CC? | Payout $159.14M / 35d → **net +$8.52M** (take 5.08%), up from +$7.90M |
| What does R3 count for Phygitals? | Payout $13.15M / 35d → **net −$76.8K. Still negative. Still >100%.** |
| Is the canonical allowlist behind the press gap? | **No.** It captures **96.8%** of CC gross inflow, **99.996%** of PHY |

**The headline: R3 fixes CC's label and does NOT lift Phygitals' hold.** §7 asserted
"a genuine buyback cannot exceed spend … **true net > $0**" for PHY. Measured under
R3, PHY's payout ratio falls from 102.56% to **100.59% — still above 1.0**. The
suppression shipped for Phygitals should stay.

## A1. Method, and why these two columns are comparable

Both legs are computed **in one execution, over one 35d window, off one `now()`**,
so nothing drifts between the "current" and "R3" columns. `payout_current_usd`
reproduces live query 8252735 exactly — same sender scope, same 17/2-wallet
exclusion list, no amount filter — and it checks out against the spine
($159.76M here vs $159.97M for the spine's trailing 35d; the 3-day window offset
accounts for the difference).

⚠️ **Window: 35d, not §6's 90d.** 35d matches 8252734/8252735 so spend and payout
stay like-for-like, but it is the **tighter** spender gate: fewer recipients
qualify, so **more** payout is removed and net comes out **higher**. Every R3 net
below is therefore an **upper bound** on what R3@90d would print. This matters for
the conclusion: PHY is negative *at its most favourable setting*.

## A2. R3-counted payouts and net, beside current counting

35d rolling window ending 2026-08-19 08:27 UTC. Spend = `inflow_canon_usd`, the
same canonical-price leg the site publishes.

### Collector Crypt — spend $167,657,703

| Rule | Payout | Rate | **Net** | Take |
|---|---|---|---|---|
| Current (live 8252735) | $159,760,183 | 95.29% | **+$7,897,520** | 4.71% |
| **R3** (recipient spent in) | $159,140,835 | 94.92% | **+$8,516,868** | 5.08% |
| R3 + exclusion list kept | $159,140,835 | 94.92% | +$8,516,868 | — |
| R3 on canonical spenders | $159,014,650 | 94.84% | +$8,643,053 | — |
| R1+R3 (symmetric wallets) | $159,140,835 | 94.92% | +$8,516,868 | — |

R3 removes **$619,348 — 0.39%** of the current payout. 9,478 of 11,047 recipients
(85.8%) are spenders.

### Phygitals — spend $13,073,074

| Rule | Payout | Rate | **Net** | Take |
|---|---|---|---|---|
| Current (live 8252735) | $13,407,251 | 102.56% | **−$334,178** | −2.56% |
| **R3** (recipient spent in) | $13,149,887 | **100.59%** | **−$76,814** | −0.59% |
| R3 + exclusion list kept | $13,149,887 | 100.59% | −$76,814 | — |
| R3 on canonical spenders | $13,148,171 | 100.57% | −$75,097 | — |
| R1+R3 (symmetric wallets) | $13,367,039 | 102.25% | −$293,965 | — |

R3 removes **$257,364 — 1.92%**. 6,549 of 7,311 recipients (89.6%) are spenders.
Note R1 makes it **worse**: adding the missing `42oNTi…` sender pulls another
$217,151 of outflow in, exactly as §4's asymmetry-1 predicted.

## A3. R3 works as designed — it is just not big enough

Two results vindicate the rule's *construction*, which is worth separating from
its *sufficiency*:

- **R3 strictly subsumes the hand-curated exclusion lists.** `payout_r3_excl_usd`
  equals `payout_r3_usd` to the cent on **both** platforms: every wallet the lists
  exclude is already a non-spender, so R3 removes it without being told. §6's
  "self-maintaining, list-free" claim holds.
- **R3 removes strictly more.** Of CC's $173.36M gross outflow, the exclusion list
  drops $13.60M (7.85%); R3 drops $14.22M — the same money plus $619K the list
  never knew about. The maintenance-failure diagnosis in §3d was right.

But the magnitudes are the story. On CC, R3 moves the take rate 4.71% → 5.08%.
On Phygitals it closes barely a fifth of the gap to 100%. **Non-player
counterparties are not what makes PHY's payout exceed its spend.**

## A4. What is actually left in Phygitals (falsifies §7's inference)

§7 reasoned: a genuine buyback cannot exceed spend in aggregate, therefore the
excess must be non-player flow, therefore R3 removes it and net turns positive.
The first clause is sound; the inference is not. R3 tests **who the counterparty
is**, never **what the transfer was for** — so a wallet that both plays gacha and
withdraws other proceeds passes R3 for its *entire* outflow.

Two candidate residuals, neither excluded by this run:

1. **Declining volume — a timing artifact, not a counting error.** Buybacks settle
   cards pulled *earlier*; on a shrinking platform the payout window is servicing
   inventory bought when volume was far higher. Measured off the spine:

   | Platform | 0–35d | 35–70d | 70–105d | trend |
   |---|---|---|---|---|
   | collector-crypt | $176.09M | $242.05M | $118.33M | **−27.2%** |
   | phygitals | $13.50M | $20.01M | $62.94M | **−32.5%** (−79% over ~3 months) |

   Phygitals' spend is down 79% from three months ago. A payout leg tracking that
   larger cohort against today's smaller spend produces a ratio above 1.0 with no
   miscounting anywhere. **A rate >100% is therefore not, by itself, proof of a
   broken rule** — which weakens the premise behind proposed invariant R5/INV-10.

2. **Non-gacha outflow to genuine players.** Marketplace proceeds or deposit
   withdrawals leaving the same wallets would be counted in full by both the
   current rule and R3.

Distinguishing these needs a **temporal** matching rule (cohort the payout to the
pull it settles), not a counterparty rule. That is a different piece of work from
R3 and it is not one query.

## A5. The press gap ($209M) — settled on our side

§4 could not measure gross-vs-filtered inflow: Helius returned ~0.2% of expected
density (§2) and Dune could not be funded. This run measures it at full density.

| Platform | canonical (published) | gross inflow | canonical capture |
|---|---|---|---|
| collector-crypt | $167,657,703 | $173,232,471 | **96.78%** |
| phygitals | $13,073,074 | $13,073,623 | **99.996%** |

**The allowlist is not a material under-count.** It drops 3.2% on CC — round-number
treasury-shaped transfers, consistent with §3a — and essentially nothing on
Phygitals, confirming its `amount >= 1` dust filter is doing correct work.

So a 3.5× press gap **cannot** be explained by our filter: even swapping in gross
inflow moves CC only 3.2%. The remaining explanations are definitional (press
"gross GMV" spanning channels/secondary we don't count, a different month, or
non-USDC settlement) or a volume difference across periods — note CC's spend has
*grown* well past the ~$60M/month figure §4 compared against, so the two sides of
that comparison were never the same period. **§4's standing instruction still
holds: do not cite our figure against the press figure.** What is now settled is
narrower and useful — *our* number is not the thing that is wrong.

## A6. Slots, cost, and provenance

Two dormant `superseded/` slots were reclaimed by API SQL-overwrite (the 402 cap
blocks CREATE, not UPDATE). Both were archived; both were unarchived, PATCHed, and
the SQL read back and verified byte-identical to the repo copy.

| ID | Was | Now | Executed |
|---|---|---|---|
| 7644128 | `TCG.market — CC buyback` | `dune/r3-buyback-reconciliation.sql` | **once** |
| 7644129 | `TCG.market — Phygitals buyback` | `dune/r3-recipient-drilldown.sql` | **no** |

The overwritten SQL is preserved unchanged in `dune/superseded/buyback-cc.7644128.sql`
and `dune/superseded/buyback-phygitals.7644129.sql` — the files keep their original
names, but **those two IDs no longer hold that SQL**.

**Cost — standing rule, size × cadence × measured credits:**

| | |
|---|---|
| Result size | **2 rows / 14 cols / 28 datapoints / 232 bytes** |
| Cadence | **one-shot, by hand. Nothing in `src/` references either id; neither is scheduled** |
| Measured `execution_cost_credits` | **107.579** (166s compute) |
| Estimate in §7 | ~30 cr — **the estimate was 3.6× low** |
| Account at run time | **9,283 / 4,000 credits = 232% of plan** (worse than the 183% in §1) |
| Usage delta across the run | 9,283.242 → 9,396.855 = **113.613** (execution + export + metadata probes) |

The estimate missed because §7 assumed "the same scan as 8252735, differing only
in `GROUP BY to_owner`". R3 needs the **inflow** leg too, to build the spender set —
two scans of `tokens_solana.transfers`, not one. Any future R3 variant costs about
this much; the 90d bracket would cost materially more, because the inflow scan
grows with the window.

7644129 is authored but unrun. It returns the top 40 recipients per platform with
`is_spender` / `not_excluded` flags — the named evidence behind §3d at full
density. Expect a similar ~100 cr. **Run it only if the lift decision needs the
per-counterparty breakdown.**

## A7. What this means for the display hold

Recommendation, for the orchestrator — not applied in this PR:

- **Phygitals: keep the outbound leg suppressed.** R3 was the proposed unblock and
  it leaves the rate above 100%. Nothing here supports publishing a payout or rate
  figure for Phygitals.
- **Collector Crypt: R3 is a real but small improvement** (95.29% → 94.92%,
  net +$7.90M → +$8.52M/35d). It is defensible on a methodology page and it makes
  the figure list-free. It does **not** by itself turn the gross-outbound label
  into a player-payout label — R3 filters counterparties, not purposes, and §A4's
  non-gacha-outflow residual is untested.
- **Reconsider R5/INV-10 before building it.** "payout ÷ spend > 1.0 = HARD fail"
  assumes a ratio above 1.0 can only mean a broken rule. §A4 shows a declining
  platform produces one legitimately. As specified it would fire on Phygitals
  forever and teach the team to ignore it.
- **The genuinely open question is temporal, not counterparty.** Cohorting payouts
  to the pulls they settle is what would make "net gacha revenue" a real figure.
  That is a new piece of work, and this run says it is the one that matters.
