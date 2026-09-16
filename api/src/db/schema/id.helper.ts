import { varchar } from "drizzle-orm/mysql-core";
import { randomUUID } from "crypto";

export const uuidPk = () =>
  varchar("id", { length: 36 }).primaryKey().$defaultFn(() => randomUUID());
