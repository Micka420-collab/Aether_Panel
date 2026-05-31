"use client";
import { useCallback, useEffect, useState } from "react";
import { Search, Check, Loader2, Package, ExternalLink, Boxes, X } from "lucide-react";
import { api } from "@/lib/client";
import { cn } from "@/lib/util";

interface ModpackHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  icon: string | null;
  downloads: number;
  author: string;
  projectType: string;
  categories?: string[];
}

/** The env-var patch the wizard merges into the new server's variables. */
export type ModpackPick = { MODRINTH_MODPACK: string };

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Searchable Modrinth modpack grid for the create-server wizard.
 *
 * Embed it (Minecraft only) and pass `onPick`; when a pack is selected it fires
 * `onPick({ MODRINTH_MODPACK: slug })`. The host merges that into the variables
 * sent to POST /api/servers — itzg installs the pack on first boot. Passing the
 * same `selectedSlug` back keeps the chosen card highlighted; clear it with the
 * "Use the standard server" button which calls `onPick(null)`.
 */
export function ModpackPicker({
  onPick,
  selectedSlug = null,
  loader = null,
  version = null,
}: {
  onPick: (pick: ModpackPick | null) => void;
  selectedSlug?: string | null;
  /** Optional modloader hint (fabric/forge/quilt/neoforge) for messaging only. */
  loader?: string | null;
  /** Optional MC version to bias results (LATEST/SNAPSHOT resolved server-side). */
  version?: string | null;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ModpackHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(
    async (query: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: query, source: "modrinth" });
        if (loader) params.set("loader", loader);
        if (version) params.set("version", version);
        const r = await api<{ hits: ModpackHit[] }>(`/api/modpacks/search?${params.toString()}`);
        setHits(r.hits);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [loader, version],
  );

  // Debounced search; re-runs when the query or version/loader hint changes.
  useEffect(() => {
    const t = setTimeout(() => search(q), 350);
    return () => clearTimeout(t);
  }, [q, search]);

  return (
    <div className="rounded-2xl border border-violet/25 bg-violet/[0.05] p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <Boxes className="h-4 w-4 text-violet" /> Choose a modpack
        </div>
        {selectedSlug && (
          <button
            onClick={() => onPick(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/55 transition hover:text-white"
          >
            <X className="h-3 w-3" /> Use the standard server
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-white/45">
        Search <span className="text-white/70">Modrinth</span> modpacks. The selected pack installs automatically on first
        boot — no manual setup. Picking one also sets the matching loader for you.
      </p>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search modpacks… (e.g. Fabulously Optimized, Better MC, Create)"
          className="input pl-9"
        />
      </div>

      {error && <div className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="mt-3 grid max-h-[26rem] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {loading && (
          <div className="col-span-full flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-violet" />
          </div>
        )}
        {!loading &&
          hits.map((h) => {
            const active = selectedSlug === h.slug;
            return (
              <button
                key={h.projectId}
                type="button"
                onClick={() => onPick(active ? null : { MODRINTH_MODPACK: h.slug })}
                className={cn(
                  "relative flex gap-3 rounded-xl border p-3 text-left transition",
                  active
                    ? "border-violet/60 bg-violet/10"
                    : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                )}
              >
                {active && (
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-violet text-white">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {h.icon ? (
                  <img src={h.icon} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-white/10 bg-black/30 object-cover" />
                ) : (
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/30 text-white/40">
                    <Package className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="truncate font-medium text-white">{h.title}</h4>
                    <span className="shrink-0 text-xs text-white/35">{fmt(h.downloads)} ↓</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-white/50">{h.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {(h.categories ?? []).slice(0, 2).map((c) => (
                      <span key={c} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] capitalize text-white/40">{c}</span>
                    ))}
                    <a
                      href={`https://modrinth.com/modpack/${h.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-[10px] text-white/40 hover:text-violet"
                    >
                      <ExternalLink className="h-3 w-3" /> info
                    </a>
                  </div>
                </div>
              </button>
            );
          })}
        {!loading && hits.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-white/30">No modpacks found.</div>
        )}
      </div>

      {selectedSlug && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-violet/30 bg-violet/[0.08] px-3 py-2 text-xs text-white/70">
          <Check className="h-3.5 w-3.5 text-violet" />
          Deploying with modpack <span className="font-medium text-white">{selectedSlug}</span>.
        </div>
      )}
    </div>
  );
}
