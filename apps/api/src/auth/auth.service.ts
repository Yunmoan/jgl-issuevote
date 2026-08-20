import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { DatabaseService } from '../db/database.service';
import { nowSql } from '../db/sql-time';
import type { Provider, Viewer } from '../types';

const SESSION_COOKIE = 'jgl_session';
const DEFAULT_FEISHU_WEB_SDK_URL = 'https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.48.js';
const REMOVED_FEISHU_WEB_SDK_URL = 'https://lf1-cdn-tos.bytegoofy.com/goofy/ee/lark/open/jsdk/jssdk-1.0.1.js';
const NYK_STATE_COOKIE = 'nyk_oauth_state';
const NYK_LINK_USER_COOKIE = 'nyk_oauth_link_user';

@Injectable()
export class AuthService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  providers() {
    return {
      feishu: {
        enabled: process.env.FEISHU_ENABLED === 'true',
        autoLogin: process.env.FEISHU_ENABLED === 'true' && Boolean(process.env.FEISHU_APP_ID),
        appId: process.env.FEISHU_ENABLED === 'true' ? process.env.FEISHU_APP_ID || null : null,
        sdkUrl: feishuWebSdkUrl()
      },
      natayarkid: {
        enabled: this.natayarkIdEnabled(),
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
      `SELECT u.id, u.display_name, COALESCE(NULLIF(u.avatar_url, ''), NULLIF(feishu_identity.avatar_url, '')) AS avatar_url,
              COALESCE(u.email, feishu_identity.email) AS email, u.status
       FROM users u
       LEFT JOIN auth_identities feishu_identity
         ON feishu_identity.user_id = u.id AND feishu_identity.provider = 'feishu'
       WHERE u.id = :id`,
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

  async startNatayarkId(res: Response, linkUserId?: string) {
    this.assertNatayarkIdEnabled();
    const clientId = requiredEnv('NYK_OAUTH_CLIENT_ID');
    const redirectUri = requiredEnv('NYK_OAUTH_REDIRECT_URI');
    const authorizationUrl = process.env.NYK_OAUTH_AUTHORIZATION_URL || 'https://account.naids.com/oauth2/authorize';
    const state = randomBytes(24).toString('hex');
    res.cookie(NYK_STATE_COOKIE, state, cookieOptions(10 * 60 * 1000));
    if (linkUserId) res.cookie(NYK_LINK_USER_COOKIE, linkUserId, cookieOptions(10 * 60 * 1000));
    else res.clearCookie(NYK_LINK_USER_COOKIE);

    const url = new URL(authorizationUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async handleNatayarkIdCallback(req: Request, res: Response) {
    this.assertNatayarkIdEnabled();
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

    const hashedSecret = await natayarkPasswordHash(clientSecret);
    let tokenResponse;
    try {
      // The live NatayarkID token endpoint parses form data. Pass the raw
      // callback URL here: URLSearchParams performs the only wire encoding.
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: hashedSecret,
        redirect_uri: redirectUri
      });
      tokenResponse = await axios.post(tokenUrl, tokenBody, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
    } catch (error) {
      this.throwNatayarkIdRequestError('授权码换取', error);
    }
    const accessToken = tokenResponse.data?.access_token || tokenResponse.data?.data?.access_token;
    if (!accessToken) throw new UnauthorizedException('NatayarkID 未返回 access_token');

    let profileResponse;
    try {
      profileResponse = await axios.get(userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    } catch (error) {
      this.throwNatayarkIdRequestError('用户信息读取', error);
    }
    const data = profileResponse.data?.data;
    if (!data?.id) throw new UnauthorizedException('NatayarkID 用户信息缺少 id');

    const identity = {
      displayName: data.username || data.email || `NYK-${data.id}`,
      email: data.email || null,
      provider: 'natayarkid',
      providerSubject: String(data.id),
      providerUserId: String(data.id),
      groups: ['member'],
      rawProfile: profileResponse.data
    } as const;
    const linkUserId = req.cookies?.[NYK_LINK_USER_COOKIE] ? String(req.cookies[NYK_LINK_USER_COOKIE]) : null;
    const userId = linkUserId ? await this.linkIdentity(linkUserId, identity) : await this.ensureUser(identity);
    this.setSession(res, String(userId));
    res.clearCookie(NYK_STATE_COOKIE);
    res.clearCookie(NYK_LINK_USER_COOKIE);
    return this.getViewer(String(userId));
  }

  async loginWithFeishuCode(code: string, res: Response) {
    if (process.env.FEISHU_ENABLED !== 'true') {
      throw new UnauthorizedException('飞书登录未启用');
    }
    const identity = await this.feishuIdentity(code);
    const userId = await this.ensureUser(identity);
    this.setSession(res, String(userId));
    return this.getViewer(String(userId));
  }

  async bindFeishuCode(code: string, targetUserId: string, res: Response) {
    const identity = await this.feishuIdentity(code);
    const userId = await this.linkIdentity(targetUserId, identity);
    this.setSession(res, String(userId));
    return this.getViewer(String(userId));
  }

  private async feishuIdentity(code: string) {
    if (process.env.FEISHU_ENABLED !== 'true') throw new UnauthorizedException('飞书登录未启用');
    const appId = requiredEnv('FEISHU_APP_ID');
    const appSecret = requiredEnv('FEISHU_APP_SECRET');
    // H5 requestAccess/requestAuthCode returns a login-free code. Feishu's
    // current Web App guide exchanges this specific code with v1 and an
    // app_access_token; it is different from the browser OAuth v3 redirect flow.
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
    return {
      displayName: user.name || user.en_name || '飞书用户',
      // email and enterprise_email require different Feishu field permissions.
      // Persist either response when it is available for the account.
      email: user.email || user.enterprise_email || null,
      avatarUrl: user.avatar_url || user.avatar_middle || user.avatar_big || user.avatar_thumb || null,
      provider: 'feishu',
      providerSubject: String(subject),
      providerUserId: user.user_id || null,
      openId: user.open_id || null,
      unionId: user.union_id || null,
      tenantKey: user.tenant_key || null,
      groups: ['member'],
      rawProfile: userResponse.data
    } as const;
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
    groups: readonly string[];
    rawProfile: unknown;
  }) {
    const existing = await this.db.first(
      `SELECT user_id FROM auth_identities WHERE provider = :provider AND provider_subject = :subject`,
      { provider: input.provider, subject: input.providerSubject }
    );
    const now = nowSql();
    let userId = existing?.user_id;
    let createdIdentity = false;

    // A provider identity always remains the primary lookup key. When it is new,
    // an exact email match on the other provider lets a user continue with one account.
    if (!userId && input.email) {
      const matchingAccount = await this.findCompatibleAccount(input.provider, input.email);
      if (matchingAccount) {
        userId = matchingAccount.id;
        await this.insertIdentity(userId, input, now);
        createdIdentity = true;
        await this.audit(String(userId), 'identity.auto_link', 'user', String(userId), {
          provider: input.provider,
          matchedBy: 'email'
        });
      }
    }
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
      await this.insertIdentity(userId, input, now);
      createdIdentity = true;
    } else {
      await this.db.exec(
        `UPDATE users
         SET display_name = :displayName,
             avatar_url = CASE WHEN :preferFeishu = 1 THEN COALESCE(:avatarUrl, avatar_url) ELSE avatar_url END,
             email = COALESCE(:email, email),
             primary_provider = CASE WHEN :preferFeishu = 1 THEN 'feishu' ELSE primary_provider END,
             last_login_at = :now,
             updated_at = :now
         WHERE id = :userId`,
        {
          userId,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl || null,
          email: input.email,
          preferFeishu: input.provider === 'feishu' ? 1 : 0,
          now
        }
      );
      if (!createdIdentity) await this.updateIdentity(input, now);
      else if (input.provider === 'feishu') await this.syncFeishuUserProfile(userId, input, now);
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

  private async findCompatibleAccount(provider: Provider, email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return null;
    return this.db.first(
      `SELECT ai.user_id AS id
       FROM auth_identities ai
       WHERE ai.provider <> :provider
         AND LOWER(ai.email) = :email
         AND NOT EXISTS (
           SELECT 1 FROM auth_identities same_provider
           WHERE same_provider.user_id = ai.user_id AND same_provider.provider = :provider
         )
       ORDER BY ai.last_used_at DESC, ai.linked_at DESC
       LIMIT 1`,
      { provider, email: normalizedEmail }
    );
  }

  private async insertIdentity(userId: string | number, input: {
    displayName: string; email: string | null; avatarUrl?: string | null; provider: Provider; providerSubject: string;
    providerUserId?: string | null; openId?: string | null; unionId?: string | null; tenantKey?: string | null; rawProfile: unknown;
  }, now: string) {
    await this.db.exec(
      `INSERT INTO auth_identities
       (user_id, provider, provider_subject, tenant_key, open_id, union_id, provider_user_id, email, display_name, avatar_url, raw_profile_json, linked_at, last_used_at)
       VALUES (:userId, :provider, :subject, :tenantKey, :openId, :unionId, :providerUserId, :email, :displayName, :avatarUrl, :profile, :now, :now)`,
      {
        userId, provider: input.provider, subject: input.providerSubject, tenantKey: input.tenantKey || null,
        openId: input.openId || null, unionId: input.unionId || null, providerUserId: input.providerUserId || null,
        email: input.email, displayName: input.displayName, avatarUrl: input.avatarUrl || null,
        profile: JSON.stringify(input.rawProfile), now
      }
    );
  }

  private async updateIdentity(input: {
    displayName: string; email: string | null; avatarUrl?: string | null; provider: Provider; providerSubject: string; rawProfile: unknown;
  }, now: string) {
    await this.db.exec(
      `UPDATE auth_identities
       SET email = :email, display_name = :displayName, avatar_url = :avatarUrl, raw_profile_json = :profile, last_used_at = :now
       WHERE provider = :provider AND provider_subject = :subject`,
      { provider: input.provider, subject: input.providerSubject, email: input.email, displayName: input.displayName, avatarUrl: input.avatarUrl || null, profile: JSON.stringify(input.rawProfile), now }
    );
  }

  private async linkIdentity(userId: string, input: {
    displayName: string; email: string | null; avatarUrl?: string | null; provider: Provider; providerSubject: string;
    providerUserId?: string | null; openId?: string | null; unionId?: string | null; tenantKey?: string | null; groups: readonly string[]; rawProfile: unknown;
  }) {
    await this.getViewer(userId);
    const existing = await this.db.first(
      `SELECT user_id FROM auth_identities WHERE provider = :provider AND provider_subject = :subject`,
      { provider: input.provider, subject: input.providerSubject }
    );
    if (existing && String(existing.user_id) !== String(userId)) throw new ConflictException('该身份已绑定到其他账户');
    const now = nowSql();
    if (existing) {
      await this.db.exec(
        `UPDATE auth_identities SET email = :email, display_name = :displayName, avatar_url = :avatarUrl, raw_profile_json = :profile, last_used_at = :now
         WHERE provider = :provider AND provider_subject = :subject`,
        { provider: input.provider, subject: input.providerSubject, email: input.email, displayName: input.displayName, avatarUrl: input.avatarUrl || null, profile: JSON.stringify(input.rawProfile), now }
      );
    } else {
      await this.db.exec(
        `INSERT INTO auth_identities
         (user_id, provider, provider_subject, tenant_key, open_id, union_id, provider_user_id, email, display_name, avatar_url, raw_profile_json, linked_at, last_used_at)
         VALUES (:userId, :provider, :subject, :tenantKey, :openId, :unionId, :providerUserId, :email, :displayName, :avatarUrl, :profile, :now, :now)`,
        { userId, provider: input.provider, subject: input.providerSubject, tenantKey: input.tenantKey || null, openId: input.openId || null, unionId: input.unionId || null, providerUserId: input.providerUserId || null, email: input.email, displayName: input.displayName, avatarUrl: input.avatarUrl || null, profile: JSON.stringify(input.rawProfile), now }
      );
    }
    if (input.provider === 'feishu') await this.syncFeishuUserProfile(userId, input, now);
    await this.audit(userId, 'identity.bind', 'auth_identity', `${input.provider}:${input.providerSubject}`, { provider: input.provider });
    return userId;
  }

  private async syncFeishuUserProfile(userId: string | number, input: { displayName: string; email: string | null; avatarUrl?: string | null }, now: string) {
    await this.db.exec(
      `UPDATE users
       SET display_name = :displayName,
           avatar_url = COALESCE(:avatarUrl, avatar_url),
           email = COALESCE(:email, email),
           primary_provider = 'feishu',
           last_login_at = :now,
           updated_at = :now
       WHERE id = :userId`,
      { userId, displayName: input.displayName, avatarUrl: input.avatarUrl || null, email: input.email, now }
    );
  }

  private async audit(actorId: string, action: string, targetType: string, targetId: string, metadata: unknown) {
    await this.db.exec(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (:actorId, :action, :targetType, :targetId, :metadata, :now)`,
      { actorId, action, targetType, targetId, metadata: JSON.stringify(metadata), now: nowSql() }
    );
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

  private throwNatayarkIdRequestError(operation: string, error: unknown): never {
    if (axios.isAxiosError(error) && error.response?.status && error.response.status < 500) {
      const detail = natayarkErrorDetail(error.response.data);
      throw new UnauthorizedException(
        `NatayarkID ${operation}失败${detail ? `：${detail}` : '，授权已失效或配置不匹配，请重新发起登录'}`
      );
    }
    throw new UnauthorizedException(`NatayarkID ${operation}服务暂时不可用，请稍后重试`);
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

  private natayarkIdEnabled() {
    return process.env.NYK_ENABLED?.trim().toLowerCase() !== 'false';
  }

  private assertNatayarkIdEnabled() {
    if (!this.natayarkIdEnabled()) throw new ForbiddenException('NatayarkID 登录未启用');
  }
}

async function natayarkPasswordHash(secret: string) {
  const hash = await bcrypt.hash(secret, 10);
  // bcryptjs emits $2a$, while Natayark requires the PHP PASSWORD_HASH
  // identifier $2y$. The digest and salt remain unchanged.
  if (!/^\$2[ab]\$/.test(hash)) throw new Error('无法生成兼容的 NatayarkID bcrypt 密文');
  return `$2y$${hash.slice(4)}`;
}

function natayarkErrorDetail(payload: unknown) {
  if (!payload || typeof payload !== 'object') return typeof payload === 'string' ? payload.slice(0, 240) : null;
  const data = payload as Record<string, unknown>;
  for (const key of ['error_description', 'message', 'error']) {
    if (typeof data[key] === 'string' && data[key].trim()) return data[key].trim().slice(0, 240);
  }
  return null;
}

function feishuWebSdkUrl() {
  const configured = process.env.FEISHU_WEB_SDK_URL?.trim();
  // This former default now returns 404. Treat it as unset so inherited .env
  // files are repaired by an application restart rather than failing forever.
  return !configured || configured === REMOVED_FEISHU_WEB_SDK_URL
    ? DEFAULT_FEISHU_WEB_SDK_URL
    : configured;
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
