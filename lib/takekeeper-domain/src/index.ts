import { z } from "zod";

export const issueStatuses = ["open", "fixed", "intentional", "ignored"] as const;
export const effectiveScopes = ["this_shot", "rest_of_scene", "from_now_on"] as const;
export const continuityCategories = ["wardrobe", "props", "hair_makeup", "blocking", "set", "action", "other"] as const;
export const issueSeverities = ["low", "medium", "high"] as const;
export const observationVisibilityStates = ["visible", "not_visible", "obscured", "absent", "uncertain"] as const;
export const analysisRunKinds = ["visual_state", "continuity_check"] as const;
export const analysisRunStatuses = ["pending", "analyzing", "completed", "failed"] as const;

export const continuityItemSchema = z.object({
  category: z.enum(continuityCategories),
  entity: z.string().min(1),
  expectedState: z.string().min(1),
  sourceType: z.enum(["script", "reference", "approved_change", "manual", "agent"]),
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

export const screenplaySourceTypes = ["paste", "txt"] as const;
export const screenplayImportStatuses = ["analyzing", "review", "approved", "failed"] as const;
export const screenplayContinuityCategories = ["wardrobe", "props", "hair_makeup", "blocking", "set", "action", "other"] as const;

export const screenplayContinuityItemSchema = continuityItemSchema.extend({
  category: z.enum(screenplayContinuityCategories),
  sourceType: z.literal("script"),
  confidence: z.number().min(0).max(1),
  sourceEvidence: z.string().min(1).nullable(),
});

export const screenplaySceneSchema = z.object({
  id: z.string().uuid().optional(),
  sceneNumber: z.string().min(1),
  slugline: z.string().min(1),
  location: z.string(),
  intExt: z.enum(["INT", "EXT", "INT/EXT", ""]),
  timeOfDay: z.string(),
  storyDay: z.string(),
  scriptText: z.string().nullable(),
  characters: z.array(z.string().min(1)),
  continuityItems: z.array(screenplayContinuityItemSchema),
});

export const screenplayBreakdownSchema = z.object({
  scenes: z.array(screenplaySceneSchema),
});

export const screenplayImportSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceType: z.enum(screenplaySourceTypes),
  fileName: z.string().nullable(),
  content: z.string(),
  status: z.enum(screenplayImportStatuses),
  errorMessage: z.string().nullable(),
  model: z.string().nullable(),
  analysis: screenplayBreakdownSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const visualObservationSchema = z.object({
  category: z.enum(continuityCategories),
  entity: z.string().min(1),
  observedState: z.string().min(1),
  confidence: z.number().min(0).max(1),
  visibility: z.enum(observationVisibilityStates).default("visible"),
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

export const continuityIssueDraftSchema = z.object({
  category: z.enum(continuityCategories),
  entity: z.string().min(1),
  expectedState: z.string().min(1),
  observedState: z.string().min(1),
  severity: z.enum(issueSeverities),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1),
  suggestedFix: z.string().nullable(),
});

export const continuityIssueSchema = continuityIssueDraftSchema.extend({
  id: z.string().uuid().optional(),
  sceneId: z.string().uuid().optional(),
  takeId: z.string().uuid().optional(),
  analysisRunId: z.string().uuid().nullable().optional(),
  issueKey: z.string().min(1).optional(),
  stateDimension: z.string().min(1).optional(),
  status: z.enum(issueStatuses),
  continuityItemId: z.string().uuid().nullable().optional(),
  resolution: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  resolutionTakeId: z.string().uuid().nullable().optional(),
  resolvedByUserId: z.string().nullable().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
});

export const continuitySupervisorOutputSchema = z.object({
  issues: z.array(continuityIssueDraftSchema),
});

export const continuityCheckResultSchema = z.object({
  checkId: z.string().uuid().optional(),
  sceneId: z.string().uuid(),
  shotId: z.string().uuid(),
  takeId: z.string().uuid(),
  referenceTakeId: z.string().uuid().nullable(),
  status: z.enum(analysisRunStatuses),
  issues: z.array(continuityIssueSchema),
  observations: z.array(visualObservationSchema),
  model: z.string().min(1),
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

export const continuityStateChangeSchema = z.object({
  id: z.string().uuid(),
  sceneId: z.string().uuid(),
  continuityItemId: z.string().uuid(),
  previousState: z.string().min(1),
  newState: z.string().min(1),
  effectiveScope: z.enum(effectiveScopes),
  effectiveFromTakeId: z.string().uuid(),
  effectiveUntilTakeId: z.string().uuid().nullable(),
  supersedesChangeId: z.string().uuid().nullable(),
  sourceTakeId: z.string().uuid(),
  userId: z.string(),
  userDisplayName: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export const continuityIssueEventSchema = z.object({
  id: z.string().uuid(),
  issueId: z.string().uuid(),
  eventType: z.string(),
  status: z.enum([...issueStatuses, "note"] as const).nullable(),
  note: z.string().nullable(),
  resolution: z.string().nullable(),
  resolutionTakeId: z.string().uuid().nullable(),
  userId: z.string().nullable(),
  userDisplayName: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  createdAt: z.string().datetime(),
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

export const dailyReportFactsSchema = z.object({
  projectId: z.string().min(1),
  projectTitle: z.string().min(1),
  shootDate: z.string().date(),
  scenesWorked: z.number().int().nonnegative(),
  sceneSummaries: z.array(z.object({
    sceneId: z.string().min(1),
    sceneNumber: z.string().min(1),
    slugline: z.string(),
    shotCount: z.number().int().nonnegative(),
    takeCount: z.number().int().nonnegative(),
  })),
  shots: z.number().int().nonnegative(),
  takeCount: z.number().int().nonnegative(),
  circleTakes: z.number().int().nonnegative(),
  circleTakeDetails: z.array(z.object({
    takeId: z.string().min(1),
    sceneNumber: z.string().min(1),
    shotLabel: z.string().min(1),
    takeNumber: z.number().int().nonnegative(),
    notes: z.string().nullable(),
    continuityStatus: z.enum(["all_clear", "issues", "not_checked"]),
  })),
  issuesDetected: z.number().int().nonnegative(),
  issuesFixed: z.number().int().nonnegative(),
  issuesIntentional: z.number().int().nonnegative(),
  issuesIgnored: z.number().int().nonnegative(),
  unresolvedWarnings: z.number().int().nonnegative(),
  unresolvedIssues: z.array(continuityIssueSchema),
  intentionalChanges: z.array(z.string()),
  notes: z.array(z.string()),
});

export const dailyReportNarrativeSchema = z.object({
  summary: z.string().min(1).max(4000),
});

export type SceneBreakdown = z.infer<typeof sceneBreakdownSchema>;
export type ScreenplayScene = z.infer<typeof screenplaySceneSchema>;
export type ScreenplayBreakdown = z.infer<typeof screenplayBreakdownSchema>;
export type ScreenplayImport = z.infer<typeof screenplayImportSchema>;
export type ContinuityItem = z.infer<typeof continuityItemSchema>;
export type VisualObservation = z.infer<typeof visualObservationSchema>;
export type VisualStateResult = z.infer<typeof visualStateResultSchema>;
export type ContinuityIssueDraft = z.infer<typeof continuityIssueDraftSchema>;
export type ContinuityIssue = z.infer<typeof continuityIssueSchema>;
export type ContinuitySupervisorOutput = z.infer<typeof continuitySupervisorOutputSchema>;
export type ContinuityCheckResult = z.infer<typeof continuityCheckResultSchema>;
export type StateChangeDecision = z.infer<typeof stateChangeDecisionSchema>;
export type ContinuityStateChange = z.infer<typeof continuityStateChangeSchema>;
export type ContinuityIssueEvent = z.infer<typeof continuityIssueEventSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type DailyReport = z.infer<typeof dailyReportSchema>;
export type DailyReportFacts = z.infer<typeof dailyReportFactsSchema>;
export type DailyReportNarrative = z.infer<typeof dailyReportNarrativeSchema>;
