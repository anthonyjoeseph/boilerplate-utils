import type { PushRouteProps } from "./routes";
import type { Column } from "@boilerplate-utils/template-fns";
import { Table } from "@boilerplate-utils/template-fns";

interface User {
  firstName: string;
  lastName: string;
  age: number;
  visits: number;
  status: string;
  progress: string;
}
const data: User[] = [
  {
    firstName: "Anthony",
    lastName: "Gabriele",
    age: 27,
    visits: 23,
    status: "waiting",
    progress: "humble"
  },
  {
    firstName: "Oleg",
    lastName: "Kiselyov",
    age: 30,
    visits: 5,
    status: "waiting",
    progress: "advanced"
  }
];
const columns: Column<User>[] = [
  {
    Header: "Name",
    columns: [
      { Header: "First Name", accessor: "firstName" },
      { Header: "Last Name", accessor: "lastName" }
    ]
  },
  {
    Header: "Info",
    columns: [
      { Header: "Age", accessor: "age" },
      { Header: "Visits", accessor: "visits" },
      { Header: "Status", accessor: "status" },
      { Header: "Profile Progress", accessor: "progress" }
    ]
  }
];

const Thing = Table({ data, columns });

export const AboutPage = ({ pushRoute }: PushRouteProps) => (
  <div>
    <h1>About</h1>
    <Thing />
    <button onClick={() => pushRoute({ path: "home" })}>Home</button>
  </div>
);
