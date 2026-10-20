import "dotenv/config";

// src/configs/oauth.providers.ts
export const providers = {
  monday: {
    authorizeUrl: "https://auth.monday.com/oauth2/authorize",
    tokenUrl: "https://auth.monday.com/oauth2/token",
    clientId: process.env.MONDAY_CLIENT_ID!,
    clientSecret: process.env.MONDAY_CLIENT_SECRET!,
    scopes: "boards:read boards:write",
    extraParams: {},
  },
  jira: {
    authorizeUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    clientId: process.env.JIRA_CLIENT_ID!,
    clientSecret: process.env.JIRA_CLIENT_SECRET!,
    scopes: "read:jira-work write:jira-work offline_access",
    extraParams: { audience: "api.atlassian.com", prompt: "consent" },
  },
} as const;

export type Provider = keyof typeof providers;
