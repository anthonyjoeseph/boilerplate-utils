// `one` declares no parameters, so the binding loop never walks the call's
// arguments and the side-effecting argument is deleted outright.

const one = () => 1;

export const run = () => /*<*/ one($("side-effect", 42)) /*>*/;
