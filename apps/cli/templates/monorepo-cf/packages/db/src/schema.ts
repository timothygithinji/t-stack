import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
