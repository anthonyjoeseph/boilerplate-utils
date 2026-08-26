// With no arguments left for it, the rest parameter binds to an empty array
// rather than to `undefined`.

const count = (...nums: number[]) => nums.length;

export const run = () => /*<*/ count() /*>*/;
