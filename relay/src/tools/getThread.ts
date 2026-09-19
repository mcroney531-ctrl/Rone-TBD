import { z } from "zod";
import { pool } from "../db.js";

export const getThreadSchema = z.object({
  thread_id: z.string().min(1),
});

export const getMessageSchema = z.object({
  message_id: z.string().min(1),
});

export const decisionRefSchema = z.object({
  type: z.enum(["project_state", "handoff", "message", "external"]),
  ref: z.string().min(1),
  note: z.string().optional(),
});

export const resolveThreadSchema = z.object({
  thread_id: z.string().min(1),
  // Optional structured pointer to where this thread's outcome actually
  // landed. Free text decays into "see state"/"handled above" garbage
  // fast -- this stays queryable without adding any semantic judgment.
  decision_ref: decisionRefSchema.optional(),
});

async function receiptsFor(messageIds: string[]) {
  if (messageIds.length === 0) return [];
  const result = await pool.query(
    `select message_id, agent_id, state, updated_at
       from message_receipts
      where message_id = any($1::text[])`,
    [messageIds]
  );
  return result.rows;
}

export async function getThread(input: z.infer<typeof getThreadSchema>) {
  const messagesResult = await pool.query(
    `select message_id, project_id, thread_id, reply_to, from_agent_id,
            to_agent_id, broadcast, body, seq, created_at
       from messages
      where thread_id = $1
      order by created_at asc`,
    [input.thread_id]
  );

  const receipts = await receiptsFor(messagesResult.rows.map((r) => r.message_id));
  const resolution = await pool.query(
    `select resolved_by_agent_id, resolved_at, decision_ref from thread_resolutions where thread_id = $1`,
    [input.thread_id]
  );

  return {
    messages: messagesResult.rows.map((m) => ({
      ...m,
      seq: Number(m.seq),
      receipts: receipts.filter((r) => r.message_id === m.message_id),
    })),
    resolved: resolution.rowCount ? resolution.rows[0] : null,
  };
}

export async function getMessage(input: z.infer<typeof getMessageSchema>) {
  const messageResult = await pool.query(
    `select message_id, project_id, thread_id, reply_to, from_agent_id,
            to_agent_id, broadcast, body, seq, created_at
       from messages
      where message_id = $1`,
    [input.message_id]
  );
  if (messageResult.rowCount === 0) {
    throw new Error("message not found");
  }
  const receipts = await receiptsFor([input.message_id]);
  const m = messageResult.rows[0];
  return { ...m, seq: Number(m.seq), receipts };
}

export async function resolveThread(
  callerAgentId: string,
  input: z.infer<typeof resolveThreadSchema>
) {
  await pool.query(
    `insert into thread_resolutions (thread_id, resolved_by_agent_id, decision_ref)
     values ($1, $2, $3::jsonb)
     on conflict (thread_id) do update
       set resolved_by_agent_id = excluded.resolved_by_agent_id,
           resolved_at = now(),
           decision_ref = excluded.decision_ref`,
    [input.thread_id, callerAgentId, input.decision_ref ? JSON.stringify(input.decision_ref) : null]
  );
  return { ok: true };
}
