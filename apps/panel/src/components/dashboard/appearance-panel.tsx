"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Palette, Save, Loader2, Upload, ImageIcon, Check, AlertTriangle, Info, RotateCcw,
} from "lucide-react";
import { api } from "@/lib/client";

interface ServerVariable {
  key: string;
  name: string;
  value: string;
  editable: boolean;
}

interface ServerDetailResponse {
  variables: ServerVariable[];
}

const ICON_DIM = 64;

/**
 * MOTD + server-icon editor for Minecraft servers.
 *  - MOTD writes the `MOTD` startup variable via PATCH /api/servers/:id.
 *  - The server-icon is rescaled to a 64×64 PNG in the browser and streamed to
 *    the volume root as `server-icon.png` via the internal upload route.
 * Both apply on the next restart, which the panel makes clear.
 */
export function AppearancePanel({ id, canWrite }: { id: string; canWrite: boolean }) {
  const [motd, setMotd] = useState("");
  const [initialMotd, setInitialMotd] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMotd, setSavedMotd] = useState(false);

  // icon state
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconBlob, setIconBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const [iconDone, setIconDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<ServerDetailResponse>(`/api/servers/${id}`);
      const v = res.variables.find((x) => x.key === "MOTD");
      const value = v?.value ?? "";
      setMotd(value);
      setInitialMotd(value);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveMotd() {
    setSaving(true);
    setError(null);
    setSavedMotd(false);
    try {
      await api(`/api/servers/${id}`, { method: "PATCH", json: { variables: { MOTD: motd } } });
      setInitialMotd(motd);
      setSavedMotd(true);
      setTimeout(() => setSavedMotd(false), 2500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  /** Decode the picked image and re-encode it as a centered 64×64 PNG. */
  async function pickIcon(file: File) {
    setIconError(null);
    setIconDone(false);
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("That file is not a valid image."));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = ICON_DIM;
      canvas.height = ICON_DIM;
      const cx = canvas.getContext("2d");
      if (!cx) throw new Error("Canvas is not supported in this browser.");
      // cover-fit the source into the 64×64 square, centered
      const scale = Math.max(ICON_DIM / img.width, ICON_DIM / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      cx.imageSmoothingQuality = "high";
      cx.drawImage(img, (ICON_DIM - w) / 2, (ICON_DIM - h) / 2, w, h);
      URL.revokeObjectURL(url);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not encode the icon as PNG.");
      setIconBlob(blob);
      setIconPreview(canvas.toDataURL("image/png"));
    } catch (e: any) {
      setIconError(e.message);
      setIconBlob(null);
      setIconPreview(null);
    }
  }

  async function uploadIcon() {
    if (!iconBlob) return;
    setUploading(true);
    setIconError(null);
    setIconDone(false);
    try {
      const res = await fetch(
        `/api/servers/${id}/files/upload?path=${encodeURIComponent("/")}&name=server-icon.png`,
        { method: "POST", body: iconBlob, credentials: "include", headers: { "Content-Type": "image/png" } },
      );
      if (!res.ok) {
        const t = await res.json().catch(() => ({} as any));
        throw new Error(t.error || `Upload failed (${res.status})`);
      }
      setIconDone(true);
    } catch (e: any) {
      setIconError(e.message);
    } finally {
      setUploading(false);
    }
  }

  const motdDirty = motd !== initialMotd;

  return (
    <div className="space-y-5">
      {/* apply-on-restart note */}
      <div className="glass flex items-start gap-3 px-4 py-3 text-sm text-white/70">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
        <span>
          The message of the day and server icon are applied the next time the server{" "}
          <span className="text-white/90">restarts</span>. Saving here never interrupts a running server.
        </span>
      </div>

      {error && (
        <div className="glass flex items-center gap-2 px-4 py-2.5 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* MOTD editor */}
      <div className="glass overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white/70">
          <Palette className="h-4 w-4 text-cyan" /> Message of the day
        </div>
        <div className="space-y-3 p-4">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-cyan" />
            </div>
          ) : (
            <>
              <p className="text-xs text-white/40">
                Shown beneath your server in the multiplayer list. Supports legacy colour codes using
                the section sign (e.g. <span className="font-mono text-white/60">§b</span> cyan,{" "}
                <span className="font-mono text-white/60">§l</span> bold). Use <span className="font-mono text-white/60">\n</span> for a second line.
              </p>
              <textarea
                value={motd}
                onChange={(e) => setMotd(e.target.value)}
                readOnly={!canWrite}
                spellCheck={false}
                rows={2}
                maxLength={200}
                placeholder="§bWelcome to my server"
                className="console-surface w-full resize-none rounded-lg p-3 font-mono text-[13px] leading-relaxed text-console-text outline-none focus:ring-1 focus:ring-cyan/40 disabled:opacity-50"
              />
              {canWrite && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={saveMotd}
                    disabled={saving || !motdDirty}
                    className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save MOTD
                  </button>
                  {motdDirty && (
                    <button
                      onClick={() => setMotd(initialMotd)}
                      className="btn-ghost flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white/50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reset
                    </button>
                  )}
                  {savedMotd && (
                    <span className="flex items-center gap-1 text-xs text-online">
                      <Check className="h-3.5 w-3.5" /> Saved
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Server icon */}
      <div className="glass overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white/70">
          <ImageIcon className="h-4 w-4 text-cyan" /> Server icon
        </div>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          {/* preview tile */}
          <div className="flex shrink-0 flex-col items-center gap-2">
            <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
              {iconPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={iconPreview} alt="Server icon preview" width={64} height={64} className="h-16 w-16 [image-rendering:pixelated]" />
              ) : (
                <ImageIcon className="h-7 w-7 text-white/20" />
              )}
            </div>
            <span className="text-[10px] uppercase tracking-wide text-white/30">64 × 64 PNG</span>
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-xs text-white/40">
              Upload any square-ish image — it is automatically rescaled to a 64×64 PNG and saved to your
              server as <span className="font-mono text-white/60">server-icon.png</span>.
            </p>
            {iconError && (
              <div className="flex items-center gap-2 text-xs text-danger">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {iconError}
              </div>
            )}
            {canWrite ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = "";
                    if (f) pickIcon(f);
                  }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/70"
                >
                  <Upload className="h-3.5 w-3.5" /> Choose image
                </button>
                <button
                  onClick={uploadIcon}
                  disabled={!iconBlob || uploading}
                  className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Upload icon
                </button>
                {iconDone && (
                  <span className="flex items-center gap-1 text-xs text-online">
                    <Check className="h-3.5 w-3.5" /> Uploaded — applies on next restart
                  </span>
                )}
              </div>
            ) : (
              <p className="text-xs text-white/30">You lack permission to change the server icon.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
