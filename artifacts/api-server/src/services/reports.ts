import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import {
  continuityAnalysisRunsTable,
  continuityIssueEventsTable,
  continuityIssuesTable,
  continuityStateChangesTable,
  continuityItemsTable,
  dailyReportsTable,
  db,
  projectsTable,
  scenesTable,
  shotsTable,
  takesTable,
} from "@workspace/db";
import {
  dailyReportFactsSchema,
  type DailyReportFacts,
} from "@workspace/takekeeper-domain";
import { generateDailyReport } from "./google-ai";
import { recordAgentEvent, trackEvent } from "./analytics";
import { serializeContinuityIssue } from "./continuity/decisions";
import { collectReportToolContext, createReportToolRuntime } from "../tools/reports";
import { projectAccessCondition, type ProjectCapability } from "./authorization";

export const dailyReportStatuses = ["not_generated", "generating", "ready", "failed"] as const;
export const reportToolNames = [
  "get_shoot_day_takes",
  "get_shoot_day_changes",
  "get_unresolved_issues",
  "get_circle_takes",
  "get_scene_activity",
  "generate_report",
] as const;

type DailyReportStatus = (typeof dailyReportStatuses)[number];

function asDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dayRange(shootDate: string) {
  const start = new Date(`${shootDate}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function inRange(value: Date | string, start: Date, end: Date) {
  const date = asDate(value);
  return date >= start && date < end;
}

function scopeLabel(scope: string) {
  if (scope === "this_shot") return "this shot";
  if (scope === "rest_of_scene") return "the rest of the scene";
  return "future takes";
}

function errorType(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

function safeReportError() {
  return "Couldn't generate the report. Your production records are safe. Try again.";
}

async function getOwnedProject(userId: string, projectId: string, capability: ProjectCapability = "read") {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), projectAccessCondition(userId, capability)))
    .limit(1);
  return project;
}

async function getDefaultShootDate(projectId: string) {
  const [latest] = await db
    .select({ capturedAt: takesTable.capturedAt })
    .from(takesTable)
    .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
    .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
    .where(eq(scenesTable.projectId, projectId))
    .orderBy(desc(takesTable.capturedAt))
    .limit(1);
  return latest ? isoDate(asDate(latest.capturedAt)) : isoDate(new Date());
}

export async function buildDailyReportFacts(projectId: string, shootDate: string): Promise<DailyReportFacts> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  const { start, end } = dayRange(shootDate);

  const projectScenes = await db
    .select()
    .from(scenesTable)
    .where(eq(scenesTable.projectId, projectId))
    .orderBy(asc(scenesTable.sortOrder), asc(scenesTable.sceneNumber));
  const sceneIds = projectScenes.map((scene) => scene.id);

  const dailyTakeRows = sceneIds.length
    ? await db
        .select({ take: takesTable, shot: shotsTable, scene: scenesTable })
        .from(takesTable)
        .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
        .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
        .where(and(eq(scenesTable.projectId, projectId), gte(takesTable.capturedAt, start), lt(takesTable.capturedAt, end)))
        .orderBy(asc(takesTable.capturedAt), asc(takesTable.takeNumber), asc(takesTable.id))
    : [];
  const dailyTakeIds = dailyTakeRows.map(({ take }) => take.id);
  const dailyShotIds = [...new Set(dailyTakeRows.map(({ shot }) => shot.id))];

  const projectIssues = sceneIds.length
    ? await db.select().from(continuityIssuesTable).where(inArray(continuityIssuesTable.sceneId, sceneIds))
    : [];
  const projectIssueIds = projectIssues.map((issue) => issue.id);
  const dailyIssues = dailyTakeIds.length
    ? projectIssues.filter((issue) => dailyTakeIds.includes(issue.takeId))
    : [];
  const issueEvents = projectIssueIds.length
    ? await db
        .select()
        .from(continuityIssueEventsTable)
        .where(and(inArray(continuityIssueEventsTable.issueId, projectIssueIds), gte(continuityIssueEventsTable.createdAt, start), lt(continuityIssueEventsTable.createdAt, end)))
    : [];

  const detectedIssueIds = new Set(
    issueEvents
      .filter((event) => event.eventType === "detected" || event.eventType === "detected_again")
      .filter((event) => dailyTakeIds.includes(projectIssues.find((issue) => issue.id === event.issueId)?.takeId ?? ""))
      .map((event) => event.issueId),
  );
  for (const issue of dailyIssues) {
    if (inRange(issue.createdAt, start, end)) detectedIssueIds.add(issue.id);
  }
  const idsForStatus = (status: string) => new Set(
    issueEvents.filter((event) => event.eventType === "status_changed" && event.status === status).map((event) => event.issueId),
  );
  const fixedIssueIds = idsForStatus("fixed");
  const intentionalIssueIds = idsForStatus("intentional");
  const ignoredIssueIds = idsForStatus("ignored");

  const checkRows = dailyTakeIds.length
    ? await db
        .select({ takeId: continuityAnalysisRunsTable.takeId, status: continuityAnalysisRunsTable.status })
        .from(continuityAnalysisRunsTable)
        .where(and(inArray(continuityAnalysisRunsTable.takeId, dailyTakeIds), eq(continuityAnalysisRunsTable.kind, "continuity_check")))
    : [];

  const sceneSummaryMap = new Map<string, { sceneId: string; sceneNumber: string; slugline: string; shots: Set<string>; takeCount: number }>();
  for (const { scene, shot } of dailyTakeRows) {
    const summary = sceneSummaryMap.get(scene.id) ?? {
      sceneId: scene.id,
      sceneNumber: scene.sceneNumber,
      slugline: scene.slugline,
      shots: new Set<string>(),
      takeCount: 0,
    };
    summary.shots.add(shot.id);
    summary.takeCount += 1;
    sceneSummaryMap.set(scene.id, summary);
  }
  const sceneSummaries = [...sceneSummaryMap.values()].map((summary) => ({
    sceneId: summary.sceneId,
    sceneNumber: summary.sceneNumber,
    slugline: summary.slugline,
    shotCount: summary.shots.size,
    takeCount: summary.takeCount,
  }));

  const dailyIssuesByTake = new Map<string, number>();
  for (const issue of dailyIssues) dailyIssuesByTake.set(issue.takeId, (dailyIssuesByTake.get(issue.takeId) ?? 0) + 1);
  const completedChecks = new Set(checkRows.filter((row) => row.status === "completed").map((row) => row.takeId));
  const circleTakeDetails = dailyTakeRows
    .filter(({ take }) => take.isCircle)
    .map(({ take, shot, scene }) => ({
      takeId: take.id,
      sceneNumber: scene.sceneNumber,
      shotLabel: shot.label,
      takeNumber: take.takeNumber,
      notes: take.notes,
      continuityStatus: (dailyIssuesByTake.has(take.id)
        ? "issues"
        : completedChecks.has(take.id) ? "all_clear" : "not_checked") as "all_clear" | "issues" | "not_checked",
    }));

  const stateChanges = sceneIds.length
    ? await db
        .select({ change: continuityStateChangesTable, item: continuityItemsTable, sourceTake: takesTable, sourceShot: shotsTable })
        .from(continuityStateChangesTable)
        .innerJoin(continuityItemsTable, eq(continuityStateChangesTable.continuityItemId, continuityItemsTable.id))
        .innerJoin(takesTable, eq(continuityStateChangesTable.sourceTakeId, takesTable.id))
        .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
        .where(and(inArray(continuityStateChangesTable.sceneId, sceneIds), gte(continuityStateChangesTable.createdAt, start), lt(continuityStateChangesTable.createdAt, end)))
        .orderBy(asc(continuityStateChangesTable.createdAt))
    : [];
  const intentionalChanges = stateChanges.map(({ change, item, sourceTake }) =>
    `${item.entity} changed from ${change.previousState} to ${change.newState} beginning with Take ${sourceTake.takeNumber} (${scopeLabel(change.effectiveScope)}).`,
  );

  const notes: string[] = [];
  const notedShotIds = new Set<string>();
  const addNote = (value: string | null | undefined) => {
    const cleaned = value?.trim();
    if (cleaned && !notes.includes(cleaned)) notes.push(cleaned);
  };
  for (const { take, shot, scene } of dailyTakeRows) {
    if (take.notes) addNote(`Scene ${scene.sceneNumber} · ${shot.label} · Take ${take.takeNumber}: ${take.notes}`);
    if (shot.notes && !notedShotIds.has(shot.id)) {
      addNote(`Scene ${scene.sceneNumber} · ${shot.label}: ${shot.notes}`);
      notedShotIds.add(shot.id);
    }
  }
  for (const issue of projectIssues.filter((issue) => issue.status === "open")) addNote(issue.notes);
  for (const { change } of stateChanges) addNote(change.reason);

  return dailyReportFactsSchema.parse({
    projectId,
    projectTitle: project.title,
    shootDate,
    scenesWorked: sceneSummaries.length,
    sceneSummaries,
    shots: dailyShotIds.length,
    takeCount: dailyTakeRows.length,
    circleTakes: circleTakeDetails.length,
    circleTakeDetails,
    issuesDetected: detectedIssueIds.size,
    issuesFixed: fixedIssueIds.size,
    issuesIntentional: intentionalIssueIds.size,
    issuesIgnored: ignoredIssueIds.size,
    unresolvedWarnings: projectIssues.filter((issue) => issue.status === "open").length,
    unresolvedIssues: projectIssues.filter((issue) => issue.status === "open").map(serializeContinuityIssue),
    intentionalChanges,
    notes: notes.slice(0, 80),
  });
}

function statusOf(value: string): DailyReportStatus {
  return dailyReportStatuses.includes(value as DailyReportStatus) ? value as DailyReportStatus : "not_generated";
}

function reportMessage(status: DailyReportStatus) {
  if (status === "ready") return "Generated from persisted production records.";
  if (status === "generating") return "The Report Agent is preparing a narrative from the selected shoot day.";
  if (status === "failed") return safeReportError();
  return "No saved report for this shoot day yet.";
}

export function serializeDailyReport(input: {
  facts: DailyReportFacts;
  report?: typeof dailyReportsTable.$inferSelect | null;
}) {
  const status = statusOf(input.report?.status ?? "not_generated");
  return {
    id: input.report?.id ?? null,
    available: status === "ready",
    status,
    message: reportMessage(status),
    projectId: input.facts.projectId,
    project: input.facts.projectTitle,
    shootDate: input.facts.shootDate,
    scenesWorked: input.facts.scenesWorked,
    sceneSummaries: input.facts.sceneSummaries,
    shots: input.facts.shots,
    takeCount: input.facts.takeCount,
    circleTakes: input.facts.circleTakes,
    circleTakeDetails: input.facts.circleTakeDetails,
    issuesDetected: input.facts.issuesDetected,
    issuesFixed: input.facts.issuesFixed,
    issuesIntentional: input.facts.issuesIntentional,
    issuesIgnored: input.facts.issuesIgnored,
    unresolvedWarnings: input.facts.unresolvedWarnings,
    unresolvedIssues: input.facts.unresolvedIssues,
    intentionalChanges: input.facts.intentionalChanges,
    notes: input.facts.notes,
    narrative: input.report?.narrative ?? null,
    model: input.report?.model ?? null,
    generatedAt: input.report?.generatedAt?.toISOString() ?? null,
    updatedAt: input.report?.updatedAt?.toISOString() ?? new Date().toISOString(),
    errorMessage: input.report?.errorMessage ?? null,
    agentTools: [...reportToolNames],
  };
}

export async function getDailyReport(userId: string, projectId: string, requestedShootDate?: string) {
  const project = await getOwnedProject(userId, projectId);
  if (!project) return null;
  const shootDate = requestedShootDate ?? await getDefaultShootDate(projectId);
  const [report, facts] = await Promise.all([
    db.select().from(dailyReportsTable).where(and(eq(dailyReportsTable.projectId, projectId), eq(dailyReportsTable.shootDate, shootDate))).limit(1).then(([row]) => row ?? null),
    buildDailyReportFacts(projectId, shootDate),
  ]);
  return serializeDailyReport({ facts, report });
}

export async function generateDailyReportForUser(userId: string, projectId: string, shootDate: string) {
  const project = await getOwnedProject(userId, projectId, "write");
  if (!project) return null;
  const facts = await buildDailyReportFacts(projectId, shootDate);
  const now = new Date();
  const [pending] = await db
    .insert(dailyReportsTable)
    .values({
      projectId,
      shootDate,
      status: "generating",
      factsJson: facts,
      narrative: null,
      model: null,
      errorMessage: null,
      generatedAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [dailyReportsTable.projectId, dailyReportsTable.shootDate],
      set: {
        status: "generating",
        factsJson: facts,
        narrative: null,
        model: null,
        errorMessage: null,
        generatedAt: null,
        updatedAt: now,
      },
    })
    .returning();

  const startedAt = Date.now();
  await recordAgentEvent({
    projectId,
    agent: "report-agent",
    action: "daily_report_generation",
    toolName: "ReportAgentWorkflow",
    status: "started",
    metadata: { shootDate, toolCount: reportToolNames.length },
  });

  try {
    const runtime = createReportToolRuntime({ projectId, facts });
    await collectReportToolContext(runtime, facts);
    const generated = await generateDailyReport({ project: { id: project.id, title: project.title }, facts });
    const [saved] = await db
      .update(dailyReportsTable)
      .set({
        status: "ready",
        factsJson: facts,
        narrative: generated.summary,
        model: generated.model,
        errorMessage: null,
        generatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dailyReportsTable.id, pending.id))
      .returning();
    await recordAgentEvent({
      projectId,
      agent: "report-agent",
      action: "daily_report_generation",
      toolName: "ReportAgentWorkflow",
      status: "completed",
      latencyMs: Date.now() - startedAt,
      metadata: { shootDate, model: generated.model, reportId: saved?.id ?? pending.id },
    });
    await trackEvent({ projectId, name: "report_generated", metadata: { shootDate, reportId: saved?.id ?? pending.id } });
    return serializeDailyReport({ facts, report: saved ?? pending });
  } catch (error) {
    const safeMessage = safeReportError();
    const [failed] = await db
      .update(dailyReportsTable)
      .set({ status: "failed", errorMessage: safeMessage, updatedAt: new Date() })
      .where(eq(dailyReportsTable.id, pending.id))
      .returning();
    await recordAgentEvent({
      projectId,
      agent: "report-agent",
      action: "daily_report_generation",
      toolName: "ReportAgentWorkflow",
      status: "failed",
      latencyMs: Date.now() - startedAt,
      metadata: { shootDate, errorType: errorType(error) },
    });
    return serializeDailyReport({ facts, report: failed ?? { ...pending, status: "failed", errorMessage: safeMessage } });
  }
}
