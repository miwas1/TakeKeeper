import { createSign } from "node:crypto";
import { env } from "../../config/env";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type CachedToken = { value: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

function base64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function serviceAccount(): ServiceAccount {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("Google Agent Engine credentials are not configured");
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error("Google Agent Engine credentials are malformed");
  }
  if (!parsed || typeof parsed !== "object" || !("client_email" in parsed) || !("private_key" in parsed)) {
    throw new Error("Google Agent Engine credentials are incomplete");
  }
  return parsed as ServiceAccount;
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const credentials = serviceAccount();
  const tokenUri = credentials.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key, "base64url")}`;
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Google authentication failed (${response.status})`);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("Google authentication returned no access token");
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

export const agentEngineConfigured = Boolean(
  env.GOOGLE_CLOUD_PROJECT && env.AGENT_ENGINE_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON,
);

/**
 * Calls the deployed Vertex AI Agent Engine. When AGENT_ENGINE_ID is set this
 * is a required runtime hop; callers must not silently fall back on failure.
 */
export async function queryAgentEngine(input: Record<string, unknown>) {
  if (!env.GOOGLE_CLOUD_PROJECT || !env.AGENT_ENGINE_ID) {
    throw new Error("Google Agent Engine project or engine id is not configured");
  }
  const resource = `projects/${env.GOOGLE_CLOUD_PROJECT}/locations/${env.GOOGLE_CLOUD_LOCATION}/reasoningEngines/${env.AGENT_ENGINE_ID}`;
  const response = await fetch(
    `https://${env.GOOGLE_CLOUD_LOCATION}-aiplatform.googleapis.com/v1beta1/${resource}:query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input, classMethod: env.AGENT_ENGINE_CLASS_METHOD }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("x-guploader-uploadid");
    throw new Error(`Agent Engine query failed (${response.status}${requestId ? `, request ${requestId}` : ""})`);
  }
  const payload = await response.json() as { output?: unknown };
  if (!("output" in payload)) throw new Error("Agent Engine returned no output");
  return payload.output;
}
