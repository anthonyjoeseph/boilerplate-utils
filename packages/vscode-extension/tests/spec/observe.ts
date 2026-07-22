/**
 * Observation layer for behavioral specs.
 *
 * A spec proves that expanding a call did not change what the program *does*.
 * "What the program does" is captured as two things:
 *
 *   1. an effect trace  - which labelled expressions were evaluated, in what
 *                         order, how many times
 *   2. a result encoding - a structural rendering of the value the program
 *                         produced (or the error it threw)
 *
 * Both are strings, so comparing them is exact and diffing them is readable.
 *
 * The encoder deliberately distinguishes everything a naive deep-equal misses:
 * `-0` vs `0`, `NaN`, `undefined` vs an absent key, sparse array holes, key
 * insertion order, bigints, and - most importantly - *reference sharing*.
 * Sharing is what catches an expansion that replaced a reference with a fresh
 * literal: `{ a: xs, b: xs }` encodes as `#1[...]` then `#1`, whereas
 * `{ a: [1,2], b: [1,2] }` encodes as two distinct objects.
 *
 * Everything here must be cross-realm safe, because the program under test runs
 * inside a `vm` context with its own intrinsics. That means no `instanceof` -
 * dispatch on `Object.prototype.toString` instead.
 */

/** A single recorded observation, already rendered to a comparable string. */
export type Effect = string;

export interface Recorder {
  /** Record that `label` was evaluated, and return `value` unchanged. */
  <T>(label: string, value: T): T;
  /** Record `label` together with a structural encoding of `value`. */
  note(label: string, value: unknown): void;
  /** The trace, in evaluation order. */
  readonly effects: readonly Effect[];
}

/**
 * The recorder is the one deliberately stateful object in the harness - an
 * effect trace is an ordered log, and ordering is the whole point. State is
 * confined to this closure and a fresh recorder is built for every run.
 */
export const createRecorder = (): Recorder => {
  const effects: Effect[] = [];

  const record = <T>(label: string, value: T): T => {
    effects.push(`eval ${label}`);
    return value;
  };

  record.note = (label: string, value: unknown): void => {
    effects.push(`note ${label} = ${encode(value)}`);
  };

  Object.defineProperty(record, "effects", { get: () => effects });

  return record as Recorder;
};

const tagOf = (value: object): string => {
  const raw = Object.prototype.toString.call(value);
  return raw.slice(8, -1);
};

const encodeNumber = (value: number): string => {
  if (Number.isNaN(value)) return "NaN";
  if (Object.is(value, -0)) return "-0";
  return String(value);
};

const encodeKey = (key: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);

/**
 * Render `value` as a canonical string.
 *
 * Object identity is encoded positionally: the first time an object is reached
 * it is emitted as `#n<body>`, and every later reach emits the bare `#n`. This
 * captures cycles and reference sharing in one mechanism, and it compares
 * meaningfully across two separate runs because the ids are assigned in
 * traversal order rather than being addresses.
 */
export const encode = (value: unknown): string =>
  encodeAt(value, new Map<object, number>());

const encodeAt = (value: unknown, seen: Map<object, number>): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  switch (typeof value) {
    case "boolean":
      return String(value);
    case "number":
      return encodeNumber(value);
    case "bigint":
      return `${value}n`;
    case "string":
      return JSON.stringify(value);
    case "symbol":
      return `Symbol(${String((value as symbol).description ?? "")})`;
    case "function": {
      const fn = value as (...args: never[]) => unknown;
      return `[fn ${fn.name || "anonymous"}/${fn.length}]`;
    }
  }

  const object = value as object;
  const existing = seen.get(object);
  if (existing !== undefined) return `#${existing}`;

  const id = seen.size + 1;
  seen.set(object, id);
  return `#${id}${encodeBody(object, seen)}`;
};

const encodeBody = (object: object, seen: Map<object, number>): string => {
  const tag = tagOf(object);

  if (Array.isArray(object)) {
    const array = object as unknown[];
    const items = Array.from({ length: array.length }, (_, i) =>
      Object.prototype.hasOwnProperty.call(array, i)
        ? encodeAt(array[i], seen)
        : "<hole>"
    );
    const extra = Object.keys(array)
      .filter((k) => !/^\d+$/.test(k))
      .map((k) => `${encodeKey(k)}:${encodeAt(indexOf(array, k), seen)}`);
    return `[${[...items, ...extra].join(",")}]`;
  }

  switch (tag) {
    case "Date": {
      const time = (object as Date).getTime();
      return ` Date(${Number.isNaN(time) ? "Invalid" : new Date(time).toISOString()})`;
    }
    case "RegExp": {
      const re = object as RegExp;
      return ` /${re.source}/${re.flags}`;
    }
    case "Error": {
      const err = object as Error;
      return ` Error(${err.name}: ${err.message})`;
    }
    case "Promise":
      // A promise's settled value is not observable synchronously; the spec
      // runner awaits the top-level result, so a nested promise is opaque.
      return " Promise";
    case "Map": {
      const entries = Array.from(
        (object as Map<unknown, unknown>).entries(),
        ([k, v]) => `${encodeAt(k, seen)}=>${encodeAt(v, seen)}`
      );
      return ` Map{${entries.join(",")}}`;
    }
    case "Set": {
      const items = Array.from((object as Set<unknown>).values(), (v) =>
        encodeAt(v, seen)
      );
      return ` Set{${items.join(",")}}`;
    }
  }

  const ctor = constructorNameOf(object);
  const prefix = ctor && ctor !== "Object" ? `${ctor}` : "";
  // Own enumerable string keys, in insertion order. Getters are invoked - if a
  // getter has an effect, the recorder will see it, which is the correct
  // outcome for a behavioral spec.
  const fields = Object.keys(object).map(
    (k) => `${encodeKey(k)}:${encodeAt(indexOf(object, k), seen)}`
  );
  return `${prefix}{${fields.join(",")}}`;
};

const indexOf = (object: object, key: string): unknown =>
  (object as Record<string, unknown>)[key];

const constructorNameOf = (object: object): string | undefined => {
  const proto = Object.getPrototypeOf(object) as { constructor?: unknown } | null;
  if (proto === null) return "NullProto";
  const ctor = proto.constructor;
  return typeof ctor === "function" ? (ctor as { name: string }).name : undefined;
};
