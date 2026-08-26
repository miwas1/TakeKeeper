import { db, agentEventsTable } from "@workspace/db";

export const analyticsEvents = [
  "onboarding_started",
  "project_created",
  "script_imported",
  "scene_created",
  "reference_captured",
  "continuity_check_started",
  "continuity_check_completed",
  "issue_detected",
  "issue_fixed",
  "issue_marked_intentional",
  "take_circled",
  "report_generated",
] as const;

export type AnalyticsEventName = (typeof analyticsEvents)[number];

export async function trackEvent(input: {
  projectId?: string;
  name: AnalyticsEventName;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(agentEventsTable).values({
    projectId: input.projectId,
    agent: "application",
    action: input.name,
    status: "completed",
    metadataJson: input.metadata,
  });
}