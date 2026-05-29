"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Rocket, Check } from "lucide-react";
import { api } from "@/lib/client";
import { cn } from "@/lib/util";
import { DEFAULT_PLANS } from "@/lib/plans";

interface TemplateView {
  id: string;
  game: string;
  name: string;
  tagline: string;
  icon: string;
  color: string;
  features: string[];
  images: string[];
  defaultImage: string | null;
  variables: { key: string; name: string; description: string; type: string; default: string; options?: { value: string; label: string }[]; group: string }[];
}

export default function NewServerPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [selected, setSelected] = useState<TemplateView | null>(null);
  const [name, setName] = useState("");
  const [planSlug, setPlanSlug] = useState(params.get("plan") ?? "nebula");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  useEffect(() => {
    api<{ templates: TemplateView[] }>("/api/templates")
      .then((r) => setTemplates(r.templates))
      .catch((e) => setError(e.message));
  }, []);

  function pick(t: TemplateView) {
    setSelected(t);
    setName((n) => n || `My ${t.name.split(":")[0]!.trim()} Server`);
    const init: Record<string, string> = {};
    for (const v of t.variables) init[v.key] = v.default;
    setVars(init);
  }

  const grouped = useMemo(() => {
    if (!selected) return {};
    return selected.variables.reduce<Record<string, TemplateView["variables"]>>((acc, v) => {
      (acc[v.group] ||= []).push(v);
      return acc;
    }, {});
  }, [selected]);

  async function deploy() {
    if (!selected) return;
    setDeploying(true);
    setError(null);
    try {
      const res = await api<{ id: string }>("/api/servers", {
        method: "POST",
        json: { name, templateId: selected.id, planSlug, variables: vars },
      });
      router.push(`/dashboard/servers/${res.id}`);
    } catch (e: any) {
      setError(e.message);
      setDeploying(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-3xl font-bold text-white">Deploy a new server</h1>
      <p className="mt-1 text-sm text-white/50">Pick a game, tweak the essentials, and it&apos;s online in seconds.</p>

      {error && <div className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* game picker */}
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/40">1 · Choose a game</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => pick(t)}
                className={cn(
                  "relative overflow-hidden rounded-2xl border p-4 text-left transition",
                  selected?.id === t.id ? "border-cyan/60 bg-white/[0.08]" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]",
                )}
              >
                {selected?.id === t.id && (
                  <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-cyan text-white">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-black/30 text-xl">{t.icon}</span>
                  <div>
                    <div className="font-medium text-white">{t.name}</div>
                    <div className="text-xs text-white/40">{t.tagline}</div>
                  </div>
                </div>
              </button>
            ))}
            {templates.length === 0 && <Loader2 className="h-5 w-5 animate-spin text-cyan" />}
          </div>
        </div>

        {/* config */}
        <div className="glass-raised h-fit p-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/40">2 · Configure</h2>
          {!selected ? (
            <p className="text-sm text-white/40">Select a game to configure it.</p>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="label">Server name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              </div>

              <div>
                <label className="label">Plan</label>
                <div className="grid grid-cols-3 gap-2">
                  {DEFAULT_PLANS.map((p) => (
                    <button
                      key={p.slug}
                      onClick={() => setPlanSlug(p.slug)}
                      className={cn(
                        "rounded-xl border px-2 py-2 text-center text-xs transition",
                        planSlug === p.slug ? "border-cyan/60 bg-cyan/10 text-white" : "border-white/10 text-white/60 hover:bg-white/5",
                      )}
                    >
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-white/40">{p.memoryMb / 1024} GB</div>
                    </button>
                  ))}
                </div>
              </div>

              {Object.entries(grouped).map(([group, list]) => (
                <div key={group}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/30">{group}</div>
                  <div className="space-y-3">
                    {list.map((v) => (
                      <div key={v.key}>
                        <label className="label" title={v.description}>{v.name}</label>
                        {v.type === "enum" && v.options ? (
                          <select className="input" value={vars[v.key] ?? ""} onChange={(e) => setVars((s) => ({ ...s, [v.key]: e.target.value }))}>
                            {v.options.map((o) => (
                              <option key={o.value} value={o.value} className="bg-surface">{o.label}</option>
                            ))}
                          </select>
                        ) : v.type === "boolean" ? (
                          <select className="input" value={vars[v.key] ?? ""} onChange={(e) => setVars((s) => ({ ...s, [v.key]: e.target.value }))}>
                            <option value="true" className="bg-surface">Enabled</option>
                            <option value="false" className="bg-surface">Disabled</option>
                            <option value="TRUE" className="bg-surface">TRUE</option>
                            <option value="FALSE" className="bg-surface">FALSE</option>
                          </select>
                        ) : (
                          <input
                            className="input"
                            type={v.type === "number" ? "number" : "text"}
                            value={vars[v.key] ?? ""}
                            onChange={(e) => setVars((s) => ({ ...s, [v.key]: e.target.value }))}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <button onClick={deploy} disabled={deploying || !name} className="btn-primary w-full py-3 text-base">
                {deploying ? <><Loader2 className="h-4 w-4 animate-spin" /> Deploying…</> : <><Rocket className="h-4 w-4" /> Deploy server</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
