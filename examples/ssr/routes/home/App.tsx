export default function App() {
  return (
    <div
      style={{ fontFamily: "sans-serif", maxWidth: 600, margin: "2rem auto" }}
    >
      <h1>SSR Example</h1>
      <p>
        This page was pre-rendered at build time. Pick a user to see server-side
        rendering with a loader:
      </p>
      <ul>
        {[1, 2, 3].map((id) => (
          <li key={id}>
            <a href={`/user/${id}`}>User {id}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
