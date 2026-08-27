import { and, eq } from "drizzle-orm";
import {
  agentEventsTable,
  continuityItemsTable,
  db,
  entitlementsTable,
  pglite,
  projectMembersTable,
  projectsTable,
  scenesTable,
  shotsTable,
  usersTable,
} from "@workspace/db";

const user = {
  id: "dev-user",
  email: "crew@takekeeper.local",
  displayName: "TakeKeeper Crew",
};

await db.insert(usersTable).values(user).onConflictDoNothing();
await db.insert(entitlementsTable).values({ userId: user.id }).onConflictDoNothing();

let [project] = await db
  .select()
  .from(projectsTable)
  .where(and(eq(projectsTable.ownerId, user.id), eq(projectsTable.title, "The Last Cup")))
  .limit(1);

if (!project) {
  [project] = await db
    .insert(projectsTable)
    .values({
      ownerId: user.id,
      title: "The Last Cup",
      type: "short_film",
      status: "active",
    })
    .returning();
}

await db
  .insert(projectMembersTable)
  .values({ projectId: project.id, userId: user.id, role: "owner" })
  .onConflictDoNothing();

let [scene] = await db
  .select()
  .from(scenesTable)
  .where(and(eq(scenesTable.projectId, project.id), eq(scenesTable.sceneNumber, "1")))
  .limit(1);

if (!scene) {
  [scene] = await db
    .insert(scenesTable)
    .values({
      projectId: project.id,
      sceneNumber: "1",
      slugline: "INT. KITCHEN — NIGHT",
      location: "Kitchen",
      intExt: "INT",
      timeOfDay: "NIGHT",
      storyDay: "1",
      sortOrder: 0,
    })
    .returning();
}

const [existingShot] = await db
  .select({ id: shotsTable.id })
  .from(shotsTable)
  .where(and(eq(shotsTable.sceneId, scene.id), eq(shotsTable.label, "1A")))
  .limit(1);

if (!existingShot) {
  await db.insert(shotsTable).values({
    sceneId: scene.id,
    label: "1A",
    description: "Wide master covering Maya at the kitchen counter.",
    status: "planned",
  });
}

const continuity = [
  ["wardrobe", "Maya's red jacket", "unzipped"],
  ["props", "white mug", "on Maya's right"],
  ["props", "black phone", "face-down beside mug"],
  ["props", "keys", "behind phone"],
] as const;

for (const [category, entity, expectedState] of continuity) {
  const [existing] = await db
    .select({ id: continuityItemsTable.id })
    .from(continuityItemsTable)
    .where(
      and(
        eq(continuityItemsTable.sceneId, scene.id),
        eq(continuityItemsTable.entity, entity),
      ),
    )
    .limit(1);
  if (!existing) {
    await db.insert(continuityItemsTable).values({
      sceneId: scene.id,
      category,
      entity,
      expectedState,
      sourceType: "manual",
      confidence: "1.0000",
    });
  }
}

const [seedEvent] = await db
  .select({ id: agentEventsTable.id })
  .from(agentEventsTable)
  .where(and(eq(agentEventsTable.projectId, project.id), eq(agentEventsTable.action, "project_created")))
  .limit(1);

if (!seedEvent) {
  await db.insert(agentEventsTable).values({
    projectId: project.id,
    agent: "application",
    action: "project_created",
    status: "completed",
    metadataJson: { source: "development_seed" },
  });
}

await pglite?.close();
