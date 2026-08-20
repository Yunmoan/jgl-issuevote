import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { nowSql } from '../db/sql-time';
import type { Viewer } from '../types';

@Injectable()
export class UsersService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  requireAdmin(viewer: Viewer) {
    if (!viewer.groups.includes('admin')) throw new ForbiddenException('需要管理员权限');
  }

  async users(query: Record<string, unknown>) {
    const params: Record<string, unknown> = {};
    const conditions = ['1 = 1'];
    if (query.q) {
      conditions.push('(u.display_name LIKE :q OR u.email LIKE :q OR ai.provider_subject LIKE :q)');
      params.q = `%${String(query.q)}%`;
    }
    const rows = await this.db.rows(
      `SELECT u.id, u.display_name, u.avatar_url, u.email, u.status, u.last_login_at, u.created_at,
              GROUP_CONCAT(DISTINCT pg.group_key ORDER BY pg.group_key) AS groups,
              GROUP_CONCAT(DISTINCT ai.provider ORDER BY ai.provider) AS providers
       FROM users u
       LEFT JOIN user_group_memberships ugm ON ugm.user_id = u.id
       LEFT JOIN permission_groups pg ON pg.id = ugm.group_id
       LEFT JOIN auth_identities ai ON ai.user_id = u.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY u.id
       ORDER BY u.updated_at DESC
       LIMIT 100`,
      params
    );
    return rows.map((row) => ({
      id: String(row.id),
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      email: row.email,
      status: row.status,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      groups: row.groups ? String(row.groups).split(',') : [],
      boundProviders: row.providers ? String(row.providers).split(',') : []
    }));
  }

  async groups() {
    return this.db.rows(
      `SELECT id, group_key AS groupKey, name, description, kind, is_assignable AS isAssignable
       FROM permission_groups
       ORDER BY kind DESC, name ASC`
    );
  }

  async addGroup(userId: string, groupKey: string, actor: Viewer) {
    this.requireAdmin(actor);
    await this.db.exec(
      `INSERT IGNORE INTO user_group_memberships (user_id, group_id, source, created_at)
       SELECT :userId, id, 'manual', :now FROM permission_groups WHERE group_key = :groupKey`,
      { userId, groupKey, now: nowSql() }
    );
    await this.audit(actor.id, 'user.group.add', 'user', userId, { groupKey });
    return { ok: true };
  }

  async removeGroup(userId: string, groupKey: string, actor: Viewer) {
    this.requireAdmin(actor);
    await this.db.exec(
      `DELETE ugm FROM user_group_memberships ugm
       JOIN permission_groups pg ON pg.id = ugm.group_id
       WHERE ugm.user_id = :userId AND pg.group_key = :groupKey`,
      { userId, groupKey }
    );
    await this.audit(actor.id, 'user.group.remove', 'user', userId, { groupKey });
    return { ok: true };
  }

  async updateStatus(userId: string, status: 'active' | 'disabled' | 'pending', actor: Viewer) {
    this.requireAdmin(actor);
    await this.db.exec(`UPDATE users SET status = :status, updated_at = :now WHERE id = :userId`, {
      status,
      userId,
      now: nowSql()
    });
    await this.audit(actor.id, 'user.status.update', 'user', userId, { status });
    return { ok: true };
  }

  async settings() {
    const rows = await this.db.rows(`SELECT setting_key, setting_value, updated_at FROM system_settings ORDER BY setting_key`);
    return rows.map((row) => ({
      key: row.setting_key,
      value: safeJson(row.setting_value),
      updatedAt: row.updated_at
    }));
  }

  async setSetting(key: string, value: unknown, actor: Viewer) {
    this.requireAdmin(actor);
    await this.db.exec(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at)
       VALUES (:key, :value, :actorId, :now)
       ON DUPLICATE KEY UPDATE setting_value = :value, updated_by = :actorId, updated_at = :now`,
      { key, value: JSON.stringify(value), actorId: actor.id, now: nowSql() }
    );
    await this.audit(actor.id, 'setting.update', 'system_setting', key, { value });
    return { ok: true };
  }

  async auditLogs() {
    const rows = await this.db.rows(
      `SELECT al.id, al.action, al.target_type, al.target_id, al.metadata_json, al.created_at,
              u.display_name AS actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       ORDER BY al.created_at DESC
       LIMIT 100`
    );
    return rows.map((row) => ({
      id: String(row.id),
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: safeJson(row.metadata_json),
      createdAt: row.created_at,
      actorName: row.actor_name || '系统'
    }));
  }

  private async audit(actorId: string, action: string, targetType: string, targetId: string, metadata: unknown) {
    await this.db.exec(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (:actorId, :action, :targetType, :targetId, :metadata, :now)`,
      { actorId, action, targetType, targetId, metadata: JSON.stringify(metadata), now: nowSql() }
    );
  }
}

function safeJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
