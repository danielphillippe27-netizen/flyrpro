import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  timestamp,
  pgTable,
  text,
  primaryKey,
  integer,
  uuid,
} from "drizzle-orm/pg-core"
import type { AdapterAccountType } from "next-auth/adapters"
 
// Editor projects table - stores canvas designs
export const editorProjects = pgTable("editor_project", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  userId: uuid("userId").notNull(),
    // References auth.users from Supabase (foreign key handled at DB level)
  json: text("json").notNull(),
  height: integer("height").notNull(),
  width: integer("width").notNull(),
  thumbnailUrl: text("thumbnailUrl"),
  isTemplate: boolean("isTemplate").default(false),
  isPro: boolean("isPro").default(false),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
});

export const editorProjectsRelations = relations(editorProjects, ({ one }) => ({
  // Relation to user will be handled via Supabase auth.users
}));

export const editorProjectsInsertSchema = createInsertSchema(editorProjects);

