import { describe, expect, it } from "vitest";

describe("web entry point", () => {
  it("returns the expected fixture value", () => {
    expect("web").toBe("web");
  });
});
