// An `as const` assertion in the function body must survive inlining so the
// caller gets the narrowed readonly tuple/object type it expects.

const getConfig = () => ({ theme: "dark" } as const);

export const run = () => /*<*/ getConfig() /*>*/;
