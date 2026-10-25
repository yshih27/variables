/**
 * Names for Renaiss's limited drops that its feed leaves unnamed, keyed by
 * product id. Renaiss's pulls feed (GET /v1/gacha/pulls) names a drop's machine
 * only from the Sep 24 2026 drop on; re-read on Oct 24 2026, it still names none
 * of the earlier ones. These names come from Varible's project lead (Oct 24
 * 2026). A name in the feed always wins, and the drops table's receipt line says
 * which names are Varible's. Client-safe (no imports).
 */
export const RENAISS_DROP_NAMES: Readonly<Record<string, string>> = {
  "c975e271-5fa1-4d6d-b800-0234b40d4801": "Inferno Pack", // first pull Aug 14 2026
  "78a94802-612c-43a6-924c-fa47ce05dffd": "Surge Pack", // Aug 21
  "21411a21-6e03-4c49-bfc4-3567be16e718": "Genesis Pack", // Aug 27
  "9ead4cc7-de05-4bc9-ac41-d9542fb50e15": "Apple Pack", // Sep 11
  "e6b242a5-102e-4c5a-9f8d-fcfcb4c7781a": "Duo Pack", // Sep 18
};

export type DropLabel = { name: string; source: "feed" | "varible" };

/** A drop's name: the feed's, else Varible's, else null (the table prints "Drop"). */
export function dropLabel(d: { productId: string; name: string; named: boolean }): DropLabel | null {
  if (d.named) return { name: d.name, source: "feed" };
  const ours = RENAISS_DROP_NAMES[d.productId];
  return ours ? { name: ours, source: "varible" } : null;
}
