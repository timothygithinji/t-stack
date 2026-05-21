{{#if neon}}
import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
{{/if}}
{{#if turso}}
import { sqliteTable, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
{{/if}}
