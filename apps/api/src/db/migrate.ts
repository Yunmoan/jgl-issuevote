import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { loadEnv } from '../env';

loadEnv();

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const migrationsDir = resolve(__dirname, '../../migrations');
  const migrations = readdirSync(migrationsDir).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  const connection = await mysql.createConnection({
    uri: databaseUrl,
    multipleStatements: true,
    timezone: 'Z'
  });

  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [appliedRows] = await connection.query<mysql.RowDataPacket[]>(`SELECT name FROM schema_migrations`);
    const applied = new Set(appliedRows.map((row) => String(row.name)));
    for (const migration of migrations) {
      if (applied.has(migration)) continue;
      await connection.query(readFileSync(resolve(migrationsDir, migration), 'utf8'));
      await connection.execute(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, UTC_TIMESTAMP())`, [migration]);
      console.log(`Migration completed: ${migration}`);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
