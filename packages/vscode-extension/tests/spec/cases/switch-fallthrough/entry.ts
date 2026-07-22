// Fall-through clauses (a case with no statements that drops into the next)
// are not supported by the switch collapse pass. The expansion is refused
// even when the discriminant is statically known.

const classify = (n: number) => {
  switch (n) {
    case 1:
    case 2:
      return "small";
    default:
      return "other";
  }
};

export const run = () => /*<*/ classify(1) /*>*/;
