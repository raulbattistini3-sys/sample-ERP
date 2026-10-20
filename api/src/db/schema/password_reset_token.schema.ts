import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";
import { randomUUID } from "crypto";

// created by drizzle/0002_password_reset_tokens.sql. Timestamps are only ever compared with now()
// in SQL (never read back), so timezone handling stays in Postgres
export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  usuarioId: varchar("usuario_id", { length: 36 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at"),
});
