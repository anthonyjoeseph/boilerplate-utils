import { primitive } from "@boilerplate-utils/react";

const MyButton = primitive("button");

export const App = () => (
  <div>
    click me:{" "}
    <MyButton onClick={() => alert("it works!")}>popup alert</MyButton>
  </div>
);
