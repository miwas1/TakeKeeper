import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const usesPglite = databaseUrl.startsWith("pglite");

export function getPgliteDataDir(url: string): string {
  const dataDir = url.replace(/^pglite:\/\//, "").replace(/^pglite:/, "");
  return dataDir || "./.takekeeper/pglite";
}

function ensurePgliteParent(dataDir: string) {
  if (/^(memory|idb|opfs-ahp):\/\//.test(dataDir)) return;
  const filesystemPath = dataDir.replace(/^file:\/\//, "");
  mkdirSync(path.dirname(path.resolve(filesystemPath)), { recursive: true });
}

const pgliteDataDir = getPgliteDataDir(databaseUrl);
if (usesPglite) ensurePgliteParent(pgliteDataDir);

export const pglite = usesPglite ? new PGlite(pgliteDataDir) : null;
export const pool = usesPglite ? null : new Pool({ connectionString: databaseUrl });
export const db: NodePgDatabase<typeof schema> = (usesPglite
  ? drizzlePglite(pglite!, { schema })
  : drizzlePostgres(pool!, { schema })) as unknown as NodePgDatabase<typeof schema>;

export * from "./schema";
