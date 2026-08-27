import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable, usersTable } from "./core";
import { screenplaySourcesTable } from "./script";

export const scenesTable = pgTable(
  "scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    scriptSourceId: uuid("script_source_id").references(() => screenplaySourcesTable.id, { onDelete: "set null" }),
    sceneNumber: text("scene_number").notNull(),
    slugline: text("slugline").notNull(),
    location: text("location").notNull().default(""),
    intExt: text("int_ext").notNull().default(""),
    timeOfDay: text("time_of_day").notNull().default(""),
    storyDay: text("story_day").notNull().default(""),
    scriptText: text("script_text"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("scenes_project_number_uidx").on(table.projectId, table.sceneNumber),
    index("scenes_project_sort_idx").on(table.projectId, table.sortOrder),
  ],
);

export const shotsTable = pgTable(
  "shots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id").notNull().references(() => scenesTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description"),
    notes: text("notes"),
    status: text("status").notNull().default("planned"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [index("shots_scene_idx").on(table.sceneId)],
);

export const takesTable = pgTable(
  "takes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shotId: uuid("shot_id").notNull().references(() => shotsTable.id, { onDelete: "cascade" }),
    takeNumber: integer("take_number").notNull(),
    status: text("status").notNull().default("unrated"),
    notes: text("notes"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    isReference: boolean("is_reference").notNull().default(false),
    isCircle: boolean("is_circle").notNull().default(false),
    referenceStatus: text("reference_status").notNull().default("none"),
    submissionKey: text("submission_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("takes_shot_number_uidx").on(table.shotId, table.takeNumber),
    uniqueIndex("takes_shot_submission_uidx").on(table.shotId, table.submissionKey),
    uniqueIndex("takes_one_reference_uidx").on(table.shotId).where(sql`${table.isReference} = true`),
    index("takes_shot_idx").on(table.shotId),
  ],
);

export const mediaTable = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    sceneId: uuid("scene_id").references(() => scenesTable.id, { onDelete: "set null" }),
    takeId: uuid("take_id").references(() => takesTable.id, { onDelete: "set null" }),
    storageKey: text("storage_key").notNull().unique(),
    mediaType: text("media_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("media_project_idx").on(table.projectId),
    index("media_scene_idx").on(table.sceneId),
    index("media_take_idx").on(table.takeId),
  ],
);

export const mediaUploadReservationsTable = pgTable(
  "media_upload_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    sceneId: uuid("scene_id").references(() => scenesTable.id, { onDelete: "set null" }),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    maxSize: integer("max_size").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("media_upload_reservation_owner_idx").on(table.userId, table.projectId),
    index("media_upload_reservation_expiry_idx").on(table.expiresAt),
  ],
);
