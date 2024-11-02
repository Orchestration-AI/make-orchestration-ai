// @deno-types="npm:@types/express@5.0.0"
import express from "express";
import process from "node:process";
import { contextMiddleware } from "./context.middleware.ts";
import { messagingRouter } from "./messages/messaging.router.ts";
import { voiceRouter } from "./voice/voice.router.ts";
import { Server } from "socket.io";
import { createServer } from "node:http";
import { addSocket } from "./voice/voice.service.ts";
import { sqlServerRouter } from "./sql-server/sql-server.router.ts";

const PORT = process.env.PORT || 3001;

function main() {
  const app = express();
  const server = createServer(app);

  app.use(contextMiddleware);
  app.use(express.json());

  app.get("/services", (_req, res) => {
    res.status(200).json([
      {
        unique_name: "messaging",
        service_name: "OAI Messaging",
        service_description: "Inter agent communication.",
      },
      {
        unique_name: "voice",
        service_name: "OAI Voice",
        service_description: "Voice communication with the user.",
      },
      {
        unique_name: "sql-server",
        service_name: "OAI Sql Server",
        service_description: "Run queries on a SQL Server database.",
      },      
    ]);
  });

  app.use("/services/messaging", messagingRouter);
  app.use("/services/voice", voiceRouter);
  app.use("/services/sql-server", sqlServerRouter);

  app.use("/services/voice/chat", express.static("./voice/public"));

  const voiceIo = new Server(server, {
    path: "/hooks/voice-io",
  });
  voiceIo.on("connection", addSocket);

  server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

if (import.meta.main) {
  main();
} else {
  // Module not being run as main, so no need to start server.
}
