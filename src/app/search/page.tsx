import Link from "next/link";
import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { buildSearch, type GroupedResults, type SearchResult } from "@/lib/data/searchIndex";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Search · VARIABLE",
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
  const home = await getHome();
  const results = buildSearch(home, query);

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[820px] px-8 pt-10 pb-24 font-sans">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <a href="/" className="hover:text-ink-2">Rankings</a>
          <span>›</span>
          <span className="text-ink-2">Search</span>
        </div>

        <h1 className="text-[32px] font-bold leading-none tracking-[-0.01em]">
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
          <span className="font-semibold text-ink-2">Heads up:</span> v1 search
          covers IPs, platforms, and cards surfaced in the last 24h. Full
          card-level search across all ~125K tracked tokens lands when we
          publish the persistent search index.
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
