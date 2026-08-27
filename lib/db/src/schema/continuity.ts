import {
  index,
  jsonb,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { usersTable } from "./core";
import { scenesTable, shotsTable, takesTable } from "./production";

export const continuityAnalysisRunsTable = pgTable(
  "continuity_analysis_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    sceneId: uuid("scene_id").notNull().references(() => scenesTable.id, { onDelete: "cascade" }),
    shotId: uuid("shot_id").notNull().references(() => shotsTable.id, { onDelete: "cascade" }),
    takeId: uuid("take_id").notNull().references(() => takesTable.id, { onDelete: "cascade" }),
    referenceTakeId: uuid("reference_take_id").references(() => takesTable.id, { onDelete: "set null" }),
    attemptId: text("attempt_id").notNull(),
    status: text("status").notNull().default("pending"),
    model: text("model"),
    schemaVersion: text("schema_version").notNull().default("continuity-v1"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    latencyMs: integer("latency_ms"),
    errorMetadataJson: jsonb("error_metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("continuity_analysis_runs_attempt_uidx").on(table.kind, table.takeId, table.attemptId),
    index("continuity_analysis_runs_take_kind_idx").on(table.takeId, table.kind, table.createdAt),
    index("continuity_analysis_runs_scene_idx").on(table.sceneId, table.createdAt),
  ],
);

export const continuityItemsTable = pgTable(
  "continuity_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id").notNull().references(() => scenesTable.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    entity: text("entity").notNull(),
    expectedState: text("expected_state").notNull(),
    sourceType: text("source_type").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    sourceEvidence: text("source_evidence"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [index("continuity_items_scene_idx").on(table.sceneId)],
);

export const observationsTable = pgTable(
  "observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    takeId: uuid("take_id").notNull().references(() => takesTable.id, { onDelete: "cascade" }),
    analysisRunId: uuid("analysis_run_id").references(() => continuityAnalysisRunsTable.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    entity: text("entity").notNull(),
    observedState: text("observed_state").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    visibility: text("visibility").notNull().default("visible"),
    regionJson: jsonb("region_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("observations_take_idx").on(table.takeId, table.createdAt),
    index("observations_analysis_run_idx").on(table.analysisRunId),
  ],
);

export const continuityIssuesTable = pgTable(
  "continuity_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisRunId: uuid("analysis_run_id").references(() => continuityAnalysisRunsTable.id, { onDelete: "set null" }),
    sceneId: uuid("scene_id").notNull().references(() => scenesTable.id, { onDelete: "cascade" }),
    takeId: uuid("take_id").notNull().references(() => takesTable.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    entity: text("entity").notNull(),
    expectedState: text("expected_state").notNull(),
    observedState: text("observed_state").notNull(),
    severity: text("severity").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    issueKey: text("issue_key"),
    explanation: text("explanation"),
    suggestedFix: text("suggested_fix"),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("continuity_issues_scene_status_idx").on(table.sceneId, table.status),
    index("continuity_issues_take_idx").on(table.takeId, table.createdAt),
    index("continuity_issues_run_idx").on(table.analysisRunId),
    index("continuity_issues_take_key_idx").on(table.takeId, table.issueKey),
  ],
);

export const continuityStateChangesTable = pgTable(
  "continuity_state_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id").notNull().references(() => scenesTable.id, { onDelete: "cascade" }),
    continuityItemId: uuid("continuity_item_id").notNull().references(() => continuityItemsTable.id, { onDelete: "cascade" }),
    previousState: text("previous_state").notNull(),
    newState: text("new_state").notNull(),
    effectiveScope: text("effective_scope").notNull(),
    effectiveFromTakeId: uuid("effective_from_take_id").notNull().references(() => takesTable.id, { onDelete: "cascade" }),
    effectiveUntilTakeId: uuid("effective_until_take_id").references(() => takesTable.id, { onDelete: "set null" }),
    supersedesChangeId: uuid("supersedes_change_id"),
    sourceTakeId: uuid("source_take_id").notNull().references(() => takesTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("state_changes_scene_idx").on(table.sceneId),
    index("state_changes_item_idx").on(table.continuityItemId),
  ],
);
