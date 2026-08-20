import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPool, Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool: Pool;

  constructor() {
    const uri = process.env.DATABASE_URL || 'mysql://jgl:password@127.0.0.1:3306/jgl_issuevote';
    this.pool = createPool({
      uri,
      connectionLimit: 10,
      namedPlaceholders: true,
      timezone: 'Z'
    });
  }

  async rows<T extends RowDataPacket = RowDataPacket>(sql: string, params: Record<string, unknown> = {}) {
    const [rows] = await this.pool.query<T[]>(sql, params as any);
    return rows;
  }

  async first<T extends RowDataPacket = RowDataPacket>(sql: string, params: Record<string, unknown> = {}) {
    const rows = await this.rows<T>(sql, params);
    return rows[0] ?? null;
  }

  async exec(sql: string, params: Record<string, unknown> = {}) {
    const [result] = await this.pool.execute<ResultSetHeader>(sql, params as any);
    return result;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
