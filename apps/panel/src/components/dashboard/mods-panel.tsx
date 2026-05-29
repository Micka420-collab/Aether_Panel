"use client";
import { useCallback, useEffect, useState } from "react";
import { Search, Download, Check, X, Loader2, Package, Info, ExternalLink } from "lucide-react";
import { api } from "@/lib/client";
import { cn } from "@/lib/util";

interface Hit {
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
type ModType = "mod" | "plugin" | "modpack";
type Source = "modrinth" | "curseforge";

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ModsPanel({ id, canManage }: { id: string; canManage: boolean }) {
  const [installed, setInstalled] = useState<string[]>([]);
  const [cfInstalled, setCfInstalled] = useState<string[]>([]);
  const [modpack, setModpack] = useState<string | null>(null);
  const [cfEnabled, setCfEnabled] = useState(false);
  const [ctx, setCtx] = useState<{ loader: string | null; version: string | null; defaultType: ModType } | null>(null);
  const [source, setSource] = useState<Source>("modrinth");
  const [type, setType] = useState<ModType>("mod");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadInstalled = useCallback(async () => {
    const r = await api<{ installed: string[]; curseforge: string[]; modpack: string | null; context: any; curseforgeEnabled: boolean }>(`/api/servers/${id}/mods`);
    setInstalled(r.installed);
    setCfInstalled(r.curseforge ?? []);
    setModpack(r.modpack);
    setCtx(r.context);
    setCfEnabled(r.curseforgeEnabled);
    setType(r.context.defaultType);
  }, [id]);

  useEffect(() => {
    loadInstalled().catch((e) => setError(e.message));
  }, [loadInstalled]);

  const search = useCallback(
    async (query: string, t: ModType, src: Source) => {
      setLoading(true);
      setError(null);
      try {
        const r = await api<{ hits: Hit[] }>(`/api/servers/${id}/mods/search?q=${encodeURIComponent(query)}&type=${t}&source=${src}`);
        setHits(r.hits);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    if (!ctx) return;
    const t = setTimeout(() => search(q, type, source), 350);
    return () => clearTimeout(t);
  }, [q, type, source, ctx, search]);

  async function install(h: Hit) {
    setBusy(h.slug);
    try {
      const r = await api<{ installed: string[]; curseforge: string[]; modpack: string | null }>(`/api/servers/${id}/mods`, {
        method: "POST",
        json: { slug: h.slug, type, source },
      });
      setInstalled(r.installed);
      setCfInstalled(r.curseforge ?? []);
      setModpack(r.modpack);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }
  async function remove(slug: string, t: ModType, src: Source) {
    await api(`/api/servers/${id}/mods?slug=${encodeURIComponent(slug)}&type=${t}&source=${src}`, { method: "DELETE" }).catch((e) => setError(e.message));
    loadInstalled();
  }

  // CurseForge can't install modpacks here; Modrinth can.
  const types: ModType[] = source === "curseforge" ? [ctx?.defaultType ?? "mod"] : ctx?.defaultType === "plugin" ? ["plugin", "modpack"] : ["mod", "modpack"];
  const isInstalled = (slug: string) =>
    source === "curseforge" ? cfInstalled.includes(slug) : type === "modpack" ? modpack === slug : installed.includes(slug);

  return (
    <div className="space-y-5">
      <div className="glass p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-display font-semibold text-white">
            <Package className="h-4 w-4 text-cyan" /> Content browser
          </h3>
          {ctx && (
            <span className="chip">
              {ctx.loader ?? "vanilla"}{ctx.version ? ` · ${ctx.version}` : ""}
            </span>
          )}
        </div>

        {cfEnabled && (
          <div className="mt-4 flex w-fit rounded-xl border border-white/10 bg-black/20 p-1">
            {(["modrinth", "curseforge"] as Source[]).map((s) => (
              <button
                key={s}
                onClick={() => { setSource(s); if (s === "curseforge" && type === "modpack") setType(ctx?.defaultType ?? "mod"); }}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition", source === s ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-white/10 bg-black/20 p-1">
            {types.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition", type === t ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}
              >
                {t === "modpack" ? "Modpacks" : t === "plugin" ? "Plugins" : "Mods"}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${source === "curseforge" ? "CurseForge" : "Modrinth"} ${type === "modpack" ? "modpacks" : type + "s"}…`}
              className="input pl-9"
            />
          </div>
        </div>

        {error && <div className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

        <p className="mt-3 flex items-center gap-1.5 text-xs text-white/35">
          <Info className="h-3.5 w-3.5" /> Installs apply on the next server restart. Powered by the {source === "curseforge" ? "CurseForge" : "Modrinth"} API.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {loading && <div className="col-span-full flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-cyan" /></div>}
        {!loading && hits.map((h) => {
          const inst = isInstalled(h.slug);
          return (
            <div key={`${source}-${h.projectId}`} className="glass flex gap-3 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {h.icon ? <img src={h.icon} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-white/10 bg-black/30 object-cover" /> : <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/30 text-white/40"><Package className="h-5 w-5" /></div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="truncate font-medium text-white">{h.title}</h4>
                  <span className="shrink-0 text-xs text-white/35">{fmt(h.downloads)} ↓</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-white/50">{h.description}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {source === "modrinth" && ctx?.loader && (
                    <span className="rounded bg-online/10 px-1.5 py-0.5 text-[10px] font-medium text-online">
                      {ctx.loader}{ctx.version ? ` ${ctx.version}` : ""} ✓
                    </span>
                  )}
                  {(h.categories ?? []).filter((c) => c !== ctx?.loader).slice(0, 2).map((c) => (
                    <span key={c} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] capitalize text-white/40">{c}</span>
                  ))}
                  {source === "modrinth" && (
                    <a
                      href={`https://modrinth.com/${h.projectType}/${h.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-[10px] text-white/40 hover:text-cyan"
                    >
                      <ExternalLink className="h-3 w-3" /> info
                    </a>
                  )}
                </div>
                {canManage && (
                  <button
                    onClick={() => install(h)}
                    disabled={inst || busy === h.slug}
                    className={cn("mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition", inst ? "bg-online/15 text-online" : "btn-primary !px-2.5 !py-1")}
                  >
                    {busy === h.slug ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : inst ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                    {inst ? "Installed" : "Install"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!loading && hits.length === 0 && <div className="col-span-full py-10 text-center text-sm text-white/30">No results.</div>}
      </div>

      {(installed.length > 0 || cfInstalled.length > 0 || modpack) && (
        <div className="glass p-5">
          <h3 className="mb-3 font-display font-semibold text-white">Installed</h3>
          <div className="flex flex-wrap gap-2">
            {modpack && (
              <span className="chip gap-2">
                📦 {modpack} (modpack)
                {canManage && <button onClick={() => remove(modpack, "modpack", "modrinth")} className="text-white/40 hover:text-danger"><X className="h-3 w-3" /></button>}
              </span>
            )}
            {installed.map((slug) => (
              <span key={`m-${slug}`} className="chip gap-2">
                {slug}
                {canManage && <button onClick={() => remove(slug, "mod", "modrinth")} className="text-white/40 hover:text-danger"><X className="h-3 w-3" /></button>}
              </span>
            ))}
            {cfInstalled.map((slug) => (
              <span key={`c-${slug}`} className="chip gap-2 border-warn/30 text-warn">
                {slug} <span className="text-[9px] opacity-70">CF</span>
                {canManage && <button onClick={() => remove(slug, "mod", "curseforge")} className="text-white/40 hover:text-danger"><X className="h-3 w-3" /></button>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
