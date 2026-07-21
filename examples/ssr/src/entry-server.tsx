import { renderToString } from "react-dom/server";
import { App } from "./App";

export const render = async (_url: string) => {
  const data = await fetch("https://jsonplaceholder.typicode.com/todos/1").then(
    (response) => response.json() as Promise<unknown>
  );
  const html = renderToString(<App />);
  return { html, data };
};
