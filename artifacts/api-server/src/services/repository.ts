import { and, count, desc, eq, inArray } from "drizzle-orm";
import {
  agentEventsTable,
  continuityIssuesTable,
  continuityItemsTable,
  db,
  projectsTable,
  scenesTable,
  shotsTable,
  takesTable,
} from "@workspace/db";
import { projectAccessCondition, type ProjectCapability } from "./authorization";

export async function listOwnedProjects(userId: string) {
  const projects = await db
    .select()
    .from(projectsTable)
    .where(projectAccessCondition(userId, "read"))
    .orderBy(desc(projectsTable.updatedAt));

  return Promise.all(
    projects.map(async (project) => {
      const [{ value: sceneCount }] = await db
        .select({ value: count() })
        .from(scenesTable)
        .where(eq(scenesTable.projectId, project.id));

      const [{ value: activeIssueCount }] = await db
        .select({ value: count() })
        .from(continuityIssuesTable)
        .innerJoin(scenesTable, eq(continuityIssuesTable.sceneId, scenesTable.id))
        .where(
          and(
            eq(scenesTable.projectId, project.id),
            eq(continuityIssuesTable.status, "open"),
          ),
        );

      return {
        id: project.id,
        title: project.title,
        type: project.type,
        status: project.status,
        sceneCount,
        activeIssueCount,
        updatedAt: project.updatedAt,
      };
    }),
  );
}

export async function findOwnedProject(userId: string, projectId: string, capability: ProjectCapability = "read") {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), projectAccessCondition(userId, capability)))
    .limit(1);
  return project;
}

export async function listProjectScenes(projectId: string) {
  const scenes = await db
    .select()
    .from(scenesTable)
    .where(eq(scenesTable.projectId, projectId))
    .orderBy(scenesTable.sortOrder);

  return Promise.all(
    scenes.map(async (scene) => {
      const shots = await db
        .select({ id: shotsTable.id })
        .from(shotsTable)
        .where(eq(shotsTable.sceneId, scene.id));

      return {
        id: scene.id,
        projectId: scene.projectId,
        sceneNumber: scene.sceneNumber,
        slugline: scene.slugline,
        location: scene.location,
        intExt: scene.intExt,
        timeOfDay: scene.timeOfDay,
        storyDay: scene.storyDay,
        scriptText: scene.scriptText,
        shotCount: shots.length,
        continuityCount: await db
          .select({ value: count() })
          .from(continuityItemsTable)
          .where(eq(continuityItemsTable.sceneId, scene.id))
          .then(([row]) => row.value),
        sortOrder: scene.sortOrder,
      };
    }),
  );
}

export async function listOwnedActivity(userId: string, input: {
  limit: number;
  offset?: number;
  agent?: string;
  status?: string;
}) {
  const filters = [projectAccessCondition(userId, "read")];
  if (input.agent) filters.push(eq(agentEventsTable.agent, input.agent));
  if (input.status) filters.push(eq(agentEventsTable.status, input.status));
  const query = db
    .select({
      id: agentEventsTable.id,
      agent: agentEventsTable.agent,
      action: agentEventsTable.action,
      toolName: agentEventsTable.toolName,
      status: agentEventsTable.status,
      latencyMs: agentEventsTable.latencyMs,
      createdAt: agentEventsTable.createdAt,
      projectTitle: projectsTable.title,
      metadata: agentEventsTable.metadataJson,
    })
    .from(agentEventsTable)
    .innerJoin(projectsTable, eq(agentEventsTable.projectId, projectsTable.id))
    .where(and(...filters))
    .orderBy(desc(agentEventsTable.createdAt))
    .limit(input.limit);
  return input.offset ? query.offset(input.offset) : query;
}

export async function getDashboardCounts(userId: string) {
  const ownedProjects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(projectAccessCondition(userId, "read"));
  const projectIds = ownedProjects.map((project) => project.id);

  if (projectIds.length === 0) {
    return { activeProjectCount: 0, sceneCount: 0, openIssueCount: 0, circledTakeCount: 0 };
  }

  const ownedScenes = await db
    .select({ id: scenesTable.id })
    .from(scenesTable)
    .where(inArray(scenesTable.projectId, projectIds));
  const sceneIds = ownedScenes.map((scene) => scene.id);

  if (sceneIds.length === 0) {
    return {
      activeProjectCount: projectIds.length,
      sceneCount: 0,
      openIssueCount: 0,
      circledTakeCount: 0,
    };
  }

  const [{ value: openIssueCount }] = await db
    .select({ value: count() })
    .from(continuityIssuesTable)
    .where(and(inArray(continuityIssuesTable.sceneId, sceneIds), eq(continuityIssuesTable.status, "open")));

  const ownedShots = await db
    .select({ id: shotsTable.id })
    .from(shotsTable)
    .where(inArray(shotsTable.sceneId, sceneIds));
  const shotIds = ownedShots.map((shot) => shot.id);

  const circledTakeCount = shotIds.length
    ? await db
        .select({ value: count() })
        .from(takesTable)
        .where(and(inArray(takesTable.shotId, shotIds), eq(takesTable.isCircle, true)))
        .then(([row]) => row.value)
    : 0;

  return {
    activeProjectCount: projectIds.length,
    sceneCount: sceneIds.length,
    openIssueCount,
    circledTakeCount,
  };
}
