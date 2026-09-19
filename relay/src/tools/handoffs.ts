import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { checkIdempotency, hashPayload } from "../idempotency.js";
import { ensureProject, recordEvent } from "../projects.js";
import type { AuthenticatedAgent } from "../auth.js";

export const publishHandoffSchema = z.object({
  project_id: z.string().min(1),
  to_agent_id: z.string().min(1).optional(),
  source_session_id: z.string().min(1).optional(),
  objective: z.string().optional(),
  current_state: z.record(z.unknown()).optional(),
  decisions_made: z.array(z.unknown()).optional(),
  important_context: z.record(z.unknown()).optional(),
  unresolved_questions: z.array(z.unknown()).optional(),
  files_refs: z.array(z.unknown()).optional(),
  raw_transcript_ref: z.string().optional(),
  // Handoffs are immutable, so a proposal that gets reconsidered just
  // sits there with no link to what replaced it. This is that link --
  // mechanical pointer, no claim about which one was "right".
  supersedes: z.string().optional(),
  idempotency_key: z.string().min(1),
});

export const getHandoffSchema = z.object({ handoff_id: z.string().min(1) });

export const listHandoffsSchema = z.object({
  project_id: z.string().min(1),
  limit: z.number().int().positive().max(200).optional(),
  before: z.string().datetime().optional(),
});

export async function publishHandoff(
  caller: AuthenticatedAgent,
  input: z.infer<typeof publishHandoffSchema>
) {
  const requestHash = hashPayload(input);

  return withTransaction(async (client) => {
    const existing = await checkIdempotency(
      client,
      "handoffs",
      "handoff_id",
      caller.agentId,
      input.idempotency_key,
      requestHash
    );
    if (existing) {
      return { handoff_id: existing.handoff_id, replayed: true };
    }

    await ensureProject(client, input.project_id);

    const result = await client.query(
      `insert into handoffs
         (idempotency_key, request_hash, project_id, from_agent_id, to_agent_id,
          source_session_id, objective, current_state, decisions_made,
          important_context, unresolved_questions, files_refs, raw_transcript_ref,
          supersedes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       returning handoff_id`,
      [
        input.idempotency_key,
        requestHash,
        input.project_id,
        caller.agentId,
        input.to_agent_id ?? null,
        input.source_session_id ?? null,
        input.objective ?? null,
        JSON.stringify(input.current_state ?? {}),
        JSON.stringify(input.decisions_made ?? []),
        JSON.stringify(input.important_context ?? {}),
        JSON.stringify(input.unresolved_questions ?? []),
        JSON.stringify(input.files_refs ?? []),
        input.raw_transcript_ref ?? null,
        input.supersedes ?? null,
      ]
    );

    const handoffId = result.rows[0].handoff_id;

    await recordEvent(client, input.project_id, caller.agentId, "handoff.published", {
      handoff_id: handoffId,
      to_agent_id: input.to_agent_id ?? null,
    });

    return { handoff_id: handoffId, replayed: false };
  });
}

export async function getHandoff(input: z.infer<typeof getHandoffSchema>) {
  const result = await pool.query(`select * from handoffs where handoff_id = $1`, [
    input.handoff_id,
  ]);
  if (result.rowCount === 0) {
    throw new Error("handoff not found");
  }
  return result.rows[0];
}

export async function listHandoffs(input: z.infer<typeof listHandoffsSchema>) {
  const limit = input.limit ?? 50;
  const params: unknown[] = [input.project_id];
  let cursorClause = "";
  if (input.before) {
    params.push(input.before);
    cursorClause = `and created_at < $${params.length}`;
  }
  params.push(limit);

  const result = await pool.query(
    `select * from handoffs
      where project_id = $1 ${cursorClause}
      order by created_at desc
      limit $${params.length}`,
    params
  );

  return {
    handoffs: result.rows,
    next_cursor: result.rows.length === limit ? result.rows[result.rows.length - 1].created_at : null,
  };
}
