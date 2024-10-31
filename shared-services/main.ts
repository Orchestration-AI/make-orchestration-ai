// @deno-types="npm:@types/express@5.0.0"
import express from "express";
import process from "node:process";
import { contextMiddleware } from "./context.middleware.ts";
import { messagingRouter } from "./messages/messaging.router.ts";

const PORT = process.env.PORT || 3001;

function main() {
  const app = express();

  app.use(contextMiddleware);
  app.use(express.json());

  app.get("/services", (_req, res) => {
    res.status(200).json([
      {
        unique_name: "messaging",
        service_name: "OAI Messaging",
        service_description: "Inter agent communication."
      },
    ]);
  });

  app.use("/services/messaging", messagingRouter);

  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

if (import.meta.main) {
  main();
} else {
  // Module not being run as main, so no need to start server.
}
