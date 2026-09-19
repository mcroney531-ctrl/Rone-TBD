import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { recordEvent } from "../projects.js";
import type { AuthenticatedAgent } from "../auth.js";

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

/**
 * Flips this caller's own pending receipts to pulled among the given
 * message ids -- get_inbox isn't the only path a message can actually
 * reach an agent through. Without this, an agent that reads exclusively
 * via get_thread/get_message (a reasonable, even preferred, pattern)
 * would leave every one of its receipts stuck at "pending" forever.
 */
async function markPulledForCaller(
  client: import("pg").PoolClient,
  callerAgentId: string,
  messageIds: string[]
) {
  if (messageIds.length === 0) return;
  const result = await client.query(
    `update message_receipts
        set state = 'pulled', updated_at = now()
      where agent_id = $1 and message_id = any($2::text[]) and state = 'pending'
    returning message_id, (select project_id from messages where messages.message_id = message_receipts.message_id) as project_id`,
    [callerAgentId, messageIds]
  );
  for (const row of result.rows) {
    await recordEvent(client, row.project_id, callerAgentId, "receipt.updated", {
      message_id: row.message_id,
      state: "pulled",
    });
  }
}

export async function getThread(caller: AuthenticatedAgent, input: z.infer<typeof getThreadSchema>) {
  return withTransaction(async (client) => {
    const messagesResult = await client.query(
      `select message_id, project_id, thread_id, reply_to, from_agent_id,
              to_agent_id, broadcast, body, seq, created_at
         from messages
        where thread_id = $1
        order by created_at asc`,
      [input.thread_id]
    );

    const messageIds = messagesResult.rows.map((r) => r.message_id as string);
    await markPulledForCaller(client, caller.agentId, messageIds);

    const receiptsResult = await client.query(
      `select message_id, agent_id, state, updated_at
         from message_receipts
        where message_id = any($1::text[])`,
      [messageIds]
    );
    const resolution = await client.query(
      `select resolved_by_agent_id, resolved_at, decision_ref from thread_resolutions where thread_id = $1`,
      [input.thread_id]
    );

    return {
      messages: messagesResult.rows.map((m) => ({
        ...m,
        seq: Number(m.seq),
        receipts: receiptsResult.rows.filter((r) => r.message_id === m.message_id),
      })),
      resolved: resolution.rowCount ? resolution.rows[0] : null,
    };
  });
}

export async function getMessage(caller: AuthenticatedAgent, input: z.infer<typeof getMessageSchema>) {
  return withTransaction(async (client) => {
    const messageResult = await client.query(
      `select message_id, project_id, thread_id, reply_to, from_agent_id,
              to_agent_id, broadcast, body, seq, created_at
         from messages
        where message_id = $1`,
      [input.message_id]
    );
    if (messageResult.rowCount === 0) {
      throw new Error("message not found");
    }

    await markPulledForCaller(client, caller.agentId, [input.message_id]);

    const receipts = await receiptsFor([input.message_id]);
    const m = messageResult.rows[0];
    return { ...m, seq: Number(m.seq), receipts };
  });
}

export async function resolveThread(
  callerAgentId: string,
  input: z.infer<typeof resolveThreadSchema>
) {
  return withTransaction(async (client) => {
    const projectResult = await client.query(
      `select project_id from messages where thread_id = $1 limit 1`,
      [input.thread_id]
    );
    if (projectResult.rowCount === 0) {
      throw new Error("thread not found");
    }
    const projectId = projectResult.rows[0].project_id;

    await client.query(
      `insert into thread_resolutions (thread_id, resolved_by_agent_id, decision_ref)
       values ($1, $2, $3::jsonb)
       on conflict (thread_id) do update
         set resolved_by_agent_id = excluded.resolved_by_agent_id,
             resolved_at = now(),
             decision_ref = excluded.decision_ref`,
      [input.thread_id, callerAgentId, input.decision_ref ? JSON.stringify(input.decision_ref) : null]
    );

    // This was a silent mutation before -- resolving a thread is exactly
    // the kind of thing the events feed exists to capture.
    await recordEvent(client, projectId, callerAgentId, "thread.resolved", {
      thread_id: input.thread_id,
      decision_ref: input.decision_ref ?? null,
    });

    return { ok: true };
  });
}
