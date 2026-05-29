import { describe, it, expect } from "vitest";
import {
  interpolate,
  resolveEnvironment,
  validateVariable,
  slugify,
  buildAddress,
  formatBytes,
  hasScope,
  getTemplate,
  requireTemplate,
  listGames,
  TEMPLATES,
  ALL_SCOPES,
  type TemplateVariable,
} from "../dist/index.js";

const det = { randomString: (n: number) => "R".repeat(n) };

describe("interpolate", () => {
  it("replaces {{VAR}} from the env, blanks unknowns", () => {
    expect(interpolate("a {{X}} b {{Y}}", { X: "1", Y: "2" })).toBe("a 1 b 2");
    expect(interpolate("hi {{MISSING}}", {})).toBe("hi ");
  });
});

describe("resolveEnvironment", () => {
  const mc = requireTemplate("minecraft-java");
  it("applies defaults and resolves {{RANDOM}} secrets", () => {
    const env = resolveEnvironment(mc, {}, det);
    expect(env.EULA).toBe("TRUE");
    expect(env.TYPE).toBe("PAPER");
    expect(env.RCON_PASSWORD).toBe("R".repeat(24)); // {{RANDOM}} expanded
  });
  it("honours editable user overrides", () => {
    const env = resolveEnvironment(mc, { TYPE: "FABRIC", MAX_PLAYERS: "40" }, det);
    expect(env.TYPE).toBe("FABRIC");
    expect(env.MAX_PLAYERS).toBe("40");
  });
  it("ignores overrides for non-editable variables", () => {
    const env = resolveEnvironment(mc, { RCON_PASSWORD: "hacker" }, det);
    expect(env.RCON_PASSWORD).not.toBe("hacker");
  });
});

describe("validateVariable", () => {
  const base: TemplateVariable = {
    key: "X", name: "X", description: "", default: "", userViewable: true, userEditable: true, type: "string", rules: "",
  };
  it("required", () => {
    expect(validateVariable({ ...base, rules: "required|string" }, "")).toMatch(/required/);
    expect(validateVariable({ ...base, rules: "required|string" }, "ok")).toBeNull();
  });
  it("integer + between", () => {
    expect(validateVariable({ ...base, type: "number", rules: "integer|between:1,10" }, "abc")).toMatch(/whole number/);
    expect(validateVariable({ ...base, type: "number", rules: "integer|between:1,10" }, "20")).toMatch(/between/);
    expect(validateVariable({ ...base, type: "number", rules: "integer|between:1,10" }, "5")).toBeNull();
  });
  it("enum", () => {
    const v: TemplateVariable = { ...base, type: "enum", rules: "", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
    expect(validateVariable(v, "c")).toMatch(/one of/);
    expect(validateVariable(v, "a")).toBeNull();
  });
  it("min length", () => {
    expect(validateVariable({ ...base, rules: "min:5" }, "abc")).toMatch(/at least/);
  });
});

describe("util helpers", () => {
  it("slugify", () => {
    expect(slugify("My Cool Server!!")).toBe("my-cool-server");
    expect(slugify("   ")).toBe("server");
  });
  it("buildAddress hides the default port", () => {
    expect(buildAddress("play.host", 25565, 25565)).toBe("play.host");
    expect(buildAddress("play.host", 25600, 25565)).toBe("play.host:25600");
  });
  it("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
  });
});

describe("scopes", () => {
  it("hasScope respects wildcard", () => {
    expect(hasScope(["control.start"], "control.start")).toBe(true);
    expect(hasScope(["control.start"], "file.read")).toBe(false);
    expect(hasScope(["*"], "file.read")).toBe(true);
  });
  it("ALL_SCOPES is non-empty", () => {
    expect(ALL_SCOPES.length).toBeGreaterThan(10);
  });
});

describe("template registry", () => {
  it("ships Minecraft and Icarus", () => {
    expect(getTemplate("minecraft-java")?.game).toBe("minecraft");
    expect(getTemplate("icarus-dedicated")?.game).toBe("icarus");
    expect(getTemplate("nope")).toBeUndefined();
    expect(() => requireTemplate("nope")).toThrow();
  });
  it("Minecraft has RCON, Icarus does not", () => {
    expect(requireTemplate("minecraft-java").rcon).toBeTruthy();
    expect(requireTemplate("icarus-dedicated").rcon).toBeUndefined();
  });
  it("every template has a primary port and an install script", () => {
    for (const t of TEMPLATES) {
      expect(t.ports.some((p) => p.primary) || t.ports.length > 0).toBe(true);
      expect(t.install.script.length).toBeGreaterThan(0);
    }
  });
  it("listGames dedupes by game", () => {
    const games = listGames().map((g) => g.game);
    expect(games).toContain("minecraft");
    expect(games).toContain("icarus");
    expect(new Set(games).size).toBe(games.length);
  });
});
