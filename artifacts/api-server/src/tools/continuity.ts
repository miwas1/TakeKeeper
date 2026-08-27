import { and, eq } from "drizzle-orm";
import {
  continuityItemsTable,
  db,
  projectsTable,
  scenesTable,
  shotsTable,
  takesTable,
} from "@workspace/db";
import { visualObservationSchema, type ContinuityIssueDraft, type VisualObservation } from "@workspace/takekeeper-domain";
import { recordAgentEvent as writeAgentEvent } from "../services/analytics";
import {
  getApprovedChanges,
  getReferenceTake,
  getTakeContext,
  getTakeObservations,
  resolveApprovedContinuityState,
} from "../services/continuity/approved-state";
import { plannedToolInputs, type ApplicationTool } from "./index";

type ContinuityToolDependencies = {
  projectId: string;
  saveObservations?: (input: { takeId: string; analysisRunId: string; observations: VisualObservation[] }) => Promise<unknown>;
  createIssue?: (input: { takeId: string; issue: ContinuityIssueDraft }) => Promise<unknown>;
};

type ContinuityToolRuntime = {
  get_scene: ApplicationTool<{ sceneId: string }, unknown>;
  get_continuity_bible: ApplicationTool<{ sceneId: string }, unknown>;
  get_reference_take: ApplicationTool<{ shotId: string }, unknown>;
  get_take_observations: ApplicationTool<{ takeId: string }, unknown>;
  get_previous_approved_changes: ApplicationTool<{ sceneId: string; takeId: string }, unknown>;
  get_effective_continuity_state: ApplicationTool<{ sceneId: string; shotId: string; takeId: string }, unknown>;
  save_observations: ApplicationTool<{ takeId: string; analysisRunId: string; observations: Array<Omit<VisualObservation, "visibility"> & { visibility?: VisualObservation["visibility"] }> }, unknown>;
  create_issue: ApplicationTool<{ takeId: string; issue: ContinuityIssueDraft }, unknown>;
  record_agent_event: ApplicationTool<{
    projectId: string;
    agent: string;
    action: string;
    toolName?: string | null;
    status: "started" | "completed" | "failed";
    latencyMs?: number | null;
    metadata?: Record<string, unknown> | null;
  }, unknown>;
};

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function makeTool<TInput, TOutput>(
  dependencies: ContinuityToolDependencies,
  name: string,
  input: ApplicationTool<TInput, TOutput>["input"],
  handler: (value: TInput) => Promise<TOutput>,
): ApplicationTool<TInput, TOutput> {
  return {
    name,
    description: `Validated application tool: ${name}.`,
    input,
    execute: async (rawInput) => {
      const startedAt = Date.now();
      await writeAgentEvent({
        projectId: dependencies.projectId,
        agent: "continuity-workflow",
        action: `${name}:started`,
        toolName: name,
        status: "started",
        metadata: { validationRequired: true },
      });
      try {
        const parsed = input.parse(rawInput);
        const result = await handler(parsed);
        await writeAgentEvent({
          projectId: dependencies.projectId,
          agent: "continuity-workflow",
          action: `${name}:completed`,
          toolName: name,
          status: "completed",
          latencyMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        await writeAgentEvent({
          projectId: dependencies.projectId,
          agent: "continuity-workflow",
          action: `${name}:failed`,
          toolName: name,
          status: "failed",
          latencyMs: Date.now() - startedAt,
          metadata: { errorType: errorType(error) },
        });
        throw error;
      }
    },
  };
}

export function createContinuityToolRuntime(dependencies: ContinuityToolDependencies): ContinuityToolRuntime {
  return {
    get_scene: makeTool(dependencies, "get_scene", plannedToolInputs.get_scene, async ({ sceneId }) => {
      const [row] = await db
        .select({ scene: scenesTable })
        .from(scenesTable)
        .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
        .where(and(eq(scenesTable.id, sceneId), eq(projectsTable.id, dependencies.projectId)))
        .limit(1);
      if (!row) throw new Error("Scene not found");
      return row.scene;
    }),
    get_continuity_bible: makeTool(dependencies, "get_continuity_bible", plannedToolInputs.get_continuity_bible, async ({ sceneId }) => {
      const rows = await db
        .select()
        .from(continuityItemsTable)
        .innerJoin(scenesTable, eq(continuityItemsTable.sceneId, scenesTable.id))
        .where(and(eq(continuityItemsTable.sceneId, sceneId), eq(scenesTable.projectId, dependencies.projectId), eq(continuityItemsTable.active, true)))
        .orderBy(continuityItemsTable.category, continuityItemsTable.entity);
      return rows.map(({ continuity_items: item }) => ({
        ...item,
        confidence: item.confidence === null ? null : Number(item.confidence),
      }));
    }),
    get_reference_take: makeTool(dependencies, "get_reference_take", plannedToolInputs.get_reference_take, async ({ shotId }) => {
      const [shot] = await db
        .select({ id: shotsTable.id })
        .from(shotsTable)
        .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
        .where(and(eq(shotsTable.id, shotId), eq(scenesTable.projectId, dependencies.projectId)))
        .limit(1);
      if (!shot) throw new Error("Shot not found");
      return getReferenceTake(shot.id);
    }),
    get_take_observations: makeTool(dependencies, "get_take_observations", plannedToolInputs.get_take_observations, async ({ takeId }) => {
      const context = await getTakeContext(takeId);
      if (!context || context.scene.projectId !== dependencies.projectId) throw new Error("Take not found");
      return getTakeObservations(takeId);
    }),
    get_previous_approved_changes: makeTool(dependencies, "get_previous_approved_changes", plannedToolInputs.get_previous_approved_changes, async ({ sceneId, takeId }) => {
      const context = await getTakeContext(takeId);
      if (!context || context.scene.projectId !== dependencies.projectId || context.scene.id !== sceneId) throw new Error("Take not found in scene");
      return getApprovedChanges(sceneId, context.shot.id, takeId);
    }),
    get_effective_continuity_state: makeTool(dependencies, "get_effective_continuity_state", plannedToolInputs.get_effective_continuity_state, async ({ sceneId, shotId, takeId }) => {
      const context = await getTakeContext(takeId);
      if (!context || context.scene.projectId !== dependencies.projectId) throw new Error("Continuity context not found");
      return resolveApprovedContinuityState(sceneId, shotId, takeId);
    }),
    save_observations: makeTool(dependencies, "save_observations", plannedToolInputs.save_observations, async (input) => {
      if (!dependencies.saveObservations) throw new Error("Observation persistence is not available");
      return dependencies.saveObservations({
        ...input,
        observations: input.observations.map((observation) => visualObservationSchema.parse(observation)),
      });
    }),
    create_issue: makeTool(dependencies, "create_issue", plannedToolInputs.create_issue, async (input) => {
      if (!dependencies.createIssue) throw new Error("Issue persistence is not available");
      return dependencies.createIssue(input);
    }),
    record_agent_event: makeTool(dependencies, "record_agent_event", plannedToolInputs.record_agent_event, async (input) => {
      await writeAgentEvent(input);
      return { recorded: true };
    }),
  };
}
