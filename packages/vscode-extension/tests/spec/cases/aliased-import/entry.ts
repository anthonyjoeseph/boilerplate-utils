import { addTwo as add } from "./math";

// `findImportForIdentifier` computes the real imported name but then discards
// it, so it searches the target file for `add` rather than `addTwo`.

export const run = () => /*<*/ add(3) /*>*/;
