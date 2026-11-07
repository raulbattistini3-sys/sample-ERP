import { defineConfig } from "drizzle-kit";
import { drizzleKitCredentials } from "./src/configs/database_connection";

export default defineConfig({
  schema: "./src/db/schema",
  out: "./drizzle",
  dialect: "postgresql",
  // the API's own connection rules: API_ENV=production verifies TLS with the CA certificate
  dbCredentials: drizzleKitCredentials(),
});
