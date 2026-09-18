import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/scripts -> ../../migrations (repo-root/relay/migrations)
const migrationsDir = join(__dirname, "..", "..", "migrations");

async function main() {
  await pool.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const already = await pool.query(
      `select 1 from schema_migrations where filename = $1`,
      [file]
    );
    if (already.rowCount && already.rowCount > 0) {
      console.log(`skip (already applied): ${file}`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`applying: ${file}`);
    await pool.query(sql);
    await pool.query(`insert into schema_migrations (filename) values ($1)`, [file]);
  }

  console.log("migrations complete");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
