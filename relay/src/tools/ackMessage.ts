import { z } from "zod";
import { withTransaction } from "../db.js";
import { recordEvent } from "../projects.js";
import type { AuthenticatedAgent } from "../auth.js";

export const ackMessageSchema = z.object({
  message_id: z.string().min(1),
  state: z.enum(["pulled", "acknowledged"]),
});

export type AckMessageInput = z.infer<typeof ackMessageSchema>;

export async function ackMessage(caller: AuthenticatedAgent, input: AckMessageInput) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `update message_receipts
          set state = $1, updated_at = now()
        where message_id = $2 and agent_id = $3
      returning message_id`,
      [input.state, input.message_id, caller.agentId]
    );

    if (result.rowCount === 0) {
      throw new Error("no receipt found for this agent/message");
    }

    const messageResult = await client.query(
      `select project_id from messages where message_id = $1`,
      [input.message_id]
    );

    await recordEvent(
      client,
      messageResult.rows[0].project_id,
      caller.agentId,
      "receipt.updated",
      { message_id: input.message_id, state: input.state }
    );

    return { ok: true };
  });
}
