import { describe, it, expect } from "vitest";
import { pathCodec } from "../src/parseRoute.js";

const { parse, format } = pathCodec(
  "/one/[var]/two/[var2]/",
  "/one/[var]/two/[var2]/[...tail]",
  "/two/",
  "/two/[...tail]",
  "/optional/[[...tail]]"
);

// ── parse ─────────────────────────────────────────────────────────────────────

describe("parse – static routes", () => {
  it("matches exact path", () => {
    expect(parse("/two/")).toEqual({ path: "/two/" });
  });

  it("matches without trailing slash", () => {
    expect(parse("/two")).toEqual({ path: "/two/" });
  });

  it("returns NotFound for unknown path", () => {
    expect(parse("/unknown")).toEqual({ path: "NotFound" });
  });
});

describe("parse – dynamic params", () => {
  it("extracts named params", () => {
    expect(parse("/one/hello/two/world/")).toEqual({
      path: "/one/[var]/two/[var2]/",
      params: { var: "hello", var2: "world" }
    });
  });

  it("matches without trailing slash", () => {
    expect(parse("/one/hello/two/world")).toEqual({
      path: "/one/[var]/two/[var2]/",
      params: { var: "hello", var2: "world" }
    });
  });

  it("does not match too few segments", () => {
    expect(parse("/one/hello/two/")).toEqual({ path: "NotFound" });
  });
});

describe("parse – required catch-all ([...slug])", () => {
  it("matches single trailing segment", () => {
    expect(parse("/two/a")).toEqual({ path: "/two/[...tail]", tail: ["a"] });
  });

  it("matches multiple trailing segments", () => {
    expect(parse("/two/a/b/c")).toEqual({
      path: "/two/[...tail]",
      tail: ["a", "b", "c"]
    });
  });

  it("does not match with no trailing segments", () => {
    // /two/ should match the static route, not the catch-all
    expect(parse("/two/")).toEqual({ path: "/two/" });
  });

  it("mixed params + catch-all", () => {
    expect(parse("/one/foo/two/bar/x/y")).toEqual({
      path: "/one/[var]/two/[var2]/[...tail]",
      params: { var: "foo", var2: "bar" },
      tail: ["x", "y"]
    });
  });
});

describe("parse – optional catch-all ([[...slug]])", () => {
  it("matches with no extra segments", () => {
    expect(parse("/optional")).toEqual({ path: "/optional/[[...tail]]" });
  });

  it("matches with trailing slash and no segments", () => {
    expect(parse("/optional/")).toEqual({ path: "/optional/[[...tail]]" });
  });

  it("matches one segment", () => {
    expect(parse("/optional/a")).toEqual({
      path: "/optional/[[...tail]]",
      tail: ["a"]
    });
  });

  it("matches multiple segments", () => {
    expect(parse("/optional/a/b/c")).toEqual({
      path: "/optional/[[...tail]]",
      tail: ["a", "b", "c"]
    });
  });
});

describe("parse – query strings are ignored", () => {
  it("strips query string before matching", () => {
    expect(parse("/two/?foo=bar")).toEqual({ path: "/two/" });
    expect(parse("/two/a?foo=bar")).toEqual({
      path: "/two/[...tail]",
      tail: ["a"]
    });
  });
});

// ── format ────────────────────────────────────────────────────────────────────

describe("format – static routes", () => {
  it("returns the path as-is", () => {
    expect(format({ path: "/two/" })).toBe("/two");
  });
});

describe("format – dynamic params", () => {
  it("interpolates params", () => {
    expect(
      format({
        path: "/one/[var]/two/[var2]/",
        params: { var: "a", var2: "b" }
      })
    ).toBe("/one/a/two/b");
  });
});

describe("format – required catch-all", () => {
  it("appends tail segments", () => {
    expect(format({ path: "/two/[...tail]", tail: ["x", "y"] })).toBe(
      "/two/x/y"
    );
  });

  it("appends tail with params", () => {
    expect(
      format({
        path: "/one/[var]/two/[var2]/[...tail]",
        params: { var: "a", var2: "b" },
        tail: ["x", "y"]
      })
    ).toBe("/one/a/two/b/x/y");
  });
});

describe("format – optional catch-all", () => {
  it("omits tail when not provided", () => {
    expect(format({ path: "/optional/[[...tail]]" })).toBe("/optional");
  });

  it("omits tail when empty array", () => {
    expect(format({ path: "/optional/[[...tail]]", tail: [] })).toBe(
      "/optional"
    );
  });

  it("appends tail segments when provided", () => {
    expect(format({ path: "/optional/[[...tail]]", tail: ["a", "b"] })).toBe(
      "/optional/a/b"
    );
  });
});

describe("format – NotFound", () => {
  it("returns /not-found", () => {
    expect(format({ path: "NotFound" })).toBe("/not-found");
  });
});

// ── parse → format roundtrip ──────────────────────────────────────────────────

describe("parse → format roundtrip", () => {
  const cases = [
    "/two",
    "/two/a",
    "/two/a/b/c",
    "/one/foo/two/bar",
    "/one/foo/two/bar/x/y",
    "/optional",
    "/optional/a/b"
  ];

  for (const url of cases) {
    it(`roundtrips ${url}`, () => {
      const parsed = parse(url);
      const formatted = format(parsed);
      expect(parse(formatted)).toEqual(parsed);
    });
  }
});
