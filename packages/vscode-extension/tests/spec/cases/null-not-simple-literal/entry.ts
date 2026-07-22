// `null` is not recognized as a simple literal by the switch collapse pass,
// so a switch discriminant or case value of null causes the expansion to be
// refused even when the match is static.

const classify = (x: string | null) => {
  switch (x) {
    case null:
      return "null";
    default:
      return "other";
  }
};

export const run = () => /*<*/ classify(null) /*>*/;
