// Next.js dynamic-route syntax:
//   [param]       – single dynamic segment
//   [...slug]     – required catch-all  (one or more segments)
//   [[...slug]]   – optional catch-all  (zero or more segments)

// ── Type helpers ──────────────────────────────────────────────────────────────

type SegmentParam<Seg extends string> = Seg extends `[[...${string}]]`
  ? never
  : Seg extends `[...${string}]`
    ? never
    : Seg extends `[${infer P}]`
      ? P
      : never;

// Collect all [param] names from a path string
type PathParams<Path extends string> =
  Path extends `${infer Head}/${infer Tail}`
    ? SegmentParam<Head> | PathParams<Tail>
    : SegmentParam<Path>;

type CatchAllName<Path extends string> =
  Path extends `${string}[[...${infer P}]]${string}`
    ? P
    : Path extends `${string}[...${infer P}]${string}`
      ? P
      : never;

type IsOptionalCatchAll<Path extends string> =
  Path extends `${string}[[...${string}]]${string}` ? true : false;

type PathVariant<P extends string> = P extends string
  ? [CatchAllName<P>] extends [never]
    ? [PathParams<P>] extends [never]
      ? { path: P }
      : { path: P; params: Record<PathParams<P>, string> }
    : IsOptionalCatchAll<P> extends true
      ? [PathParams<P>] extends [never]
        ? { path: P; tail?: string[] }
        : { path: P; params: Record<PathParams<P>, string>; tail?: string[] }
      : [PathParams<P>] extends [never]
        ? { path: P; tail: string[] }
        : { path: P; params: Record<PathParams<P>, string>; tail: string[] }
  : never;

// ── Runtime ───────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface MatcherInfo {
  regex: RegExp;
  paramNames: string[];
  catchAllName: string | null;
  isOptional: boolean;
}

function buildMatcher(path: string): MatcherInfo {
  const parts = path.split("/");
  const segments = parts[0] === "" ? parts.slice(1) : parts;

  let regexStr = "";
  const paramNames: string[] = [];
  let catchAllName: string | null = null;
  let isOptional = false;

  for (const seg of segments) {
    if (seg === "") continue; // trailing slash in template
    if (seg.startsWith("[[...") && seg.endsWith("]]")) {
      const name = seg.slice(5, -2);
      catchAllName = name;
      isOptional = true;
      regexStr += `(?:/(?<${name}>.*))?`;
    } else if (seg.startsWith("[...") && seg.endsWith("]")) {
      const name = seg.slice(4, -1);
      catchAllName = name;
      regexStr += `/(?<${name}>.+)`;
    } else if (seg.startsWith("[") && seg.endsWith("]")) {
      const name = seg.slice(1, -1);
      paramNames.push(name);
      regexStr += `/(?<${name}>[^/]+)`;
    } else {
      regexStr += `/${escapeRegex(seg)}`;
    }
  }

  if (!catchAllName) {
    regexStr += "/?"; // trailing slash optional for static/param routes
  }

  return {
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
    catchAllName,
    isOptional
  };
}

function formatPath(
  template: string,
  params?: Record<string, string>,
  tail?: string[]
): string {
  const parts = template.split("/");
  const segments = parts[0] === "" ? parts.slice(1) : parts;
  const result: string[] = [""];

  for (const seg of segments) {
    if (seg === "") continue;
    if (seg.startsWith("[[...") && seg.endsWith("]]")) {
      if (tail && tail.length > 0) result.push(...tail);
    } else if (seg.startsWith("[...") && seg.endsWith("]")) {
      if (tail) result.push(...tail);
    } else if (seg.startsWith("[") && seg.endsWith("]")) {
      const name = seg.slice(1, -1);
      result.push(params?.[name] ?? "");
    } else {
      result.push(seg);
    }
  }

  return result.join("/");
}

// ── Public API ────────────────────────────────────────────────────────────────

export function pathCodec<Keys extends string[]>(...paths: Keys) {
  type Path = PathVariant<Keys[number] & string> | { path: "NotFound" };

  const matchers = paths.map((path) => ({ path, ...buildMatcher(path) }));

  function parse(url: string): Path {
    const pathname = url.split("?")[0] ?? url;
    for (const {
      path,
      regex,
      paramNames,
      catchAllName,
      isOptional
    } of matchers) {
      const match = pathname.match(regex);
      if (!match) continue;
      const groups = match.groups ?? {};

      const params: Record<string, string> = {};
      for (const name of paramNames) params[name] = groups[name] ?? "";
      const hasParams = paramNames.length > 0;

      if (catchAllName !== null) {
        const raw = groups[catchAllName];
        const tail =
          raw !== undefined && raw !== "" ? raw.split("/") : undefined;
        if (hasParams && tail !== undefined)
          return { path, params, tail } as Path;
        if (hasParams)
          return { path, params, ...(isOptional ? {} : { tail: [] }) } as Path;
        if (tail !== undefined) return { path, tail } as Path;
        return { path } as Path; // optional catch-all matched zero segments
      }

      if (hasParams) return { path, params } as Path;
      return { path } as Path;
    }
    return { path: "NotFound" } as Path;
  }

  function format(struct: Path): string {
    if (struct.path === "NotFound") return "/not-found";
    const params =
      "params" in struct
        ? (struct.params as Record<string, string>)
        : undefined;
    const tail =
      "tail" in struct ? (struct.tail as string[] | undefined) : undefined;
    return formatPath(struct.path, params, tail);
  }

  return { parse, format };
}
