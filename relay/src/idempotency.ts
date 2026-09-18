import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export class IdempotencyConflict extends Error {
  constructor() {
    super("idempotency_conflict");
  }
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Looks up an existing row for (agentId, idempotencyKey) in `table`.
 * Same key + same payload hash => returns the existing row (caller re-plays it).
 * Same key + different payload hash => throws IdempotencyConflict.
 * No existing row => returns null (caller proceeds to insert).
 */
export async function checkIdempotency(
  client: PoolClient,
  table: "messages" | "handoffs",
  idColumn: string,
  agentId: string,
  idempotencyKey: string,
  requestHash: string
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `select * from ${table} where from_agent_id = $1 and idempotency_key = $2`,
    [agentId, idempotencyKey]
  );
  if (result.rowCount === 0) {
    return null;
  }
  const existing = result.rows[0];
  if (existing.request_hash !== requestHash) {
    throw new IdempotencyConflict();
  }
  return existing;
}
