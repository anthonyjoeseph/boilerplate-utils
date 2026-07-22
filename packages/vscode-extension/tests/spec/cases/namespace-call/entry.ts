// A namespace-qualified call `ns.f()` is a PropertyAccessExpression callee,
// not a bare Identifier, so it is rejected with "Only simple function
// identifiers" even though the target function is statically known.

namespace Utils {
  export const double = (x: number) => x * 2;
}

export const run = () => /*<*/ Utils.double(5) /*>*/;
