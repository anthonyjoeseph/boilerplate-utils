// A spread argument that lands on ordinary parameters hides how many values it
// carries, so no positional binding is knowable and the expansion is refused.

const add = (a: number, b: number) => a + b;

const xs: [number, number] = [1, 2];

export const run = () => /*<*/ add(...xs) /*>*/;
