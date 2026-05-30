import { Client } from "pg";
import "dotenv/config";

async function main() {
  console.log("=== TERMINATING ABANDONED DATABASE CONNECTIONS ===");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not configured.");
    return;
  }

  // Remove sslmode params if any for the native pg client
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("uselibpqcompat");

  const client = new Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected successfully to PostgreSQL!");

    // Query active connections
    const resCountBefore = await client.query(
      "SELECT count(*), state FROM pg_stat_activity GROUP BY state"
    );
    console.log("\nConnections count before cleanup:");
    console.table(resCountBefore.rows);

    // Terminate all connections except the current one
    const terminateRes = await client.query(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE pid <> pg_backend_pid() 
        AND usename = current_user;
    `);
    console.log(`\nTerminated ${terminateRes.rowCount} other connections!`);

    const resCountAfter = await client.query(
      "SELECT count(*), state FROM pg_stat_activity GROUP BY state"
    );
    console.log("\nConnections count after cleanup:");
    console.table(resCountAfter.rows);

  } catch (err) {
    console.error("Failed to run connection cleanup:", err);
  } finally {
    await client.end();
  }
}

main();
