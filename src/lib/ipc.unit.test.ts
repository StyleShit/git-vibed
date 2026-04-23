import { describe, expect, it } from "vitest";
import { maybe, unwrap } from "./ipc";

describe("unwrap", () => {
  it("resolves to data on { ok: true }", async () => {
    const v = await unwrap(Promise.resolve({ ok: true as const, data: 42 }));
    expect(v).toBe(42);
  });

  it("throws the error string on { ok: false }", async () => {
    await expect(
      unwrap(Promise.resolve({ ok: false as const, error: "boom" })),
    ).rejects.toThrow("boom");
  });
});

describe("maybe", () => {
  it("resolves to data on { ok: true }", async () => {
    const v = await maybe(Promise.resolve({ ok: true as const, data: "hi" }));
    expect(v).toBe("hi");
  });

  it("swallows errors and resolves to null on { ok: false }", async () => {
    const v = await maybe(Promise.resolve({ ok: false as const, error: "nope" }));
    expect(v).toBeNull();
  });
});
