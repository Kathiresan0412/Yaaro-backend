import { createServer } from "node:http";
import { app } from "./app";
import { env } from "./config/env";
import { attachSocketServer } from "./socket";

const httpServer = createServer(app);

attachSocketServer(httpServer);

httpServer.listen(env.port, () => {
  console.log(`Yaro0 API running on port ${env.port}`);
});
