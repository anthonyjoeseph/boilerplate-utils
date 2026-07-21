type HasProp<A, Prop extends string> = A extends readonly (infer E)[]
  ? HasProp<E, Prop>
  : A extends (...args: never[]) => unknown
    ? false
    : A extends object
      ? Prop extends keyof A
        ? true
        : true extends { [K in keyof A]: HasProp<A[K], Prop> }[keyof A]
          ? true
          : false
      : false;

export type DeepExtract<A, Prop extends string> = A extends readonly (infer E)[]
  ? DeepExtract<E, Prop>[]
  : A extends object
    ? {
        [
          K in keyof A as K extends Prop
            ? K
            : HasProp<A[K], Prop> extends true
              ? K
              : never
        ]: K extends Prop ? A[K] : DeepExtract<A[K], Prop>;
      }
    : never;

export const deepExtract = <A, const Prop extends string>(
  struct: A,
  prop: Prop
): DeepExtract<A, Prop> => {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        if (key === prop) {
          out[key] = value;
        } else if (value !== null && typeof value === "object") {
          const sub = walk(value);
          const keep = Array.isArray(sub)
            ? true
            : Object.keys(sub as object).length > 0;
          if (keep) out[key] = sub;
        }
      }
      return out;
    }
    return node;
  };
  return walk(struct) as DeepExtract<A, Prop>;
};
/* 

// Recursively replace `Prop: () => T` with `Prop: T`
type CallRefs<A, Prop extends string> = A extends readonly (infer E)[]
  ? CallRefs<E, Prop>[]
  : A extends object
    ? {
        [K in keyof A]: K extends Prop
          ? A[K] extends (...args: never[]) => infer R
            ? R
            : A[K]
          : CallRefs<A[K], Prop>;
      }
    : A;

export const extractFn = <A, const Prop extends string>(
  struct: A,
  prop: Prop
): (() => CallRefs<DeepExtract<A, Prop>, Prop>) => {
  const extracted = extract(struct, prop);

  const callRefs = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(callRefs);
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        out[key] =
          key === prop && typeof value === "function"
            ? value()
            : callRefs(value);
      }
      return out;
    }
    return node;
  };

  return (() => callRefs(extracted)) as () => CallRefs<
    DeepExtract<A, Prop>,
    Prop
  >;
}; */
