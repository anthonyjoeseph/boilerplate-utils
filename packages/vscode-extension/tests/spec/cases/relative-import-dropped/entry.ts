// `addBump` closes over `BUMP`, which reaches it through a relative import.
// Relative imports are skipped when carrying imports over, so the expanded
// expression references a name that does not exist at the call site.

import { addBump } from "./callee";

export const run = () => /*<*/ addBump(1) /*>*/;
