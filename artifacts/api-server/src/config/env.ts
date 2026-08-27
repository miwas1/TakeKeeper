import { z } from "zod";

const isPgliteDatabase = process.env.DATABASE_URL?.startsWith("pglite") ?? false;

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DEFAULT_OBJECT_STORAGE_BUCKET_ID: z.string().min(1).optional(),
  PRIVATE_OBJECT_DIR: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  GOOGLE_CLOUD_LOCATION: z.string().min(1).default("us-central1"),
  AGENT_ENGINE_ID: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid server environment: ${parsed.error.message}`);
}

if (!isPgliteDatabase && (!parsed.data.DEFAULT_OBJECT_STORAGE_BUCKET_ID || !parsed.data.PRIVATE_OBJECT_DIR)) {
  throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID and PRIVATE_OBJECT_DIR are required when DATABASE_URL is not pglite");
}

export const env = parsed.data;

export const googleAgentReadiness = {
  model: env.GEMINI_MODEL,
  location: env.GOOGLE_CLOUD_LOCATION,
  cloudProjectConfigured: Boolean(env.GOOGLE_CLOUD_PROJECT),
  agentEngineConfigured: Boolean(env.AGENT_ENGINE_ID),
} as const;
