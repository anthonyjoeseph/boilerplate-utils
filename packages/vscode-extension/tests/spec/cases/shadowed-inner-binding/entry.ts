// The inner arrow declares its own `a`, which shadows the parameter. Blind
// name substitution rewrites the inner references anyway.

const scale = (a: number) => [1, 2].map((a) => a * 10);

export const run = () => /*<*/ scale(7) /*>*/;
