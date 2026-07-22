// `new F(args)` is a NewExpression, not a CallExpression. The call-finder
// returns null for it, so the expansion is refused with "No function call
// expression found at the selection."

class Box {
  constructor(public value: number) {}
}

export const run = () => { const b = /*<*/ new Box(5) /*>*/; return b.value; };
