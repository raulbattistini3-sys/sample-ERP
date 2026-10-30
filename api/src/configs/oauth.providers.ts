import "dotenv/config";

// src/configs/oauth.providers.ts
export const providers = {
  // scopes must be exactly the app's requiredScopes (app-hsmeta.json), or HubSpot refuses the consent screen
  hubspot: {
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubspot.com/oauth/2026-09/token",
    clientId: process.env.HUBSPOT_CLIENT_ID!,
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET!,
    scopes: "crm.objects.tickets.read crm.objects.tickets.write crm.objects.contacts.read",
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
