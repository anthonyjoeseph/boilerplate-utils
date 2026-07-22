// ESM-style imports with a .js extension (pointing at a .ts source file) are
// never resolved. The resolver can't find the function and refuses.

import { add } from "./math.js";

export const run = () => /*<*/ add(3, 4) /*>*/;
