import type { GameTemplate, TemplateVariable } from "./templates/template.js";

/** Replace {{KEY}} placeholders in a string from an environment map. */
export function interpolate(input: string, env: Record<string, string>): string {
  return input.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, key: string) => env[key] ?? "");
}

export interface ResolveOptions {
  /** produces a strong random string for {{RANDOM}} defaults (caller supplies crypto) */
  randomString: (len: number) => string;
}

/**
 * Build the final environment map for a server: start from template defaults,
 * resolve {{RANDOM}} secrets, then overlay user-supplied (and allowed) values.
 */
export function resolveEnvironment(
  template: GameTemplate,
  userValues: Record<string, string>,
  opts: ResolveOptions,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const v of template.variables) {
    let value = v.default;
    if (value === "{{RANDOM}}") value = opts.randomString(24);
    // only accept user overrides for editable variables
    if (v.userEditable && userValues[v.key] !== undefined && userValues[v.key] !== "") {
      value = userValues[v.key]!;
    }
    env[v.key] = value;
  }
  return env;
}

/** Basic, dependency-free validation of a variable value against its rules. */
export function validateVariable(v: TemplateVariable, value: string): string | null {
  const rules = v.rules.split("|").map((r) => r.trim()).filter(Boolean);
  for (const rule of rules) {
    if (rule === "required" && (value === undefined || value === "")) return `${v.name} is required`;
    if (rule === "integer" && value !== "" && !/^-?\d+$/.test(value)) return `${v.name} must be a whole number`;
    if (rule === "boolean" && !["true", "false", "TRUE", "FALSE", "1", "0", ""].includes(value))
      return `${v.name} must be true or false`;
    const between = rule.match(/^between:(-?\d+),(-?\d+)$/);
    if (between && value !== "") {
      const n = Number(value);
      const lo = Number(between[1]);
      const hi = Number(between[2]);
      if (Number.isNaN(n) || n < lo || n > hi) return `${v.name} must be between ${lo} and ${hi}`;
    }
    const min = rule.match(/^min:(\d+)$/);
    if (min && value.length < Number(min[1])) return `${v.name} must be at least ${min[1]} characters`;
  }
  if (v.type === "enum" && v.options && value !== "" && !v.options.some((o) => o.value === value)) {
    return `${v.name} must be one of: ${v.options.map((o) => o.value).join(", ")}`;
  }
  return null;
}

/** Pretty bytes for the UI. */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes < 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/** A connection address a player types in-game. */
export function buildAddress(host: string, port: number, defaultPort: number): string {
  return port === defaultPort ? host : `${host}:${port}`;
}

/** Slugify a server name into a safe container/world identifier. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "server";
}
