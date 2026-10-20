import type { TypedDocumentString } from "./gql/graphql";
import { MONDAY_API_VERSION } from "./monday.version";

export const MONDAY_API_URL = "https://api.monday.com/v2";

// auth: token revoked or app uninstalled (connect again); rate_limit: complexity budget / rate limit
// (retry later); request: our query or values were refused (message says why); server: monday failed
export type MondayErrorKind = "auth" | "rate_limit" | "request" | "server";

export class MondayApiError extends Error {
  constructor(
    message: string,
    readonly kind: MondayErrorKind,
  ) {
    super(message);
    this.name = "MondayApiError";
  }
}

const AUTH_CODES = new Set(["NOT_AUTHENTICATED", "UNAUTHORIZED", "USER_UNAUTHORIZED", "INVALID_TOKEN"]);
const RATE_CODES = new Set(["COMPLEXITY_BUDGET_EXHAUSTED", "RATE_LIMIT_EXCEEDED", "IP_RATE_LIMIT_EXCEEDED", "MAX_CONCURRENCY_EXCEEDED", "ComplexityException"]);

// One typed GraphQL call to monday. monday answers most errors with HTTP 200 and an `errors` array
// (older ones with error_code/error_message), so both are inspected, not just the status code.
export async function mondayRequest<TResult, TVariables>(
  options: { apiUrl: string; token: string; fetch: typeof fetch },
  document: TypedDocumentString<TResult, TVariables>,
  variables: TVariables,
): Promise<TResult> {
  const response = await options.fetch(options.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: options.token,
      "API-Version": MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query: document.toString(), variables }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: TResult;
    errors?: { message: string; extensions?: { code?: string } }[];
    error_code?: string;
    error_message?: string;
  };

  const codes = [...(body.errors ?? []).map((e) => e.extensions?.code ?? ""), body.error_code ?? ""];
  const message = [...(body.errors ?? []).map((e) => e.message), body.error_message].filter(Boolean).join("; ");
  if (response.status === 401 || codes.some((c) => AUTH_CODES.has(c))) {
    throw new MondayApiError(message || "monday rejected the token", "auth");
  }
  if (response.status === 429 || codes.some((c) => RATE_CODES.has(c))) {
    throw new MondayApiError(message || "monday rate limit reached", "rate_limit");
  }
  if (response.status >= 500) throw new MondayApiError(message || `monday HTTP ${response.status}`, "server");
  if (message || !body.data) throw new MondayApiError(message || `monday HTTP ${response.status} without data`, "request");
  return body.data;
}
