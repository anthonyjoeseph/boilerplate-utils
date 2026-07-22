import { dynamicPage } from "@boilerplate-utils/server";
import type { Props } from "./App.tsx";

interface JsonPlaceholderUser {
  name: string;
  email: string;
  company: { name: string };
}

export const GET = dynamicPage<{ userId: string }, Props>({
  loader: async ({ params }) => {
    const user = await fetch(
      `https://jsonplaceholder.typicode.com/users/${params.userId}`
    ).then((r) => r.json() as Promise<JsonPlaceholderUser>);
    return { name: user.name, email: user.email, company: user.company.name };
  },
  app: () => import("./App.entry.ts"),
  document: ({ App, data }) => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>{data.name}</title>
      </head>
      <body>
        <App />
      </body>
    </html>
  )
});
