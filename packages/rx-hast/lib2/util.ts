export type HasKeys<A> = keyof A extends never ? false : true;

export type NonEmptyArray<A> = [A, ...A[]];

export type ShallowAnd<A, B> = {
  [K in keyof A | keyof B]: K extends keyof B
    ? K extends keyof A
      ? `ERROR: conflict on key '${Extract<K, string>}'`
      : B[K]
    : K extends keyof A
      ? A[K]
      : never;
};

// built on the idea that `[number | string] extends [number]` is false
// returns `true` for boolean, `false` for string
type IsUnion<A> = [A] extends infer B
  ? B extends [infer C]
    ? C extends any
      ? [A] extends [C]
        ? false
        : true
      : never
    : never
  : never;

// this results in &, which is slow
export type UnionToIntersection<T> = (T extends any ? (x: T) => any : never) extends (x: infer R) => any ? R : never;

// DisjunctsWithKey<{ a: string } | { b: number }, 'a'> = { a: string }
type DisjunctsWithKey<A, K> = A extends any ? (K extends keyof A ? A : never) : never;

export type ShallowUnionToIntersection<A extends Record<string, unknown>> = {
  [K in A extends any ? keyof A : never]: IsUnion<DisjunctsWithKey<A, K>> extends true
    ? `ERROR: Multiple Children with key '${Extract<K, string>}'`
    : DisjunctsWithKey<A, K>[K];
};
