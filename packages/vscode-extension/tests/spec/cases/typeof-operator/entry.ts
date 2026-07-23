// `typeof` on a literal value should fold to the string name of its type.

const typeofNum = (x: number) => typeof x;

export const run = () => /*<*/ typeofNum(42) /*>*/;
