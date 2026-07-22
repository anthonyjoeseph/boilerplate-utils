import { addTwo } from "./math";

// `printNode` is given the callee's SourceFile but `finalExpr` contains
// caller-owned argument nodes. Printing caller nodes against the callee's
// SourceFile produces wrong or garbled output.

const x = 10;

export const run = () => /*<*/ addTwo(x + 1) /*>*/;
