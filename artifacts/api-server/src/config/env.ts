import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DEFAULT_OBJECT_STORAGE_BUCKET_ID: z.string().min(1),
  PRIVATE_OBJECT_DIR: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  GOOGLE_CLOUD_LOCATION: z.string().min(1).default("us-central1"),
  AGENT_ENGINE_ID: z.string().min(1).optional(),
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid server environment: ${parsed.error.message}`);
}

export const env = parsed.data;

export const googleAgentReadiness = {
  model: env.GEMINI_MODEL,
  location: env.GOOGLE_CLOUD_LOCATION,
  cloudProjectConfigured: Boolean(env.GOOGLE_CLOUD_PROJECT),
  agentEngineConfigured: Boolean(env.AGENT_ENGINE_ID),
} as const;