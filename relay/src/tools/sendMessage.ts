import { z } from "zod";
import { withTransaction } from "../db.js";
import { newId } from "../id.js";
import { checkIdempotency, hashPayload } from "../idempotency.js";
import { ensureProject, recordEvent } from "../projects.js";
import type { AuthenticatedAgent } from "../auth.js";

export const sendMessageSchema = z
  .object({
    project_id: z.string().min(1),
    to_agent_id: z.string().min(1).optional(),
    broadcast: z.boolean().optional(),
    reply_to: z.string().min(1).optional(),
    body: z.record(z.unknown()),
    idempotency_key: z.string().min(1),
  })
  .refine((v) => Boolean(v.to_agent_id) !== Boolean(v.broadcast), {
    message: "exactly one of to_agent_id or broadcast must be set",
  });

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export class ThreadMismatchError extends Error {
  constructor() {
    super("thread_mismatch");
  }
}

export async function sendMessage(
  caller: AuthenticatedAgent,
  input: SendMessageInput
) {
  const requestHash = hashPayload(input);

  return withTransaction(async (client) => {
    const existing = await checkIdempotency(
      client,
      "messages",
      "message_id",
      caller.agentId,
      input.idempotency_key,
      requestHash
    );
    if (existing) {
      return {
        message_id: existing.message_id,
        thread_id: existing.thread_id,
        seq: Number(existing.seq),
        replayed: true,
      };
    }

    let projectId = input.project_id;
    let threadId: string;
    const messageId = newId();

    if (input.reply_to) {
      const parentResult = await client.query(
        `select project_id, thread_id from messages where message_id = $1`,
        [input.reply_to]
      );
      if (parentResult.rowCount === 0) {
        throw new Error("reply_to message not found");
      }
      const parent = parentResult.rows[0];
      if (input.project_id && input.project_id !== parent.project_id) {
        throw new ThreadMismatchError();
      }
      projectId = parent.project_id;
      threadId = parent.thread_id;
    } else {
      threadId = messageId;
    }

    await ensureProject(client, projectId);

    await client.query(
      `insert into messages
         (message_id, idempotency_key, request_hash, project_id, thread_id,
          reply_to, from_agent_id, to_agent_id, broadcast, body)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        messageId,
        input.idempotency_key,
        requestHash,
        projectId,
        threadId,
        input.reply_to ?? null,
        caller.agentId,
        input.broadcast ? null : input.to_agent_id,
        Boolean(input.broadcast),
        JSON.stringify(input.body),
      ]
    );

    // Recipient audience is frozen at send time. For broadcast, that means
    // every currently-registered agent except the sender — future agents
    // must not retroactively inherit old broadcasts.
    let recipientIds: string[];
    if (input.broadcast) {
      const agentsResult = await client.query(
        `select agent_id from agents where agent_id != $1`,
        [caller.agentId]
      );
      recipientIds = agentsResult.rows.map((r) => r.agent_id as string);
    } else {
      recipientIds = [input.to_agent_id as string];
    }

    for (const recipientId of recipientIds) {
      await client.query(
        `insert into message_receipts (message_id, agent_id, state)
         values ($1, $2, 'pending')`,
        [messageId, recipientId]
      );
    }

    const seqResult = await client.query(
      `select seq from messages where message_id = $1`,
      [messageId]
    );

    await recordEvent(client, projectId, caller.agentId, "message.sent", {
      message_id: messageId,
      thread_id: threadId,
      to_agent_id: input.broadcast ? null : input.to_agent_id,
      broadcast: Boolean(input.broadcast),
    });

    return {
      message_id: messageId,
      thread_id: threadId,
      seq: Number(seqResult.rows[0].seq),
      replayed: false,
    };
  });
}
