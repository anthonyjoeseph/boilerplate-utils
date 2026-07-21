import { input, z } from "zod";
import { a, c, e, n, o, p, u, narrowFn } from "./nester.js";
import type React from "react";

export const Input = ({ ref }: { ref: React.Ref<HTMLInputElement> }) => (
  <input ref={ref} />
);

const testZod = z.object({
  name: z.string(),
  employee: z.object({ address: z.string() }),
  allergies: z.array(z.string())
});

export const Test = ({
  name,
  employee,
  allergies
}: {
  name: { ref: React.Ref<HTMLInputElement> };
  employee: { address: { ref: React.Ref<HTMLInputElement> } };
  allergies: { ref: React.Ref<HTMLInputElement> }[];
}) => {
  return (
    <div>
      <Input ref={name.ref} />
      <div>
        <Input ref={employee.address.ref} />
      </div>
      {allergies.map(({ ref }) => (
        <Input ref={ref} />
      ))}
    </div>
  );
};
