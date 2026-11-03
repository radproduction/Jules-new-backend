import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import fs from "fs";
import { connectDb, diskFilePath, ensureAdminUser, getFile } from "../db";
import { runMigrations } from "../migrations";
import { ENV } from "./env";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  await connectDb();
  await ensureAdminUser();
  await runMigrations();
  if (ENV.uploadDir) {
    fs.mkdirSync(ENV.uploadDir, { recursive: true });
    console.log(`[files] storing uploaded images on disk in ${ENV.uploadDir}`);
  } else {
    console.warn("[files] UPLOAD_DIR is not set: images are stored in MongoDB. Set it to a Railway volume path for product images.");
  }

  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Uploaded images stored in MongoDB (see storage.ts → storeImage)
  app.get("/api/files/:id", async (req, res) => {
    try {
      const id = String(req.params.id);
      const diskPath = diskFilePath(id);
      if (diskPath && fs.existsSync(diskPath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.sendFile(diskPath);
        return;
      }
      const file = await getFile(id);
      if (!file) {
        res.status(404).send("Not found");
        return;
      }
      res.setHeader("Content-Type", file.contentType as string);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(Buffer.from((file.data as any).buffer ?? file.data));
    } catch (error) {
      console.error("[files] failed to serve file", error);
      res.status(500).send("Error");
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Only serve the client when explicitly enabled.
  const serveClient = process.env.SERVE_CLIENT === "true";
  if (serveClient) {
    // development mode uses Vite, production mode uses static files
    if (process.env.NODE_ENV === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(error => {
  console.error("[startup] failed to start server", error);
  process.exit(1);
});
