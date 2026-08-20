import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
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
              GROUP_CONCAT(DISTINCT ai.provider ORDER BY ai.provider) AS providers
       FROM users u
       LEFT JOIN auth_identities ai ON ai.user_id = u.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY u.id
       ORDER BY u.updated_at DESC
       LIMIT 100`,
      params
    );
    const userIds = rows.map((row) => String(row.id));
    const memberships = userIds.length
      ? await this.db.rows(
        `SELECT ugm.user_id, pg.group_key, pg.name
         FROM user_group_memberships ugm
         JOIN permission_groups pg ON pg.id = ugm.group_id
         WHERE ugm.user_id IN (${userIds.map((_, index) => `:userId${index}`).join(', ')})
         ORDER BY pg.group_key`,
        Object.fromEntries(userIds.map((id, index) => [`userId${index}`, id]))
      )
      : [];
    const groupsByUser = new Map<string, Array<{ groupKey: string; name: string }>>();
    for (const membership of memberships) {
      const userId = String(membership.user_id);
      const groups = groupsByUser.get(userId) || [];
      groups.push({ groupKey: String(membership.group_key), name: String(membership.name) });
      groupsByUser.set(userId, groups);
    }
    return rows.map((row) => ({
      id: String(row.id),
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      email: row.email,
      status: row.status,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      groups: (groupsByUser.get(String(row.id)) || []).map((group) => group.groupKey),
      groupDetails: groupsByUser.get(String(row.id)) || [],
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

  async createGroup(input: { groupKey: string; name: string; description?: string | null; isAssignable: boolean }, actor: Viewer) {
    this.requireAdmin(actor);
    const now = nowSql();
    try {
      const result = await this.db.exec(
        `INSERT INTO permission_groups (group_key, name, description, kind, is_assignable, created_at, updated_at)
         VALUES (:groupKey, :name, :description, 'custom', :isAssignable, :now, :now)`,
        { ...input, description: input.description || null, now }
      );
      await this.audit(actor.id, 'permission_group.create', 'permission_group', input.groupKey, input);
      return { id: String(result.insertId), ...input, kind: 'custom' };
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') throw new ConflictException('权限组标识已存在');
      throw error;
    }
  }

  async updateGroup(groupKey: string, input: { name: string; description?: string | null; isAssignable: boolean }, actor: Viewer) {
    this.requireAdmin(actor);
    const row = await this.db.first(`SELECT kind FROM permission_groups WHERE group_key = :groupKey`, { groupKey });
    if (!row) throw new ConflictException('权限组不存在');
    if (row.kind !== 'custom') throw new ForbiddenException('系统权限组不可编辑');
    await this.db.exec(
      `UPDATE permission_groups SET name = :name, description = :description, is_assignable = :isAssignable, updated_at = :now WHERE group_key = :groupKey`,
      { ...input, description: input.description || null, groupKey, now: nowSql() }
    );
    await this.audit(actor.id, 'permission_group.update', 'permission_group', groupKey, input);
    return { ok: true };
  }

  async deleteGroup(groupKey: string, actor: Viewer) {
    this.requireAdmin(actor);
    const row = await this.db.first(`SELECT id, kind FROM permission_groups WHERE group_key = :groupKey`, { groupKey });
    if (!row) throw new ConflictException('权限组不存在');
    if (row.kind !== 'custom') throw new ForbiddenException('系统权限组不可删除');
    const used = await this.db.first(
      `SELECT 1 AS ok FROM user_group_memberships WHERE group_id = :groupId
       UNION SELECT 1 AS ok FROM issue_view_groups WHERE group_id = :groupId
       UNION SELECT 1 AS ok FROM issue_vote_groups WHERE group_id = :groupId LIMIT 1`,
      { groupId: row.id }
    );
    if (used) throw new ConflictException('该权限组仍被成员或议题使用，无法删除');
    await this.db.exec(`DELETE FROM permission_groups WHERE id = :groupId`, { groupId: row.id });
    await this.audit(actor.id, 'permission_group.delete', 'permission_group', groupKey, {});
    return { ok: true };
  }

  async addGroup(userId: string, groupKey: string, actor: Viewer) {
    this.requireAdmin(actor);
    const group = await this.db.first(`SELECT kind FROM permission_groups WHERE group_key = :groupKey`, { groupKey });
    if (group?.kind === 'feishu_org') throw new ForbiddenException('飞书部门权限组由飞书登录自动同步，不能手动调整');
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
    const membership = await this.db.first(
      `SELECT ugm.source FROM user_group_memberships ugm
       JOIN permission_groups pg ON pg.id = ugm.group_id
       WHERE ugm.user_id = :userId AND pg.group_key = :groupKey`,
      { userId, groupKey }
    );
    if (membership?.source === 'feishu_org') throw new ForbiddenException('飞书部门权限组由飞书登录自动同步，不能手动调整');
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
      value: row.setting_key === 'ai_review_config' ? maskedAiReviewConfig(row.setting_value) : safeJson(row.setting_value),
      updatedAt: row.updated_at
    }));
  }

  async publicSiteConfig() {
    const rows = await this.db.rows(
      `SELECT setting_key, setting_value FROM system_settings
       WHERE setting_key IN ('site_name', 'site_description', 'site_notice', 'default_issue_visibility', 'footer_text', 'watermark_mode', 'ai_review_config', 'issue_time_presets')`
    );
    const values = Object.fromEntries(rows.map((row) => [row.setting_key, safeJson(row.setting_value)]));
    const siteName = typeof values.site_name === 'string' && values.site_name.trim() ? values.site_name.trim() : '冀高联事项';
    return {
      siteName,
      siteDescription: typeof values.site_description === 'string' ? values.site_description : '',
      siteNotice: typeof values.site_notice === 'string' ? values.site_notice : '',
      defaultIssueVisibility: ['public', 'login', 'groups'].includes(String(values.default_issue_visibility)) ? values.default_issue_visibility : 'login',
      footerText: typeof values.footer_text === 'string' && values.footer_text.trim() ? values.footer_text.trim() : `版权所有 © ${new Date().getFullYear()} ${siteName}`,
      watermarkMode: ['off', 'global', 'issue'].includes(String(values.watermark_mode)) ? values.watermark_mode : 'off',
      issueReviewMode: reviewMode(values.ai_review_config),
      timePresets: normalizedTimePresets(values.issue_time_presets)
    };
  }

  async setSetting(key: string, value: unknown, actor: Viewer) {
    this.requireAdmin(actor);
    if (key === 'ai_review_config') throw new ForbiddenException('请使用 AI 预审设置接口更新该配置');
    const normalizedValue = key === 'issue_time_presets' ? validateTimePresets(value) : value;
    await this.db.exec(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at)
       VALUES (:key, :value, :actorId, :now)
       ON DUPLICATE KEY UPDATE setting_value = :value, updated_by = :actorId, updated_at = :now`,
      { key, value: JSON.stringify(normalizedValue), actorId: actor.id, now: nowSql() }
    );
    await this.audit(actor.id, 'setting.update', 'system_setting', key, { value: normalizedValue });
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

function reviewMode(value: unknown) {
  if (!value || typeof value !== 'object') return 'manual';
  const mode = (value as Record<string, unknown>).mode;
  return ['disabled', 'manual', 'ai'].includes(String(mode)) ? mode : 'manual';
}

function maskedAiReviewConfig(value: string | null) {
  const config = safeJson(value);
  if (!config || typeof config !== 'object') return { mode: 'manual', apiKeyConfigured: false };
  const { apiKey: _apiKey, ...safe } = config as Record<string, unknown>;
  return { ...safe, apiKeyConfigured: Boolean(_apiKey) };
}

const defaultTimePresets = {
  discussionShortDays: 3,
  discussionLongDays: 5,
  voteInstantMinutes: 10,
  voteShortMinutes: 60,
  voteLongMinutes: 1_440
};

function normalizedTimePresets(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultTimePresets;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(defaultTimePresets).map(([key, fallback]) => {
    const candidate = Number(source[key]);
    const minimum = key.startsWith('vote') ? 3 : 1;
    return [key, Number.isInteger(candidate) && candidate >= minimum && candidate <= 43_200 ? candidate : fallback];
  }));
}

function validateTimePresets(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('时间预设必须为对象');
  const normalized = normalizedTimePresets(value) as Record<string, number>;
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(defaultTimePresets)) {
    const candidate = Number(source[key]);
    const minimum = key.startsWith('vote') ? 3 : 1;
    if (!Number.isInteger(candidate) || candidate < minimum || candidate > 43_200) {
      throw new BadRequestException(`时间预设 ${key} 必须是 ${minimum} 到 43200 之间的整数`);
    }
  }
  if (normalized.discussionShortDays > normalized.discussionLongDays) {
    throw new BadRequestException('议题短周期不能长于长周期');
  }
  if (normalized.voteInstantMinutes > normalized.voteShortMinutes || normalized.voteShortMinutes > normalized.voteLongMinutes) {
    throw new BadRequestException('投票周期必须从即时、短周期到长周期递增');
  }
  return normalized;
}
