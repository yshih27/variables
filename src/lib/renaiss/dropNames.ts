/**
 * Names for Renaiss's limited drops that its feed leaves unnamed, keyed by
 * product id. Renaiss's pulls feed (GET /v1/gacha/pulls) names a drop's machine
 * only from the Sep 24 2026 drop on; re-read on Oct 24 2026, it still names none
 * of the earlier ones. Each name is the one Renaiss gave the drop in its
 * announcement post on X (@renaissxyz), matched to the drop by the opening date
 * the post states (5PM UTC+8 = the 09:00 UTC opening). For the five drops the
 * feed does name, the posts' names equal the feed's. The Aug 14–Sep 18 names
 * came first from Varible's project lead (Oct 24 2026) and match the posts. A
 * name in the feed always wins, and the drops table's receipt line says where
 * the others come from. Client-safe (no imports).
 */
export const RENAISS_DROP_NAMES: Readonly<Record<string, string>> = {
  "onchain:0x734684b02bf4655ab871fd66c195c0e266653d4e7b1d7b9df8f822eabff1bac4": "Ribbon Pack", // opened Jun 19 2026 (first pack bought Jun 18)
  "onchain:0xefc3e5ad1b42ed2cf4aab951eaed172ee2903738b865a29cc03b0900ac0f7562": "Bowtie Pack", // Jun 26
  "62dccf7d-54bc-4411-b1f8-6eff18835c25": "World Cup Pack", // Jul 3
  "d74e6cd9-7378-4a22-be54-a682271645cc": "Champion Pack", // Jul 10
  "68830d91-2321-4c6d-94b6-a42feeb11799": "Cozy Pack", // Jul 17
  "c97cf07b-694e-433a-b85b-e3eecd0104b8": "Trinity Pack", // Jul 23
  "63a311f4-e512-44bc-93c1-2d664845607d": "Emerald Pack", // Jul 31
  "59dece9e-d6b2-4b82-a37b-46c6205af301": "Tempest Pack", // Aug 7
  "c975e271-5fa1-4d6d-b800-0234b40d4801": "Inferno Pack", // Aug 14
  "78a94802-612c-43a6-924c-fa47ce05dffd": "Surge Pack", // Aug 21
  "21411a21-6e03-4c49-bfc4-3567be16e718": "Genesis Pack", // Aug 27
  "b362b8d6-4176-4fd6-97a8-a3d328f41b26": "Niu Lai Pack", // Sep 4
  "9ead4cc7-de05-4bc9-ac41-d9542fb50e15": "Apple Pack", // Sep 11
  "e6b242a5-102e-4c5a-9f8d-fcfcb4c7781a": "Duo Pack", // Sep 18
};

export type DropLabel = { name: string; source: "feed" | "varible" };

/** A drop's name: the feed's, else the posted one Varible added, else null (the table prints "Drop"). */
export function dropLabel(d: { productId: string; name: string; named: boolean }): DropLabel | null {
  if (d.named) return { name: d.name, source: "feed" };
  const ours = RENAISS_DROP_NAMES[d.productId];
  return ours ? { name: ours, source: "varible" } : null;
}
