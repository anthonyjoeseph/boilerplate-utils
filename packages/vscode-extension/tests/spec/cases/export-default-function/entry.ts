// export default function declarations are not found by the same-file
// resolver, so calling such a function is refused with "Could not resolve".

export default function double(x: number) {
  return x * 2;
}

export const run = () => /*<*/ double(5) /*>*/;
