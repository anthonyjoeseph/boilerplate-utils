import { ClientRouter } from "@boilerplate-utils/react";
import { AboutPage } from "./AboutPage";
import { HomePage } from "./HomePage";
import { NotFoundPage } from "./NotFoundPage";
import { parse, format } from "./routes";
import { SignupPage } from "./SignupPage";
import { UserPage } from "./UserPage";

export const App = ({ initialPath }: { initialPath: string }) => (
  <ClientRouter
    parse={parse}
    format={format}
    initialPath={initialPath}
    routes={{
      home: HomePage,
      about: AboutPage,
      signup: SignupPage,
      "user/[userId]": UserPage,
      NotFound: NotFoundPage
    }}
  />
);
