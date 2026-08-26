import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./core";

export const screenplaySourcesTable = pgTable(
  "screenplay_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    fileName: text("file_name"),
    content: text("content").notNull(),
    status: text("status").notNull().default("analyzing"),
    analysisAttemptId: text("analysis_attempt_id"),
    analysisStartedAt: timestamp("analysis_started_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    model: text("model"),
    analysisJson: jsonb("analysis_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("screenplay_sources_project_idx").on(table.projectId, table.createdAt),
    index("screenplay_sources_status_idx").on(table.status),
  ],
);

export type ScreenplaySource = typeof screenplaySourcesTable.$inferSelect;
export type InsertScreenplaySource = typeof screenplaySourcesTable.$inferInsert;