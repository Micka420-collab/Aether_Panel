import { describe, it, expect } from "vitest";
import { parsePlayerList } from "../dist/rcon.js";
import { safeResolve } from "../dist/files.js";

describe("parsePlayerList", () => {
  it("parses the Minecraft list output", () => {
    const r = parsePlayerList("There are 2 of a max of 20 players online: Alice, Bob");
    expect(r.online).toBe(2);
    expect(r.max).toBe(20);
    expect(r.sample).toEqual(["Alice", "Bob"]);
  });
  it("handles an empty server", () => {
    const r = parsePlayerList("There are 0 of a max of 20 players online:");
    expect(r.online).toBe(0);
    expect(r.sample).toEqual([]);
  });
  it("is resilient to garbage", () => {
    expect(parsePlayerList("???").online).toBe(0);
  });
});

describe("safeResolve (path jail)", () => {
  const sid = "abc123";
  it("resolves paths inside the volume", () => {
    const p = safeResolve(sid, "world/level.dat");
    expect(p).toContain(sid);
    expect(p).toMatch(/level\.dat$/);
  });
  it("blocks traversal out of the volume", () => {
    expect(() => safeResolve(sid, "../../etc/passwd")).toThrow(/escapes/);
    expect(() => safeResolve(sid, "../../../root/.ssh/id_rsa")).toThrow(/escapes/);
  });
  it("normalises leading slashes to the volume root", () => {
    expect(() => safeResolve(sid, "/server.properties")).not.toThrow();
  });
});
