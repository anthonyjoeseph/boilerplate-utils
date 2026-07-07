import { z } from "zod";

const test = z.object({ a: z.email() });

test.shape;
