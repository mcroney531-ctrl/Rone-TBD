import { z } from "zod";
import { withTransaction } from "../db.js";
import { recordEvent } from "../projects.js";
import type { AuthenticatedAgent } from "../auth.js";

export const getInboxSchema = z.object({
  project_id: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export type GetInboxInput = z.infer<typeof getInboxSchema>;

/**
 * Correctness boundary is receipt state (pending/pulled), not seq —
 * Postgres sequence allocation is not commit-ordered, so seq cannot
 * safely gate "have I seen everything." This is a bounded status
 * filter: it returns whatever is still undelivered/unacknowledged,
 * regardless of insert timing.
 */
export async function getInbox(caller: AuthenticatedAgent, input: GetInboxInput) {
  const limit = input.limit ?? 50;

  return withTransaction(async (client) => {
    const params: unknown[] = [caller.agentId];
    let projectFilter = "";
    if (input.project_id) {
      params.push(input.project_id);
      projectFilter = `and m.project_id = $${params.length}`;
    }
    params.push(limit);

    const result = await client.query(
      `select m.message_id, m.project_id, m.thread_id, m.reply_to,
              m.from_agent_id, m.to_agent_id, m.broadcast, m.body,
              m.seq, m.created_at, r.state
         from message_receipts r
         join messages m on m.message_id = r.message_id
        where r.agent_id = $1
          and r.state in ('pending', 'pulled')
          ${projectFilter}
        order by m.created_at asc
        limit $${params.length}`,
      params
    );

    const pendingIds = result.rows
      .filter((r) => r.state === "pending")
      .map((r) => r.message_id as string);

    if (pendingIds.length > 0) {
      await client.query(
        `update message_receipts
            set state = 'pulled', updated_at = now()
          where agent_id = $1 and message_id = any($2::text[])`,
        [caller.agentId, pendingIds]
      );
      for (const messageId of pendingIds) {
        const row = result.rows.find((r) => r.message_id === messageId);
        await recordEvent(client, row.project_id, caller.agentId, "receipt.updated", {
          message_id: messageId,
          state: "pulled",
        });
      }
    }

    return {
      messages: result.rows.map((r) => ({
        message_id: r.message_id,
        project_id: r.project_id,
        thread_id: r.thread_id,
        reply_to: r.reply_to,
        from_agent_id: r.from_agent_id,
        to_agent_id: r.to_agent_id,
        broadcast: r.broadcast,
        body: r.body,
        seq: Number(r.seq),
        created_at: r.created_at,
        receipt_state: pendingIds.includes(r.message_id) ? "pulled" : r.state,
      })),
    };
  });
}
