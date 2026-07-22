/**
 * Globals injected into every spec fixture by the sandbox.
 * Declared here for editor support only - fixtures are transpiled, never
 * type-checked.
 */

/** Record that `label` was evaluated, and return `value` unchanged. */
declare function $<T>(label: string, value: T): T;

declare namespace $ {
  /** Record `label` together with a structural encoding of `value`. */
  function note(label: string, value: unknown): void;
}
