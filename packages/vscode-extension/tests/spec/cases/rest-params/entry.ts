// Functions with rest parameters are not supported and are refused immediately.

const sum = (...nums: number[]) => nums.reduce((a, b) => a + b, 0);

export const run = () => /*<*/ sum(1, 2, 3) /*>*/;
