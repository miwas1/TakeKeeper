import { z } from "zod";

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
  get_previous_approved_changes: z.object({ sceneId: z.string().min(1), takeId: z.string().min(1) }),
  save_observations: z.object({ takeId: z.string().min(1), observations: z.array(z.unknown()) }),
  create_issue: z.object({ takeId: z.string().min(1), issue: z.unknown() }),
  resolve_issue: z.object({ issueId: z.string().min(1), resolution: z.string().min(1) }),
  approve_state_change: z.object({ issueId: z.string().min(1), decision: z.unknown() }),
  update_continuity_state: z.object({ continuityItemId: z.string().min(1), state: z.string().min(1) }),
  get_shoot_day_takes: z.object({ projectId: z.string().min(1), shootDate: z.string().date() }),
  generate_report: z.object({ projectId: z.string().min(1), shootDate: z.string().date() }),
} as const;

export const toolExecutionPolicy = {
  modelCanWriteDatabase: false,
  validationRequired: true,
  auditEventRequired: true,
} as const;