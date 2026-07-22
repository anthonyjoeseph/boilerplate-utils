// The argument identifier `y` (=100) shares a name with the inner arrow's
// parameter `y`. When `x` is substituted with the argument `y`, the inner
// arrow captures `y` from its own binding instead of from the caller scope.

const shift = (x: number) => [1, 2].map((y) => y + x);
const y = 100;

export const run = () => /*<*/ shift(y) /*>*/;
