const label = (n: number) => {
  switch (n) {
    case 1: return "one";
    case 2: return "two";
    default: return "other";
  }
};

const TWO = 2;

export const run = () => /*<*/ label(TWO) /*>*/;
