import { useEffect, useState } from "react";
import type { StreamingPageProps } from "@boilerplate-utils/react";

// `type`, not `interface` — interfaces are open (mergeable) so TypeScript
// won't assume they lack extra, non-JSON-safe properties, and so treat them
// as never satisfying the JsonValue constraint below.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type Data = {
  startedAt: number;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type Chunk = {
  count: number;
  at: number;
};

export default function App({ data, stream }: StreamingPageProps<Data, Chunk>) {
  const [ticks, setTicks] = useState<Chunk[]>([]);

  useEffect(() => {
    const subscription = stream.subscribe((chunk) => {
      setTicks((prev) => [...prev, chunk]);
    });
    return () => subscription.unsubscribe();
  }, [stream]);

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 600, margin: "2rem auto" }}>
      <h1>Streaming ticker</h1>
      <p>
        Page rendered at <strong>{new Date(data.startedAt).toLocaleTimeString()}</strong>. Ten ticks
        stream in over the next ten seconds, one per second, each as its own inline{" "}
        <code>&lt;script&gt;</code> that pushes into an rxjs stream feeding this component.
      </p>
      <ul>
        {ticks.map((tick) => (
          <li key={tick.count}>
            tick {tick.count} — {new Date(tick.at).toLocaleTimeString()}
          </li>
        ))}
      </ul>
      {ticks.length === 10 ? <p>stream complete.</p> : null}
      <a href="/home">← back</a>
    </div>
  );
}
