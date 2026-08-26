// A spread argument that lands in the rest parameter stays a spread element
// inside the array literal, which reproduces the rest array exactly - including
// its length, which no positional mapping could have known.

const count = (...nums: number[]) => nums.length;

const xs = [1, 2, 3];

export const run = () => /*<*/ count(...xs, 9) /*>*/;
