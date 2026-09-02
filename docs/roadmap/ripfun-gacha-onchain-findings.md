# rip.fun gacha lane on Base — why the Dune query was not written

Executor report against `docs/roadmap/brief-backend-ripfun-dune-gacha.md`. All
evidence below is from Base mainnet RPC (`https://mainnet.base.org`), read
2026-09-03. **No Dune query was created and no Dune credits were spent** — the
brief's stop condition fired before any SQL was worth writing.

## The stop condition, and that it fired

> If payment is off-chain (card rails) and mints carry no value leg, gacha spend
> is NOT derivable on-chain — STOP and report rather than shipping pack COUNTS
> dressed as dollars. Pack counts alone are not a volume metric.

Pack mints on Base carry **no value leg of any kind**. Not USDC, not ETH, not any
ERC-20. The purchase settles off-chain, and nothing on-chain records what was
paid.

## What IS on-chain (the contract is genuinely busy)

Pack contract `0x143f4c37247F561ecEC9247602cba074230f9FA2` — ERC-721 "RIP.FUN
Packs" (RIPP), ERC-1967 proxy, implementation `0x4c3a63f3…`, Base mainnet
(`eth_chainId` → `0x2105` = 8453).

35-day scan of its `Transfer` logs (152 × 10,000-block windows, 10 windows failed
and were not retried, so these are floors):

| event | count / 35d |
|---|---|
| mint (`from` = `0x0`) | **469** |
| burn (`to` = `0x0`) — a pack being ripped | **427** |
| wallet → wallet | **1,068** |
| **total** | **2,158** |

That is the order the brief predicted (≤2K rows/35d), so a Dune query over this
contract would indeed have been cheap. Cost was never the blocker.

## Why no dollar figure comes out of it

### 1. Mints carry nothing — 14 of 14 distinct transactions

Every pack mint arrives as an ERC-4337 **UserOperation**: `to` = EntryPoint v0.7
`0x0000000071727de22e5e9d8baf0edac6f37da032`, selector `0x765e827f`
(`handleOps`), gas sponsored.

Across 14 **distinct** mint transactions sampled across the window:

```
with ANY ERC-20 transfer in the receipt : 0
with nonzero ETH value                  : 0
tx selectors                            : 0x765e827f × 14
contracts appearing in mint receipts    : EntryPoint  14/14
                                          pack contract 14/14
                                          (nothing else, ever)
```

Only two contracts appear in a mint receipt. There is no payment contract, no
token, no third party — so there is nothing to join a price to.

### 2. A rip carries nothing either

`0x50955342a853f6b01a4b427a9e92683f71dba111c36cb2eaeb5526c0dfe94da4` is a
representative pack opening: pack `#41510` burned from the holder, ~12 Cards sent
to them from vault `0xed5c400a449bb0c023f1cad5f121b43072f51ba2`, 17 logs, **ETH
value 0 and zero ERC-20 transfers**. The reveal moves cards, not money.

### 3. No on-chain price to reconstruct an amount from

The brief allows an amount-per-mint reconstruction *if tier prices are fixed
on-chain*. They are not readable:

```
price()  packPrice()  mintPrice()  tierPrice(uint256)  getTier(uint256)   → all revert
```

And the mint event `0x47d0031c…(uint256 tokenId, address minter, uint256 ?)` has
exactly one numeric field, whose observed values across 248 samples are:

```
152 ×60 · 154 ×48 · 153 ×48 · 155 ×42 · 139 ×25 · 151 ×24 · 34 ×1
```

A tight, sequential cluster of small integers — a **set / expansion id**, not a
price. Real pack prices do not land on $1.51, $1.52, $1.53, $1.54, $1.55 in
near-equal proportions. The event's data payload confirms the field is
descriptive, not monetary; it decodes to a metadata URL and a pack slug:

```
https://www.rip.fun/api/onchain/pack/PACK-RIPBD8FCC687EBE/metadata
PACK-RIPBD8FCC687EBE
```

### 4. No USDC anywhere in the footprint

USDC (`0x8335…2913`) `Transfer` scan over ~7 days, both directions:

| address | in | out |
|---|---|---|
| card vault `0xed5c400a…` | $0.00 (0 transfers) | $0.00 (0 transfers) |
| pack contract `0x143f4c37…` | $0.00 (0) | $0.00 (0) |
| rip target `0xc69f0c23…` | $0.00 (0) | $0.00 (0) |

Not one dollar of USDC touches the on-chain footprint.

## Where the money actually is

Off-chain, in custodial balances. CardOS's own Gacha API documents exactly this
shape — `/api/v1/wallet/balance` ("Custodial credits balance for an end-user"),
`/wallet/ledger`, `/wallet/deposits`, `/wallet/deposit-address`. Users fund a
balance and spend credits; the chain only records the resulting NFT movements.

That also means a deposits lane, even if the deposit addresses were identified,
would be the **wrong number**: money entering a custodial balance is not money
spent on packs, and publishing it as gacha volume would be a category error on
top of an attribution guess.

## What was NOT done, deliberately

Nothing from the brief's wiring section was built — no `rip-fun` in
`PLATFORM_SOURCES`, no buckets/fetchPlatform entry, no `gacha_volume_usd` spine
metric, no check-freshness source, no Dune query id, no buy links.

A `rip-fun` row shipped today would be `—` for marketplace, mcap, holders and
trades (correct — those genuinely have no source) and, for gacha, either a
fabricated dollar figure or a pack count sitting in a dollar column. The brief
rules both out, and it is right to: 469 mints/35d is a real number, but it is a
**count**, and no column on the platform table means "count of packs".

## What would unblock it

1. **The mystery-partner key.** `GET /api/v1/mystery/feed/recent` (all-partner
   pulls, `scope=mine` to narrow) and `/api/v1/mystery/catalog/{tier_id}/odds`
   carry realized pulls with values and authoritative on-chain-weighted odds —
   the same realized-pull shape the Phygitals and CC models already run on. This
   supersedes any Dune query for pull-level data, as the brief anticipated.
2. **A stated tier price list**, if rip.fun will publish one. With prices and the
   mint event's set id, an amount-per-mint reconstruction becomes possible — but
   only if the set id actually maps to a price tier, which is an assumption the
   chain cannot confirm today.

Neither is an engineering task; both are the partner conversation.

## Reproducing this

Everything above is free public RPC — no key, no credits:

- mint/burn/p2p classification: `eth_getLogs` on the pack contract, topic0
  `Transfer`, 10,000-block windows (the public Base RPC's hard cap)
- per-transaction evidence: `eth_getTransactionByHash` + `eth_getTransactionReceipt`
- price probes: `eth_call` against the proxy
- USDC flow: `eth_getLogs` on the USDC contract with padded address topics
