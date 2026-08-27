import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { agentEventsTable, db } from "@workspace/db";
import { desc, isNotNull, sql } from "drizzle-orm";
import { env, googleAgentReadiness } from "../config/env";
import { googleAiAvailable, googleAiConfig } from "../services/google-ai";
import { mediaStorage, storageReadiness } from "../services/storage";

const router: IRouter = Router();

router.get("/healthz", async (_req, res): Promise<void> => {
  let database = "connected";
  let status = "ok";
  try {
    await db.execute(sql`select 1`);
  } catch {
    database = "unavailable";
    status = "degraded";
  }
  const [latestEvent] = database === "connected"
    ? await db.select({ latencyMs: agentEventsTable.latencyMs }).from(agentEventsTable).where(isNotNull(agentEventsTable.latencyMs)).orderBy(desc(agentEventsTable.createdAt)).limit(1)
    : [];
  const storageConfigured = mediaStorage.isLocal || (storageReadiness.bucketConfigured && storageReadiness.privateDirectoryConfigured);
  const productionAuthConfigured = env.NODE_ENV === "development";
  if (!productionAuthConfigured) status = "degraded";
  const data = HealthCheckResponse.parse({
    status,
    database,
    environment: env.NODE_ENV,
    auth: productionAuthConfigured ? "development_identity" : "configuration_required",
    latestAgentLatencyMs: latestEvent?.latencyMs ?? null,
    agent: {
      provider: googleAiConfig.provider,
      runtime: googleAiConfig.runtime,
      deploymentTarget: googleAiConfig.deploymentTarget,
      model: googleAiConfig.model,
      status: googleAiAvailable ? "ready" : "not_configured",
      apiKeyConfigured: googleAiAvailable,
      cloudProjectConfigured: googleAgentReadiness.cloudProjectConfigured,
      agentEngineConfigured: googleAgentReadiness.agentEngineConfigured,
    },
    storage: {
      provider: storageReadiness.provider,
      status: storageConfigured ? "ready" : "configuration_required",
      bucketConfigured: storageReadiness.bucketConfigured,
      privateDirectoryConfigured: storageReadiness.privateDirectoryConfigured,
    },
  });
  res.json(data);
});

export default router;
