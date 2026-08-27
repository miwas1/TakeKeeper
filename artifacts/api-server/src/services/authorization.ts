import { and, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, projectMembersTable, projectsTable } from "@workspace/db";

export const projectRoles = ["owner", "admin", "editor", "viewer"] as const;
export type ProjectRole = (typeof projectRoles)[number];
export type ProjectCapability = "read" | "write" | "manage" | "delete";

const allowedRoles: Record<ProjectCapability, readonly ProjectRole[]> = {
  read: projectRoles,
  write: ["owner", "admin", "editor"],
  manage: ["owner", "admin"],
  delete: ["owner"],
};

/** Correlated project authorization condition. Owners always have every capability. */
export function projectAccessCondition(userId: string, capability: ProjectCapability = "read"): SQL {
  const membershipRoles = allowedRoles[capability].filter((role) => role !== "owner");
  const membership = membershipRoles.length
    ? exists(db.select({ one: sql`1` }).from(projectMembersTable).where(and(
        eq(projectMembersTable.projectId, projectsTable.id),
        eq(projectMembersTable.userId, userId),
        inArray(projectMembersTable.role, membershipRoles),
      )))
    : sql`false`;
  return or(eq(projectsTable.ownerId, userId), membership)!;
}

export async function getProjectRole(userId: string, projectId: string): Promise<ProjectRole | null> {
  const [row] = await db.select({ ownerId: projectsTable.ownerId, role: projectMembersTable.role })
    .from(projectsTable)
    .leftJoin(projectMembersTable, and(
      eq(projectMembersTable.projectId, projectsTable.id),
      eq(projectMembersTable.userId, userId),
    ))
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!row) return null;
  if (row.ownerId === userId) return "owner";
  return projectRoles.includes(row.role as ProjectRole) ? row.role as ProjectRole : null;
}

export function roleAllows(role: ProjectRole | null, capability: ProjectCapability): boolean {
  return role !== null && allowedRoles[capability].includes(role);
}

export async function canAccessProject(userId: string, projectId: string, capability: ProjectCapability): Promise<boolean> {
  return roleAllows(await getProjectRole(userId, projectId), capability);
}
