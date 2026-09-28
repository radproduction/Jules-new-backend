/**
 * Manual migration runner: `pnpm migrate` (requires MONGODB_URI).
 * The server also runs these migrations automatically on start-up; every
 * migration is recorded in `schema_migrations` and applied only once.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { runMigrations } from "../migrations";

runMigrations()
  .then(async () => {
    console.log("[migrations] up to date");
    await mongoose.disconnect();
  })
  .catch(async error => {
    console.error("[migrations] failed", error);
    await mongoose.disconnect();
    process.exit(1);
  });
