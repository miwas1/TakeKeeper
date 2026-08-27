import { z } from "zod";
import { continuityIssueDraftSchema, visualObservationSchema } from "@workspace/takekeeper-domain";

export type ApplicationTool<TInput, TOutput> = {
  name: string;
  description: string;
  input: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput>;
};

export const plannedToolInputs = {
  get_scene: z.object({ sceneId: z.string().min(1) }),
  get_continuity_bible: z.object({ sceneId: z.string().min(1) }),
  get_reference_take: z.object({ shotId: z.string().min(1) }),
  get_take_observations: z.object({ takeId: z.string().min(1) }),
  get_effective_continuity_state: z.object({ sceneId: z.string().min(1), shotId: z.string().min(1), takeId: z.string().min(1) }),
  get_previous_approved_changes: z.object({ sceneId: z.string().min(1), takeId: z.string().min(1) }),
  save_observations: z.object({ takeId: z.string().min(1), analysisRunId: z.string().min(1), observations: z.array(visualObservationSchema) }),
  create_issue: z.object({ takeId: z.string().min(1), issue: continuityIssueDraftSchema, continuityItemId: z.string().min(1).nullable().optional() }),
  record_agent_event: z.object({
    projectId: z.string().min(1),
    agent: z.string().min(1),
    action: z.string().min(1),
    toolName: z.string().min(1).nullable().optional(),
    status: z.enum(["started", "completed", "failed"]),
    latencyMs: z.number().int().nonnegative().nullable().optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
  }),
  resolve_issue: z.object({ issueId: z.string().min(1), resolution: z.string().min(1) }),
  approve_state_change: z.object({ issueId: z.string().min(1), decision: z.unknown() }),
  update_continuity_state: z.object({ continuityItemId: z.string().min(1), state: z.string().min(1) }),
  get_shoot_day_takes: z.object({ projectId: z.string().min(1), shootDate: z.string().date() }),
  get_shoot_day_changes: z.object({ projectId: z.string().min(1), shootDate: z.string().date() }),
  get_unresolved_issues: z.object({ projectId: z.string().min(1), shootDate: z.string().date() }),
  get_circle_takes: z.object({ projectId: z.string().min(1), shootDate: z.string().date() }),
  get_scene_activity: z.object({ projectId: z.string().min(1), shootDate: z.string().date() }),
  generate_report: z.object({ projectId: z.string().min(1), shootDate: z.string().date() }),
} as const;

export const toolExecutionPolicy = {
  modelCanWriteDatabase: false,
  validationRequired: true,
  auditEventRequired: true,
} as const;
