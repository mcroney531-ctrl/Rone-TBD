import { pool } from "../db.js";
import { generateToken, hashToken } from "../auth.js";

/**
 * Usage: node dist/scripts/createAgent.js <agent_id> <display_name> <claude|gpt|other> [label]
 * Prints the plaintext bearer token exactly once. The server stores only its hash.
 */
async function main() {
  const [agentId, displayName, kind, label] = process.argv.slice(2);
  if (!agentId || !displayName || !kind) {
    console.error(
      "usage: create-agent <agent_id> <display_name> <claude|gpt|other> [credential label]"
    );
    process.exit(1);
  }

  await pool.query(
    `insert into agents (agent_id, display_name, kind)
     values ($1, $2, $3)
     on conflict (agent_id) do update set display_name = excluded.display_name`,
    [agentId, displayName, kind]
  );

  const token = generateToken();
  const tokenHash = hashToken(token);

  await pool.query(
    `insert into agent_credentials (agent_id, token_hash, label)
     values ($1, $2, $3)`,
    [agentId, tokenHash, label ?? `${agentId}-initial`]
  );

  console.log(`agent_id: ${agentId}`);
  console.log(`token (save this now, it will not be shown again):`);
  console.log(token);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
