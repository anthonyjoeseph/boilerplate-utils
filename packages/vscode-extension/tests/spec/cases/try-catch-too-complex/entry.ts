// A function whose body contains a try/catch is refused as "too complex".

const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export const run = () => /*<*/ safeJson("42") /*>*/;
