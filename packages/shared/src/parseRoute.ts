import {
  Route,
  parse as fpParse,
  format as fpFormat,
  end,
  lit,
  str,
  zero,
  Parser,
  Formatter,
  Match,
} from "fp-ts-routing";
import * as O from "fp-ts/Option";
import { identity, tuple } from "fp-ts/function";

// https://davidtimms.github.io/programming-languages/typescript/2020/11/20/exploring-template-literal-types-in-typescript-4.1.html
type PathParams<Path extends string> =
  Path extends `:${infer Param}/${infer Rest}`
    ? Param | PathParams<Rest>
    : Path extends `:${infer Param}`
      ? Param
      : Path extends `${infer _Prefix}:${infer Rest}`
        ? PathParams<`:${Rest}`>
        : never;

type GreedyParams<Path extends string> = Path extends `*`
  ? "tail"
  : Path extends `*/`
    ? "tail"
    : Path extends `${infer _}/*`
      ? "tail"
      : Path extends `${infer _}/*/`
        ? "tail"
        : never;

const greedy: Match<{ tail: string }> = new Match(
  new Parser((r) =>
    O.some(tuple({ tail: r.parts.join("/") }, new Route([], r.query))),
  ),
  new Formatter(
    (r, o) => new Route([...r.parts, ...o.tail.split("/")], r.query),
  ),
);
const neverMatch: Match<{}> = new Match(
  new Parser(() => O.none),
  new Formatter(identity),
);

export function pathCodec<Keys extends string[]>(...paths: Keys) {
  type Path =
    | {
        [K in keyof Keys]: PathParams<Keys[K]> extends never
          ? GreedyParams<Keys[K]> extends never
            ? { path: Keys[K] }
            : { path: Keys[K]; tail: string }
          : GreedyParams<Keys[K]> extends never
            ? {
                path: Keys[K];
                params: {
                  [Param in PathParams<Keys[K]>]: string;
                };
              }
            : {
                path: Keys[K];
                params: {
                  [Param in PathParams<Keys[K]>]: string;
                };
                tail: string;
              };
      }[number]
    | {
        path: "NotFound";
      };
  const matches = paths.map((path) => {
    const greedyPath = path.endsWith("/*")
      ? "/*"
      : path.endsWith("/*/")
        ? "/*/"
        : path === "*"
          ? "*"
          : path === "*/"
            ? "*/"
            : undefined;
    if (!greedyPath && path.includes("*")) return [path, neverMatch] as const;
    const rawSegments = greedyPath
      ? path.replace(greedyPath, "").split("/")
      : path.split("/");
    const segments = rawSegments[0] === "" ? rawSegments.slice(1) : rawSegments;
    const fullMatch = segments.reduce(
      (match, segment) =>
        segment.startsWith(":")
          ? match.then(str(segment.slice(1)))
          : match.then(lit(segment)),
      lit("/"),
    );
    const withGreedy = greedyPath ? fullMatch.then(greedy) : fullMatch;
    return [path, withGreedy.then(end)] as const;
  });
  const parser = matches.reduce(
    (acc, [path, cur]) =>
      acc.alt(
        cur.parser.map((params) =>
          Object.keys(params).length > 0
            ? "tail" in params
              ? {
                  path,
                  params,
                  tail: params["tail"],
                }
              : {
                  path,
                  params,
                }
            : "tail" in params
              ? { path, tail: params["tail"] }
              : { path },
        ) as Parser<Path>,
      ),
    zero<Path>(),
  );
  return {
    parse: (string: string): Path =>
      fpParse(parser, Route.parse(string), {
        path: "NotFound",
      } as Path) as Path,

    format: (struct: Path): string =>
      "tail" in struct
        ? fpFormat(
            (matches.find(([key]) => struct.path === key)?.[1]
              ?.formatter as Formatter<{ tail: string }>) ?? end.formatter,
            struct,
          )
        : fpFormat(
            (matches.find(([key]) => struct.path === key)?.[1]
              ?.formatter as Formatter<{}>) ?? end.formatter,
            struct,
          ),
  };
}

const { parse, format } = pathCodec(
  "/one/:var/two/:var2/",
  "/one/:var/two/:var2/*",
  "/two/",
  "/two/*",
);
type Path = ReturnType<typeof parse>;
