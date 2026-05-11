import pg from "pg";

const { Pool } = pg;

let pool = null;

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
