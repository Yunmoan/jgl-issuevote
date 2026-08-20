import { BadGatewayException, BadRequestException, Inject, Injectable } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../db/database.service';
import { nowSql } from '../db/sql-time';
import type { Viewer } from '../types';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

type FeishuDepartment = {
  open_department_id?: string;
  name?: string;
  parent_department_id?: string;
  leader_user_id?: string;
  leaders?: Array<{ leader_id?: string; leader_type?: string }>;
  member_count?: number;
};

@Injectable()
export class FeishuOrganizationService {
  private tenantToken: { value: string; expiresAt: number } | null = null;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async syncAllDepartments(actor: Viewer) {
    const token = await this.tenantAccessToken();
    const departments = await this.departments(token);
    let created = 0;
    let updated = 0;
    for (const department of departments) {
      const result = await this.upsertDepartment(department);
      if (result.created) created += 1;
      else updated += 1;
    }
    await this.audit(actor.id, 'feishu.department.sync', 'permission_group', 'feishu_departments', {
      synced: departments.length,
      created,
      updated
    });
    return { synced: departments.length, created, updated };
  }

  async syncUserDepartments(userId: string, openId: string) {
    const token = await this.tenantAccessToken();
    const user = await this.feishuGet<{ user?: { department_ids?: unknown } }>(
      `/contact/v3/users/${encodeURIComponent(openId)}`,
      token,
      { user_id_type: 'open_id', department_id_type: 'open_department_id' }
    );
    const departmentIds = uniqueDepartmentIds(user.user?.department_ids);
    const groupIds: string[] = [];
    for (const departmentId of departmentIds) {
      const group = await this.departmentGroup(departmentId, token);
      groupIds.push(String(group.group_id));
      await this.db.exec(
        `INSERT IGNORE INTO user_group_memberships (user_id, group_id, source, created_at)
         VALUES (:userId, :groupId, 'feishu_org', :now)`,
        { userId, groupId: group.group_id, now: nowSql() }
      );
    }
    await this.removeStaleUserDepartments(userId, groupIds);
    return { departmentIds, synced: groupIds.length };
  }

  private async tenantAccessToken() {
    if (process.env.FEISHU_ENABLED !== 'true') throw new BadRequestException('飞书登录未启用，无法同步部门');
    if (this.tenantToken && this.tenantToken.expiresAt > Date.now()) return this.tenantToken.value;
    const appId = requiredFeishuEnv('FEISHU_APP_ID');
    const appSecret = requiredFeishuEnv('FEISHU_APP_SECRET');
    try {
      const response = await axios.post(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
        app_id: appId,
        app_secret: appSecret
      }, { timeout: 10_000 });
      const token = response.data?.tenant_access_token;
      if (!token) throw new BadGatewayException(feishuMessage(response.data) || '飞书 tenant_access_token 获取失败');
      const expiresIn = Math.max(60, Number(response.data?.expire) || 7_200);
      this.tenantToken = { value: String(token), expiresAt: Date.now() + (expiresIn - 60) * 1_000 };
      return this.tenantToken.value;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(`飞书 tenant_access_token 获取失败${feishuErrorMessage(error)}`);
    }
  }

  private async departments(token: string) {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    do {
      const data = await this.feishuGet<{ items?: FeishuDepartment[]; has_more?: boolean; page_token?: string }>(
        '/contact/v3/departments',
        token,
        {
          department_id: '0',
          department_id_type: 'open_department_id',
          fetch_child: 'true',
          page_size: 50,
          ...(pageToken ? { page_token: pageToken } : {})
        }
      );
      for (const department of data.items || []) {
        const id = String(department.open_department_id || '').trim();
        if (id) ids.add(id);
      }
      pageToken = data.has_more && data.page_token ? data.page_token : undefined;
    } while (pageToken);
    return this.departmentDetails([...ids], token);
  }

  private async departmentGroup(departmentId: string, token: string) {
    const existing = await this.db.first(
      `SELECT fdg.group_id FROM feishu_department_groups fdg WHERE fdg.department_id = :departmentId`,
      { departmentId }
    );
    if (existing) return existing;
    const [department] = await this.departmentDetails([departmentId], token);
    if (!department?.open_department_id) throw new BadGatewayException('飞书部门信息缺少 open_department_id');
    await this.upsertDepartment(department);
    const group = await this.db.first(
      `SELECT fdg.group_id FROM feishu_department_groups fdg WHERE fdg.department_id = :departmentId`,
      { departmentId }
    );
    if (!group) throw new BadGatewayException('飞书部门权限组创建失败');
    return group;
  }

  private async departmentDetails(departmentIds: string[], token: string) {
    const all = new Map<string, FeishuDepartment>();
    for (const ids of chunks([...new Set(departmentIds)], 50)) {
      if (!ids.length) continue;
      const data = await this.feishuGet<{ items?: FeishuDepartment[] }>(
        '/contact/v3/departments/batch',
        token,
        { department_ids: ids, department_id_type: 'open_department_id' }
      );
      for (const department of data.items || []) {
        const id = String(department.open_department_id || '').trim();
        if (id) all.set(id, department);
      }
    }
    return [...all.values()];
  }

  private async upsertDepartment(department: FeishuDepartment) {
    const departmentId = String(department.open_department_id || '').trim();
    if (!departmentId) throw new BadGatewayException('飞书部门信息缺少 open_department_id');
    const name = truncate(String(department.name || departmentId).trim(), 80);
    const parentDepartmentId = department.parent_department_id ? String(department.parent_department_id) : null;
    const now = nowSql();
    const mapping = await this.db.first(
      `SELECT group_id FROM feishu_department_groups WHERE department_id = :departmentId`,
      { departmentId }
    );
    let groupId = mapping ? String(mapping.group_id) : null;
    if (!groupId) {
      const groupKey = `feishu_dept_${createHash('sha256').update(departmentId).digest('hex').slice(0, 32)}`;
      const result = await this.db.exec(
        `INSERT INTO permission_groups (group_key, name, description, kind, is_assignable, created_at, updated_at)
         VALUES (:groupKey, :name, :description, 'feishu_org', FALSE, :now, :now)`,
        { groupKey, name, description: departmentDescription(department), now }
      );
      groupId = String(result.insertId);
      await this.db.exec(
        `INSERT INTO feishu_department_groups (department_id, group_id, department_name, parent_department_id, synced_at)
         VALUES (:departmentId, :groupId, :name, :parentDepartmentId, :now)`,
        { departmentId, groupId, name, parentDepartmentId, now }
      );
      return { groupId, created: true };
    }
    await this.db.exec(
      `UPDATE permission_groups
       SET name = :name, description = :description, kind = 'feishu_org', is_assignable = FALSE, updated_at = :now
       WHERE id = :groupId`,
      { groupId, name, description: departmentDescription(department), now }
    );
    await this.db.exec(
      `UPDATE feishu_department_groups
       SET department_name = :name, parent_department_id = :parentDepartmentId, synced_at = :now
       WHERE department_id = :departmentId`,
      { departmentId, name, parentDepartmentId, now }
    );
    return { groupId, created: false };
  }

  private async removeStaleUserDepartments(userId: string, groupIds: string[]) {
    const params: Record<string, unknown> = { userId };
    const placeholders = groupIds.map((groupId, index) => {
      const key = `groupId${index}`;
      params[key] = groupId;
      return `:${key}`;
    });
    const exclusion = placeholders.length ? `AND ugm.group_id NOT IN (${placeholders.join(', ')})` : '';
    await this.db.exec(
      `DELETE ugm FROM user_group_memberships ugm
       JOIN feishu_department_groups fdg ON fdg.group_id = ugm.group_id
       WHERE ugm.user_id = :userId AND ugm.source = 'feishu_org' ${exclusion}`,
      params
    );
  }

  private async feishuGet<T>(path: string, token: string, params: Record<string, string | number | boolean | string[]>) {
    try {
      const response = await axios.get(`${FEISHU_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
        paramsSerializer: { indexes: null },
        timeout: 10_000
      });
      if (Number(response.data?.code || 0) !== 0) {
        throw new BadGatewayException(feishuMessage(response.data) || '飞书通讯录接口请求失败');
      }
      return (response.data?.data || {}) as T;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(`飞书通讯录接口请求失败${feishuErrorMessage(error)}`);
    }
  }

  private async audit(actorId: string, action: string, targetType: string, targetId: string, metadata: unknown) {
    await this.db.exec(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (:actorId, :action, :targetType, :targetId, :metadata, :now)`,
      { actorId, action, targetType, targetId, metadata: JSON.stringify(metadata), now: nowSql() }
    );
  }
}

function uniqueDepartmentIds(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter((id) => id && id !== '0'))];
}

function truncate(value: string, limit: number) {
  return value.length > limit ? value.slice(0, limit) : value;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function departmentDescription(department: FeishuDepartment) {
  const departmentId = truncate(String(department.open_department_id || ''), 180);
  const details = [`飞书部门（${departmentId}）`];
  if (Number.isInteger(Number(department.member_count))) details.push(`成员 ${Number(department.member_count)}`);
  const leaderId = department.leader_user_id || department.leaders?.map((leader) => leader.leader_id).find(Boolean);
  if (leaderId) details.push(`负责人 ${truncate(String(leaderId), 60)}`);
  return truncate(details.join(' · '), 300);
}

function requiredFeishuEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new BadRequestException(`缺少环境变量 ${name}`);
  return value;
}

function feishuMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  for (const key of ['msg', 'message']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim().slice(0, 240);
  }
  return null;
}

function feishuErrorMessage(error: unknown) {
  if (!axios.isAxiosError(error)) return '';
  const message = feishuMessage(error.response?.data);
  return message ? `：${message}` : '';
}
