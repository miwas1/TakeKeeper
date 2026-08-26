import { index, jsonb, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projectsTable } from "./core";

export const agentEventsTable = pgTable(
  "agent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
    agent: text("agent").notNull(),
    action: text("action").notNull(),
    toolName: text("tool_name"),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_events_project_idx").on(table.projectId),
    index("agent_events_created_idx").on(table.createdAt),
  ],
);