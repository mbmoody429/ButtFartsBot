import express from "express";

// # Start the real app
try {
  // Production loads private token persistence here before the server.
  await import("./server.js");
} catch (error) {
  console.error("ButtFartsBot startup failed:", error);

  // # Failed-startup fallback
  const app = express();
  const port = process.env.PORT || 3000;

  app.get("/health", (_, res) => res.status(503).send("unhealthy"));
  app.use((_, res) => res.status(503).send("Service unavailable"));

  app.listen(port, "0.0.0.0", () => {
    console.log(`ButtFartsBot failed-startup listener on ${port}`);
  });
}
