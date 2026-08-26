import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { usersTable } from "./core";
import { scenesTable, takesTable } from "./production";

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
    category: text("category").notNull(),
    entity: text("entity").notNull(),
    observedState: text("observed_state").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    regionJson: jsonb("region_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("observations_take_idx").on(table.takeId)],
);

export const continuityIssuesTable = pgTable(
  "continuity_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id").notNull().references(() => scenesTable.id, { onDelete: "cascade" }),
    takeId: uuid("take_id").notNull().references(() => takesTable.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    entity: text("entity").notNull(),
    expectedState: text("expected_state").notNull(),
    observedState: text("observed_state").notNull(),
    severity: text("severity").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
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
    index("continuity_issues_take_idx").on(table.takeId),
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