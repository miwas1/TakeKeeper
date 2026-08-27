import { db, agentEventsTable } from "@workspace/db";

export const analyticsEvents = [
  "onboarding_started",
  "project_created",
  "script_imported",
  "script_breakdown_review_saved",
  "script_breakdown_approved",
  "scene_created",
  "project_updated",
  "project_archived",
  "project_deleted",
  "shot_created",
  "shot_updated",
  "take_created",
  "take_deleted",
  "take_rejected",
  "take_status_updated",
  "continuity_item_created",
  "continuity_item_updated",
  "continuity_item_deleted",
  "reference_captured",
  "reference_replaced",
  "continuity_check_started",
  "continuity_check_completed",
  "issue_detected",
  "issue_fixed",
  "issue_marked_intentional",
  "take_circled",
  "report_generated",
] as const;

export type AnalyticsEventName = (typeof analyticsEvents)[number];

export async function recordAgentEvent(input: {
  projectId?: string | null;
  agent: string;
  action: string;
  toolName?: string | null;
  status: "started" | "completed" | "failed";
  latencyMs?: number | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await db.insert(agentEventsTable).values({
    projectId: input.projectId ?? null,
    agent: input.agent,
    action: input.action,
    toolName: input.toolName ?? null,
    status: input.status,
    latencyMs: input.latencyMs ?? null,
    metadataJson: input.metadata ?? null,
  });
}

export async function trackEvent(input: {
  projectId?: string;
  name: AnalyticsEventName;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await recordAgentEvent({
    projectId: input.projectId,
    agent: "application",
    action: input.name,
    status: "completed",
    metadata: input.metadata,
  });
}
