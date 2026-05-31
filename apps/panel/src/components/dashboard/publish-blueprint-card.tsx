"use client";
import { useState } from "react";
import Link from "next/link";
import { Blocks, Loader2, Plus, X, CheckCircle2, Globe, Lock } from "lucide-react";
import { api } from "@/lib/client";

/**
 * Owner-only card to publish the current server's setup as a reusable Blueprint
 * on the marketplace. Snapshots the template + startup variables + modpack
 * server-side (only user-viewable, non-secret values). Render it in the
 * owner-only section of the Settings tab:
 *   <PublishBlueprintCard id={id} server={detail.server} />
 */
export function PublishBlueprintCard({
  id,
  server,
}: {
  id: string;
  server: { name: string; game: string; templateName?: string; icon?: string };
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(server.name);
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);

  async function publish() {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8);
      const res = await api<{ id: string }>(`/api/blueprints`, {
        method: "POST",
        json: { serverId: id, title: title.trim(), description: description.trim() || undefined, tags, public: isPublic },
      });
      setDoneId(res.id);
      setOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-display font-semibold text-white">
            <Blocks className="h-4 w-4 text-cyan" /> Publish as blueprint
          </h3>
          <p className="mt-1 max-w-prose text-sm text-white/45">
            Share this server's setup — its {server.templateName ?? "game"} template, startup variables and modpack — so
            anyone can deploy an identical server in one click from the marketplace.
          </p>
        </div>
        {!open && !doneId && (
          <button onClick={() => setOpen(true)} className="btn-primary shrink-0">
            <Plus className="h-4 w-4" /> Publish
          </button>
        )}
      </div>

      {doneId && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-online/30 bg-online/10 px-3 py-2.5 text-sm text-online">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Published to the marketplace.</span>
          <Link href="/dashboard/blueprints" className="underline hover:text-white">
            View it
          </Link>
          <button
            onClick={() => {
              setDoneId(null);
              setOpen(false);
            }}
            className="ml-auto text-online/70 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-4 border-t border-white/5 pt-4">
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
          )}
          <div>
            <label className="label">Title</label>
            <input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[80px] resize-y"
              value={description}
              maxLength={500}
              placeholder="What's in this setup? Mods, performance tweaks, recommended player count…"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Tags (comma-separated)</label>
            <input
              className="input"
              value={tagsInput}
              placeholder="fabric, performance, vanilla+"
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPublic((v) => !v)}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 hover:text-white"
            >
              {isPublic ? <Globe className="h-4 w-4 text-cyan" /> : <Lock className="h-4 w-4 text-white/50" />}
              {isPublic ? "Public — anyone can deploy it" : "Private — only you"}
            </button>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="btn-ghost">
              Cancel
            </button>
            <button onClick={publish} disabled={busy || !title.trim()} className="btn-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Blocks className="h-4 w-4" />} Publish blueprint
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
