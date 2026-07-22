/**
 * Anything `JSON.stringify`/`JSON.parse` round-trips losslessly. Used to
 * constrain data that crosses the server/client boundary as serialized text
 * (`PageData`, page-stream `Chunk`s) — a `Date`, class instance, or function
 * would typecheck as a plain object/no-op but arrive on the other side as
 * something else entirely (a string, `{}`, or nothing at all).
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };
