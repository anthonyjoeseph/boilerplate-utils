const flag = false;

const pick = (f: boolean) => {
  if (f) {
    return 1;
  } else {
    return 2;
  }
};

export const run = () => /*<*/ pick(flag) /*>*/;
