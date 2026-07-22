// Passing `undefined` explicitly should trigger the parameter's default value
// (JavaScript semantics). The inliner instead uses the argument node as-is,
// so the default is skipped and the body evaluates with undefined.

const withDefault = (a = 5) => a * 2;

export const run = () => /*<*/ withDefault(undefined) /*>*/;
