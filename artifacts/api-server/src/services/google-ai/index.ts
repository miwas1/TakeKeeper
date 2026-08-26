import type { z } from "zod";
import {
  continuityCheckResultSchema,
  dailyReportSchema,
  sceneBreakdownSchema,
  visualStateResultSchema,
} from "@workspace/takekeeper-domain";
import { env } from "../../config/env";

export type AgentDefinition<TOutput> = {
  name: string;
  purpose: string;
  outputSchema: z.ZodType<TOutput>;
};

export const takeKeeperAgents = {
  scriptBreakdown: {
    name: "script-breakdown-agent",
    purpose: "Extract scene structure and continuity items from script text.",
    outputSchema: sceneBreakdownSchema,
  },
  visualState: {
    name: "visual-state-agent",
    purpose: "Describe visible state from approved media without mutating application data.",
    outputSchema: visualStateResultSchema,
  },
  continuitySupervisor: {
    name: "continuity-supervisor-agent",
    purpose: "Compare validated visual state against approved continuity state.",
    outputSchema: continuityCheckResultSchema,
  },
  report: {
    name: "report-agent",
    purpose: "Compile validated production activity into a daily continuity report.",
    outputSchema: dailyReportSchema,
  },
} satisfies Record<string, AgentDefinition<unknown>>;

export const googleAiConfig = {
  provider: "google",
  model: env.GEMINI_MODEL,
  cloudProject: env.GOOGLE_CLOUD_PROJECT,
  location: env.GOOGLE_CLOUD_LOCATION,
  agentEngineId: env.AGENT_ENGINE_ID,
} as const;