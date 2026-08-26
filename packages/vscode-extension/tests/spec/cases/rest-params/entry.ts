// A rest parameter binds to an array literal of the arguments it swallows,
// so the body's use of `nums` becomes `[1, 2, 3]`.

const sum = (...nums: number[]) => nums.reduce((a, b) => a + b, 0);

export const run = () => /*<*/ sum(1, 2, 3) /*>*/;
