// `type`, not `interface` — see the comment in routes/ticker/App.tsx.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type Props = {
  name: string;
  email: string;
  company: string;
};

export default function App({ name, email, company }: Props) {
  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 600, margin: "2rem auto" }}>
      <h1>{name}</h1>
      <p>
        <strong>Email:</strong> {email}
      </p>
      <p>
        <strong>Company:</strong> {company}
      </p>
      <a href="/home">← back</a>
    </div>
  );
}
