import Link from "next/link";
import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { buildSearch, cardHitToResult, type GroupedResults, type SearchResult } from "@/lib/data/searchIndex";
import { searchCardsByName } from "@/lib/data/cards";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Search · VARIBLE",
  description: "Find IPs, platforms, and cards across tracked tokenized-collectibles platforms.",
};

const getHome = unstable_cache(
  async () => fetchHomepage(),
  ["search-source:v2"],
  { revalidate: 3600, tags: ["homepage"] },
);

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const [home, cardHits] = await Promise.all([getHome(), searchCardsByName(query, 12)]);
  const base = buildSearch(home, query);

  // Merge full-table card hits (searchCardsByName over ~137K cards) with the base
  // 24h-feed cards: keep the timely 24h matches first, then the most valuable table
  // matches; dedupe by name so the same card doesn't appear twice (QA-3).
  const seenCards = new Set<string>();
  const cards = [...base.cards, ...cardHits.map(cardHitToResult)]
    .filter((c) => {
      const k = c.label.toLowerCase();
      if (seenCards.has(k)) return false;
      seenCards.add(k);
      return true;
    })
    .slice(0, 12);
  const results: GroupedResults = {
    ...base,
    cards,
    total: base.ips.length + base.platforms.length + cards.length,
  };

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[820px] px-8 pt-10 pb-24 font-sans">

        <h1 className="text-[20px] font-bold leading-none tracking-[-0.01em]">
          {query.length === 0 ? "Search" : (
            <>
              Search results for <span className="text-yellow">&ldquo;{query}&rdquo;</span>
            </>
          )}
        </h1>
        <div className="mt-2 mb-10 text-[13px] text-ink-3">
          {query.length === 0
            ? "Type in the search box above to find IPs, platforms, and cards."
            : `${results.total} result${results.total === 1 ? "" : "s"} across IPs, platforms, and cards.`}
        </div>

        {query.length > 0 && results.total === 0 && <EmptyState query={query} />}

        {query.length > 0 && results.total > 0 && (
          <div className="flex flex-col gap-10">
            <Group label="IPs / Categories" results={results.ips} />
            <Group label="Platforms" results={results.platforms} />
            <Group label="Cards" results={results.cards} />
          </div>
        )}

        <div className="mt-16 rounded-xl border border-line/70 bg-bg-1 p-5 text-[12px] text-ink-3">
          <span className="font-semibold text-ink-2">Search</span> covers every IP
          and platform plus all tracked cards by name (ranked by value). Set- and
          grade-level filters land next.
        </div>
      </div>
    </>
  );
}

function Group({ label, results }: { label: string; results: SearchResult[] }) {
  if (results.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-[14px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          {label}
        </h2>
        <span className="text-[11px] text-ink-4 tabular">{results.length}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {results.map((r) => (
          <li key={`${r.kind}:${r.href}:${r.label}`}>
            <Link
              href={r.href}
              className="flex items-baseline justify-between gap-3 rounded-lg border border-line/60 bg-bg-1 px-4 py-3 transition-colors hover:border-yellow/40 hover:text-yellow"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] font-semibold">{r.label}</span>
                {r.sub && <span className="text-[11.5px] text-ink-3">{r.sub}</span>}
              </span>
              <span className="text-[11px] uppercase tracking-[0.06em] text-ink-4">
                {r.kind}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <section className="rounded-xl border border-line/70 bg-bg-1 p-8 text-center">
      <h2 className="mb-2 text-[18px] font-semibold">No matches for &ldquo;{query}&rdquo;</h2>
      <p className="text-[13px] text-ink-3">
        Try a different spelling, a category name like &ldquo;Pokémon&rdquo;,
        or a platform like &ldquo;Courtyard&rdquo;.
      </p>
    </section>
  );
}

// Make the typed payload visible to the GroupedResults import (silences
// "unused type" lint when GroupedResults is only re-exported from buildSearch).
export type { GroupedResults };
