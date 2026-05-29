/**
 * @aether/shared — the cross-runtime contract for the Aether platform.
 * Imported by the Next.js panel (browser + server) and the Node daemon.
 */
export * from "./types.js";
export * from "./scopes.js";
export * from "./util.js";
export * from "./templates/index.js";

export const AETHER = {
  name: "Aether",
  tagline: "Game servers, summoned in seconds.",
  version: "1.0.0",
} as const;
