// Downloads monday.com's GraphQL schema for the pinned API version (used by `bun run monday:codegen`).
//   bun run monday:schema            -> the version in src/integrations/monday/monday.version.ts
// To move to a new version: change MONDAY_API_VERSION there, run this, then monday:codegen.
import { writeFileSync } from "node:fs";
import { MONDAY_API_VERSION } from "../src/integrations/monday/monday.version";

const url = `https://api.monday.com/v2/get_schema?format=sdl&version=${MONDAY_API_VERSION}`;
const response = await fetch(url);
if (!response.ok) {
  console.error(`could not download ${url}: HTTP ${response.status}`);
  process.exit(1);
}
const path = `src/integrations/monday/schema.${MONDAY_API_VERSION}.graphql`;
writeFileSync(path, await response.text());
console.log(`saved ${path}; update codegen.ts if the file name changed, then run bun run monday:codegen`);
