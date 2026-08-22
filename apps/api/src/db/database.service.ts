import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPool, Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export interface DatabaseExecutor {
  rows<T extends RowDataPacket = RowDataPacket>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
  first<T extends RowDataPacket = RowDataPacket>(sql: string, params?: Record<string, unknown>): Promise<T | null>;
  exec(sql: string, params?: Record<string, unknown>): Promise<ResultSetHeader>;
}

class ConnectionExecutor implements DatabaseExecutor {
  constructor(private readonly connection: PoolConnection) {}

  async rows<T extends RowDataPacket = RowDataPacket>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const [rows] = await this.connection.query<T[]>(sql, params as any);
    return rows;
  }

  async first<T extends RowDataPacket = RowDataPacket>(sql: string, params: Record<string, unknown> = {}): Promise<T | null> {
    const rows = await this.rows<T>(sql, params);
    return rows[0] ?? null;
  }

  async exec(sql: string, params: Record<string, unknown> = {}) {
    const [result] = await this.connection.execute<ResultSetHeader>(sql, params as any);
    return result;
  }
}

@Injectable()
export class DatabaseService implements DatabaseExecutor, OnModuleDestroy {
  private pool: Pool;

  constructor() {
    const uri = process.env.DATABASE_URL || 'mysql://jgl:password@127.0.0.1:3306/jgl_issuevote';
    this.pool = createPool({
      uri,
      connectionLimit: 10,
      namedPlaceholders: true,
      timezone: 'Z',
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    });
  }

  async rows<T extends RowDataPacket = RowDataPacket>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const [rows] = await this.pool.query<T[]>(sql, params as any);
        return rows;
      } catch (error) {
        if (!isTransientReadConnectionError(error) || attempt >= 2) throw error;
        await delay(150 * (attempt + 1));
      }
    }
  }

  async first<T extends RowDataPacket = RowDataPacket>(sql: string, params: Record<string, unknown> = {}): Promise<T | null> {
    const rows = await this.rows<T>(sql, params);
    return rows[0] ?? null;
  }

  async exec(sql: string, params: Record<string, unknown> = {}) {
    const [result] = await this.pool.execute<ResultSetHeader>(sql, params as any);
    return result;
  }

  async transaction<T>(work: (transaction: DatabaseExecutor) => Promise<T>) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(new ConnectionExecutor(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

function isTransientReadConnectionError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
  return ['ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(code);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
