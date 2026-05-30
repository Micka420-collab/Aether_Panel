"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically re-runs the current (dynamic) server component via router.refresh()
 * so server-rendered data — e.g. the dashboard's reconciled server states — stays
 * live without a manual reload. Pauses while the tab is hidden.
 */
export function AutoRefresh({ seconds = 6 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const t = setInterval(tick, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
