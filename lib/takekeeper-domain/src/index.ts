import { z } from "zod";

export const issueStatuses = ["open", "fixed", "intentional", "ignored"] as const;
export const effectiveScopes = ["this_shot", "rest_of_scene", "from_now_on"] as const;

export const continuityItemSchema = z.object({
  category: z.string().min(1),
  entity: z.string().min(1),
  expectedState: z.string().min(1),
  sourceType: z.enum(["script", "reference", "approved_change", "manual"]),
  confidence: z.number().min(0).max(1).nullable().optional(),
  active: z.boolean().default(true),
});

export const sceneBreakdownSchema = z.object({
  sceneNumber: z.string().min(1),
  slugline: z.string().min(1),
  location: z.string(),
  intExt: z.enum(["INT", "EXT", "INT/EXT", ""]),
  timeOfDay: z.string(),
  storyDay: z.string(),
  scriptText: z.string().nullable(),
  continuityItems: z.array(continuityItemSchema),
});

export const visualObservationSchema = z.object({
  category: z.string().min(1),
  entity: z.string().min(1),
  observedState: z.string().min(1),
  confidence: z.number().min(0).max(1),
  region: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }).nullable(),
});

export const visualStateResultSchema = z.object({
  takeId: z.string().min(1),
  observations: z.array(visualObservationSchema),
  warnings: z.array(z.string()),
  model: z.string().min(1),
});

export const continuityIssueSchema = z.object({
  category: z.string().min(1),
  entity: z.string().min(1),
  expectedState: z.string().min(1),
  observedState: z.string().min(1),
  severity: z.enum(["info", "warning", "critical"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1),
  suggestedFix: z.string().nullable(),
  status: z.enum(issueStatuses),
});

export const continuityCheckResultSchema = z.object({
  sceneId: z.string().min(1),
  takeId: z.string().min(1),
  issues: z.array(continuityIssueSchema),
  observations: z.array(visualObservationSchema),
  checkedAt: z.string().datetime(),
});

export const stateChangeDecisionSchema = z.object({
  continuityItemId: z.string().min(1),
  previousState: z.string().min(1),
  newState: z.string().min(1),
  effectiveScope: z.enum(effectiveScopes),
  effectiveFromTakeId: z.string().min(1),
  effectiveUntilTakeId: z.string().nullable(),
  reason: z.string().min(1),
});

export const agentEventSchema = z.object({
  projectId: z.string().nullable(),
  agent: z.string().min(1),
  action: z.string().min(1),
  toolName: z.string().nullable(),
  status: z.enum(["started", "completed", "failed"]),
  latencyMs: z.number().int().nonnegative().nullable(),
  metadata: z.record(z.unknown()).nullable(),
});

export const dailyReportSchema = z.object({
  projectId: z.string().min(1),
  shootDate: z.string().date(),
  scenesCovered: z.array(z.string()),
  takesCaptured: z.number().int().nonnegative(),
  issuesDetected: z.number().int().nonnegative(),
  issuesResolved: z.number().int().nonnegative(),
  unresolvedIssues: z.array(continuityIssueSchema),
  notes: z.array(z.string()),
});

export type SceneBreakdown = z.infer<typeof sceneBreakdownSchema>;
export type ContinuityItem = z.infer<typeof continuityItemSchema>;
export type VisualObservation = z.infer<typeof visualObservationSchema>;
export type VisualStateResult = z.infer<typeof visualStateResultSchema>;
export type ContinuityIssue = z.infer<typeof continuityIssueSchema>;
export type ContinuityCheckResult = z.infer<typeof continuityCheckResultSchema>;
export type StateChangeDecision = z.infer<typeof stateChangeDecisionSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type DailyReport = z.infer<typeof dailyReportSchema>;