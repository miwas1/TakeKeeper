import { defineConfig } from "drizzle-kit";
import { mkdirSync } from "node:fs";
import path from "path";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const isPglite = databaseUrl.startsWith("pglite");
const pgliteDataDir = databaseUrl.replace(/^pglite:\/\//, "").replace(/^pglite:/, "") || "./.takekeeper/pglite";
if (isPglite && !/^(memory|idb|opfs-ahp):\/\//.test(pgliteDataDir)) {
  mkdirSync(path.dirname(path.resolve(pgliteDataDir.replace(/^file:\/\//, ""))), { recursive: true });
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  ...(isPglite
    ? { driver: "pglite" as const, dbCredentials: { url: pgliteDataDir } }
    : { dbCredentials: { url: databaseUrl } }),
});
