import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db.js";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes32();
}

function randomBytes32(): string {
  return randomBytes(32).toString("base64url");
}

export interface AuthenticatedAgent {
  agentId: string;
  displayName: string;
  kind: string;
  credentialId: string;
}

export class AuthError extends Error {}

export async function authenticate(
  authorizationHeader: string | undefined
): Promise<AuthenticatedAgent> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new AuthError("missing_bearer_token");
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new AuthError("missing_bearer_token");
  }
  const tokenHash = hashToken(token);

  const result = await pool.query(
    `select c.credential_id, a.agent_id, a.display_name, a.kind
       from agent_credentials c
       join agents a on a.agent_id = c.agent_id
      where c.token_hash = $1
        and c.revoked_at is null`,
    [tokenHash]
  );

  if (result.rowCount === 0) {
    throw new AuthError("invalid_or_revoked_token");
  }

  const row = result.rows[0];
  await pool.query(
    `update agent_credentials set last_used_at = now() where credential_id = $1`,
    [row.credential_id]
  );

  return {
    agentId: row.agent_id,
    displayName: row.display_name,
    kind: row.kind,
    credentialId: row.credential_id,
  };
}
