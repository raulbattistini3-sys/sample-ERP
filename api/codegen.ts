import type { CodegenConfig } from "@graphql-codegen/cli";

// Typed monday.com GraphQL operations: reads the pinned API schema and the graphql() documents in
// src/integrations/monday, and writes src/integrations/monday/gql (committed; run `bun run monday:codegen`
// after changing an operation). documentMode "string": operations are plain strings at runtime, so
// there is no GraphQL client dependency.
const config: CodegenConfig = {
  schema: "src/integrations/monday/schema.2026-07.graphql",
  documents: ["src/integrations/monday/**/*.ts", "!src/integrations/monday/gql/**"],
  ignoreNoDocuments: false,
  generates: {
    "src/integrations/monday/gql/": {
      preset: "client",
      presetConfig: { fragmentMasking: false },
      config: {
        documentMode: "string",
        enumsAsTypes: true,
        useTypeImports: true,
        scalars: { ID: "string", JSON: "unknown", Date: "string", ISO8601DateTime: "string" },
      },
    },
  },
};

export default config;
