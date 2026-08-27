import { index, jsonb, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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

export const dailyReportsTable = pgTable(
  "daily_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    shootDate: text("shoot_date").notNull(),
    status: text("status").notNull().default("not_generated"),
    factsJson: jsonb("facts_json").notNull(),
    narrative: text("narrative"),
    model: text("model"),
    errorMessage: text("error_message"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("daily_reports_project_date_uidx").on(table.projectId, table.shootDate),
    index("daily_reports_project_idx").on(table.projectId, table.updatedAt),
  ],
);
