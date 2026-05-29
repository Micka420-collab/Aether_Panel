"use client";
import { useEffect, useState } from "react";
import { Loader2, Play, Power } from "lucide-react";
import { AmbientBackground } from "@/components/ambient";
import { Logo } from "@/components/logo";
import { api } from "@/lib/client";

interface WakeInfo {
  name: string;
  game: string;
  icon: string;
  state: string;
  address: string | null;
}

export default function WakePage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [info, setInfo] = useState<WakeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function refresh() {
    try {
      setInfo(await api<WakeInfo>(`/api/wake/${token}`));
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function wake() {
    setStarting(true);
    setError(null);
    try {
      await api(`/api/wake/${token}`, { method: "POST" });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  const running = info?.state === "running";
  const transitioning = info?.state === "starting" || info?.state === "installing";

  return (
    <>
      <AmbientBackground dense />
      <main className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="mb-8">
          <Logo />
        </div>
        <div className="glass-raised w-full max-w-md p-8 text-center">
          {error && <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
          {!info ? (
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan" />
          ) : (
            <>
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-black/30 text-4xl">
                {info.icon}
              </div>
              <h1 className="mt-4 font-display text-2xl font-bold text-white">{info.name}</h1>
              <p className="mt-1 text-sm capitalize text-white/45">{info.game} server</p>

              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${running ? "bg-online" : transitioning ? "animate-pulse-dot bg-warn" : "bg-white/30"}`}
                />
                <span className="capitalize text-white/80">{info.state}</span>
              </div>

              {running && info.address && (
                <div className="mt-5 rounded-xl border border-online/30 bg-online/10 px-4 py-3 font-mono text-sm text-online">
                  {info.address}
                </div>
              )}

              {!running && (
                <button onClick={wake} disabled={starting || transitioning} className="btn-primary mt-6 w-full py-3 text-base">
                  {starting || transitioning ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</>
                  ) : (
                    <><Play className="h-4 w-4" /> Wake the server</>
                  )}
                </button>
              )}
              <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-white/35">
                <Power className="h-3 w-3" /> This link can only start the server.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
