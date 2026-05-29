import http from "node:http";
import fs from "node:fs/promises";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { createHttpApp } from "./http.js";
import { attachWebSocket } from "./ws.js";
import { manager } from "./server-manager.js";
import { watchDockerEvents } from "./events.js";
import { startSftp } from "./sftp.js";

async function main() {
  // ensure data dirs exist
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.mkdir(config.backupDir, { recursive: true });

  await manager.init();

  const app = createHttpApp();
  const server = http.createServer(app);
  attachWebSocket(server);

  // best-effort: docker may be unavailable on dev machines (e.g. Windows w/o Docker)
  watchDockerEvents().catch((e) => logger.error({ e }, "docker events watcher failed to start"));
  startSftp().catch((e) => logger.error({ e }, "sftp server failed to start"));

  server.listen(config.port, () => {
    logger.info(
      { port: config.port, dataDir: config.dataDir, dockerSocket: config.dockerSocket },
      "🛰️  Aether daemon online",
    );
  });

  const shutdown = (sig: string) => {
    logger.info({ sig }, "shutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  logger.error({ e }, "daemon failed to start");
  process.exit(1);
});
