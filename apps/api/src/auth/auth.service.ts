import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { DatabaseService } from '../db/database.service';
import { nowSql } from '../db/sql-time';
import type { Provider, Viewer } from '../types';

const SESSION_COOKIE = 'jgl_session';
const NYK_STATE_COOKIE = 'nyk_oauth_state';

@Injectable()
export class AuthService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  providers() {
    return {
      feishu: {
        enabled: process.env.FEISHU_ENABLED === 'true',
        autoLogin: process.env.FEISHU_ENABLED === 'true'
      },
      natayarkid: {
        enabled: process.env.NYK_ENABLED !== 'false',
        authorizationUrl: process.env.NYK_OAUTH_AUTHORIZATION_URL || 'https://account.naids.com/oauth2/authorize'
      },
      devLogin: process.env.NODE_ENV !== 'production'
    };
  }

  async viewerFromRequest(req: Request): Promise<Viewer | null> {
    const token = req.cookies?.[SESSION_COOKIE] || this.bearerToken(req);
    if (!token) return null;

    try {
      const payload = jwt.verify(token, this.sessionSecret()) as { sub: string };
      return await this.getViewer(payload.sub);
    } catch {
      return null;
    }
  }

  async requireViewer(req: Request): Promise<Viewer> {
    const viewer = await this.viewerFromRequest(req);
    if (!viewer || viewer.status !== 'active') {
      throw new UnauthorizedException('需要登录');
    }
    return viewer;
  }

  async getViewer(userId: string): Promise<Viewer> {
    const user = await this.db.first(
      `SELECT id, display_name, avatar_url, email, status
       FROM users
       WHERE id = :id`,
      { id: userId }
    );
    if (!user) throw new UnauthorizedException('用户不存在');

    const groups = await this.db.rows(
      `SELECT pg.group_key
       FROM user_group_memberships ugm
       JOIN permission_groups pg ON pg.id = ugm.group_id
       WHERE ugm.user_id = :userId
       ORDER BY pg.group_key`,
      { userId }
    );
    const identities = await this.db.rows(
      `SELECT provider FROM auth_identities WHERE user_id = :userId`,
      { userId }
    );

    return {
      id: String(user.id),
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      email: user.email,
      status: user.status,
      groups: groups.map((row) => row.group_key),
      boundProviders: identities.map((row) => row.provider as Provider)
    };
  }

  issueAccessBlocker(viewer: Viewer | null) {
    const requireFeishu = process.env.AUTH_REQUIRE_FEISHU_FOR_DATA_ACCESS === 'true';
    const requireNyk = process.env.AUTH_REQUIRE_NATAYARKID_FOR_DATA_ACCESS === 'true';
    if (!viewer) return null;
    if (requireFeishu && !viewer.boundProviders.includes('feishu')) return 'bind_feishu_required';
    if (requireNyk && !viewer.boundProviders.includes('natayarkid')) return 'bind_natayarkid_required';
    return null;
  }

  async devLogin(res: Response) {
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedException('生产环境不可使用开发登录');
    }
    const userId = await this.ensureUser({
      displayName: '开发管理员',
      email: 'dev-admin@jgl.local',
      provider: 'natayarkid',
      providerSubject: 'dev-admin',
      providerUserId: 'dev-admin',
      groups: ['member', 'council', 'issue_creator', 'admin', 'auditor'],
      rawProfile: { dev: true }
    });
    this.setSession(res, String(userId));
    return this.getViewer(String(userId));
  }

  async startNatayarkId(res: Response) {
    const clientId = requiredEnv('NYK_OAUTH_CLIENT_ID');
    const redirectUri = requiredEnv('NYK_OAUTH_REDIRECT_URI');
    const authorizationUrl = process.env.NYK_OAUTH_AUTHORIZATION_URL || 'https://account.naids.com/oauth2/authorize';
    const state = randomBytes(24).toString('hex');
    res.cookie(NYK_STATE_COOKIE, state, cookieOptions(10 * 60 * 1000));

    const url = new URL(authorizationUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async handleNatayarkIdCallback(req: Request, res: Response) {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code || !state || state !== req.cookies?.[NYK_STATE_COOKIE]) {
      throw new UnauthorizedException('NatayarkID state 校验失败');
    }

    const clientId = requiredEnv('NYK_OAUTH_CLIENT_ID');
    const clientSecret = requiredEnv('NYK_OAUTH_CLIENT_SECRET');
    const redirectUri = requiredEnv('NYK_OAUTH_REDIRECT_URI');
    const tokenUrl = process.env.NYK_OAUTH_TOKEN_URL || 'https://account.naids.com/api/oauth2/token';
    const userInfoUrl = process.env.NYK_OAUTH_USERINFO_URL || 'https://account.naids.com/api/api/user/data';

    const hashedSecret = await bcrypt.hash(clientSecret, 10);
    const tokenResponse = await axios.post(tokenUrl, {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: hashedSecret,
      redirect_uri: encodeURIComponent(redirectUri)
    });
    const accessToken = tokenResponse.data?.access_token || tokenResponse.data?.data?.access_token;
    if (!accessToken) throw new UnauthorizedException('NatayarkID 未返回 access_token');

    const profileResponse = await axios.get(userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = profileResponse.data?.data;
    if (!data?.id) throw new UnauthorizedException('NatayarkID 用户信息缺少 id');

    const userId = await this.ensureUser({
      displayName: data.username || data.email || `NYK-${data.id}`,
      email: data.email || null,
      provider: 'natayarkid',
      providerSubject: String(data.id),
      providerUserId: String(data.id),
      groups: ['member'],
      rawProfile: profileResponse.data
    });
    this.setSession(res, String(userId));
    res.clearCookie(NYK_STATE_COOKIE);
    return this.getViewer(String(userId));
  }

  async loginWithFeishuCode(code: string, res: Response) {
    const appId = requiredEnv('FEISHU_APP_ID');
    const appSecret = requiredEnv('FEISHU_APP_SECRET');
    const appTokenResponse = await axios.post('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      app_id: appId,
      app_secret: appSecret
    });
    const appAccessToken = appTokenResponse.data?.app_access_token;
    if (!appAccessToken) throw new UnauthorizedException('飞书 app_access_token 获取失败');

    const tokenResponse = await axios.post(
      'https://open.feishu.cn/open-apis/authen/v1/access_token',
      { grant_type: 'authorization_code', code },
      { headers: { Authorization: `Bearer ${appAccessToken}` } }
    );
    const userAccessToken = tokenResponse.data?.data?.access_token;
    if (!userAccessToken) throw new UnauthorizedException('飞书 user_access_token 获取失败');

    const userResponse = await axios.get('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      headers: { Authorization: `Bearer ${userAccessToken}` }
    });
    const user = userResponse.data?.data;
    const subject = user?.union_id || user?.open_id || user?.user_id;
    if (!subject) throw new UnauthorizedException('飞书用户信息缺少稳定 ID');

    this.assertAllowedFeishuTenant(user?.tenant_key);
    const userId = await this.ensureUser({
      displayName: user.name || user.en_name || '飞书用户',
      email: user.email || null,
      avatarUrl: user.avatar_url || null,
      provider: 'feishu',
      providerSubject: String(subject),
      providerUserId: user.user_id || null,
      openId: user.open_id || null,
      unionId: user.union_id || null,
      tenantKey: user.tenant_key || null,
      groups: ['member'],
      rawProfile: userResponse.data
    });
    this.setSession(res, String(userId));
    return this.getViewer(String(userId));
  }

  logout(res: Response) {
    res.clearCookie(SESSION_COOKIE);
    return { ok: true };
  }

  private async ensureUser(input: {
    displayName: string;
    email: string | null;
    avatarUrl?: string | null;
    provider: Provider;
    providerSubject: string;
    providerUserId?: string | null;
    openId?: string | null;
    unionId?: string | null;
    tenantKey?: string | null;
    groups: string[];
    rawProfile: unknown;
  }) {
    const existing = await this.db.first(
      `SELECT user_id FROM auth_identities WHERE provider = :provider AND provider_subject = :subject`,
      { provider: input.provider, subject: input.providerSubject }
    );
    const now = nowSql();
    let userId = existing?.user_id;
    if (!userId) {
      const created = await this.db.exec(
        `INSERT INTO users (display_name, avatar_url, email, status, primary_provider, last_login_at, created_at, updated_at)
         VALUES (:displayName, :avatarUrl, :email, 'active', :provider, :now, :now, :now)`,
        {
          displayName: input.displayName,
          avatarUrl: input.avatarUrl || null,
          email: input.email,
          provider: input.provider,
          now
        }
      );
      userId = created.insertId;
      await this.db.exec(
        `INSERT INTO auth_identities
         (user_id, provider, provider_subject, tenant_key, open_id, union_id, provider_user_id, email, display_name, avatar_url, raw_profile_json, linked_at, last_used_at)
         VALUES (:userId, :provider, :subject, :tenantKey, :openId, :unionId, :providerUserId, :email, :displayName, :avatarUrl, :profile, :now, :now)`,
        {
          userId,
          provider: input.provider,
          subject: input.providerSubject,
          tenantKey: input.tenantKey || null,
          openId: input.openId || null,
          unionId: input.unionId || null,
          providerUserId: input.providerUserId || null,
          email: input.email,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl || null,
          profile: JSON.stringify(input.rawProfile),
          now
        }
      );
    } else {
      await this.db.exec(
        `UPDATE users SET display_name = :displayName, avatar_url = :avatarUrl, email = :email, last_login_at = :now, updated_at = :now WHERE id = :userId`,
        { userId, displayName: input.displayName, avatarUrl: input.avatarUrl || null, email: input.email, now }
      );
      await this.db.exec(
        `UPDATE auth_identities
         SET email = :email, display_name = :displayName, avatar_url = :avatarUrl, raw_profile_json = :profile, last_used_at = :now
         WHERE provider = :provider AND provider_subject = :subject`,
        {
          provider: input.provider,
          subject: input.providerSubject,
          email: input.email,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl || null,
          profile: JSON.stringify(input.rawProfile),
          now
        }
      );
    }

    for (const groupKey of input.groups) {
      await this.db.exec(
        `INSERT IGNORE INTO user_group_memberships (user_id, group_id, source, created_at)
         SELECT :userId, id, 'system', :now FROM permission_groups WHERE group_key = :groupKey`,
        { userId, groupKey, now }
      );
    }
    return userId;
  }

  private setSession(res: Response, userId: string) {
    const token = jwt.sign({ sub: userId }, this.sessionSecret(), { expiresIn: '14d' });
    res.cookie(SESSION_COOKIE, token, cookieOptions(14 * 24 * 60 * 60 * 1000));
  }

  private sessionSecret() {
    return process.env.SESSION_SECRET || 'dev-session-secret';
  }

  private bearerToken(req: Request) {
    const authorization = req.header('authorization');
    if (!authorization?.startsWith('Bearer ')) return null;
    return authorization.slice('Bearer '.length);
  }

  private assertAllowedFeishuTenant(tenantKey: string | null | undefined) {
    const allowed = (process.env.FEISHU_ALLOWED_TENANT_KEYS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (allowed.length > 0 && (!tenantKey || !allowed.includes(tenantKey))) {
      throw new UnauthorizedException('飞书组织不在允许范围内');
    }
  }
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge
  };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new UnauthorizedException(`缺少环境变量 ${name}`);
  return value;
}
