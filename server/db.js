import pg from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;

let pool = null;
let schemaReadyPromise = null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "db", "schema.sql");

function createPool() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env before starting the server."
    );
  }

  return new Pool({
    connectionString,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : undefined,
  });
}

export function getPool() {
  if (!pool) {
    pool = createPool();
  }

  return pool;
}

export async function query(text, values) {
  return getPool().query(text, values);
}

export async function ensureDatabaseSchema(client = null) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const schemaSql = await readFile(SCHEMA_PATH, "utf8");
      const executor = client || getPool();
      await executor.query(schemaSql);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
}

export async function withTransaction(work) {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failures and rethrow the original error.
    }

    throw error;
  } finally {
    client.release();
  }
}
