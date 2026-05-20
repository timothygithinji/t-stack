import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@{{projectName}}/ui";

const mainStyle = { fontFamily: "system-ui", padding: "2rem" };

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main style={mainStyle}>
      <h1>{{projectName}}</h1>
      <p>Welcome to your t-stack monorepo, served from a Cloudflare Worker.</p>
      <Button onClick={() => alert("hello")}>Say hello</Button>
    </main>
  );
}
