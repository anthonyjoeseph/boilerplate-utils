// An optional call `f?.()` has questionDotToken on the call itself. The
// inliner drops the `?.`, turning `f?.()` into the inlined body directly.
// For a non-nullable function this is behaviorally equivalent; the spec
// guards against future regressions where the optional chain is dropped.

const greet = () => "hello";

export const run = () => /*<*/ greet?.() /*>*/;
