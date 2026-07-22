import type React from "react";

export const Input = ({ ref }: { ref: React.Ref<HTMLInputElement> }) => (
  <input ref={ref} />
);

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
