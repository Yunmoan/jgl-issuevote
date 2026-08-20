import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { loadEnv } from '../env';

loadEnv();

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const migrationPath = resolve(__dirname, '../../migrations/001_init.sql');
  const sql = readFileSync(migrationPath, 'utf8');
  const connection = await mysql.createConnection({
    uri: databaseUrl,
    multipleStatements: true,
    timezone: 'Z'
  });

  try {
    await connection.query(sql);
    console.log('Migration completed: 001_init.sql');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
