# 认证、绑定与权限

## 登录源开关

系统必须支持以下组合：

- 仅启用飞书：适合组织内使用，飞书 OA 自动登录。
- 仅启用 NatayarkID：适合外部浏览器或统一身份平台。
- 两者都启用：用户可任选其一登录，并在个人中心绑定另一个身份。
- 强制绑定：允许飞书免登进入系统，但查看受限数据前必须绑定 NatayarkID；或允许 NatayarkID 登录后必须绑定飞书并通过组织校验。

建议配置项：

```json
{
  "auth.enabledProviders": ["feishu", "natayarkid"],
  "auth.requireAnyProvider": true,
  "auth.requireFeishuForDataAccess": false,
  "auth.requireNatayarkIdForDataAccess": false,
  "auth.allowAccountBinding": true,
  "feishu.allowedTenantKeys": [],
  "feishu.allowedDepartmentIds": [],
  "feishu.allowedUserIds": []
}
```

`allowedTenantKeys` 为空表示不校验企业租户；生产环境如只允许一个组织，必须配置白名单。

## 飞书网页应用免登

根据飞书官方示例，网页应用前端需要在飞书客户端环境中通过 JSAPI 获取临时授权码 code，服务端再使用 App ID/App Secret 获取应用访问凭证，并用 code 换取用户访问凭证和用户信息。飞书文档同时提示，普通客户端 `getUserInfo` 对网页应用可取字段有限；需要 open_id、user_access_token 或敏感字段时应走服务端免登流程。

流程：

1. 前端检测 `window.h5sdk` 和飞书 WebView 环境。
2. 前端调用飞书 JSAPI `requestAccess` 或兼容方法取得临时 code。
3. 前端 POST `/api/auth/feishu/code`，只传 code，不传 App Secret。
4. 后端缓存 `app_access_token`。
5. 后端调用飞书接口用 code 换取 `user_access_token`。
6. 后端获取飞书用户信息，生成或绑定本地 `users`。
7. 后端校验 `tenant_key`、部门、可用范围等组织规则。
8. 后端签发本系统登录态。

注意：

- code 只能短时使用，服务端失败后前端应重新取 code。
- App Secret 只存在后端环境变量。
- 飞书 user_id/open_id/union_id 含义不同，`auth_identities.provider_subject` 建议优先使用 `union_id`，没有时使用 `open_id`。
- 如果需要组织架构校验，应申请通讯录相关权限，并处理飞书权限范围不足的错误。

参考资料：

- 飞书网页应用免登示例：<https://open.feishu.cn/document/quickly-create-a-login-free-web-app/introduction-to-sample-code>
- 飞书网页应用配置：<https://open.feishu.cn/document/uYjL24iN/uMTMuMTMuMTM/development-guide/step1>
- 飞书获取用户访问凭证：<https://open.feishu.cn/document/server-docs/authentication-management/access-token/create-2>
- 飞书客户端 getUserInfo 限制：<https://open.feishu.cn/document/client-docs/gadget/-web-app-api/open-ability/userinfo/getuserinfo>

## NatayarkID OAuth2

NatayarkID 使用 OAuth2 授权码流程。按当前接入指南，固定端点如下：

| 类别 | URL | 方法 |
| --- | --- | --- |
| authorizationURL | `https://account.naids.com/oauth2/authorize` | GET |
| tokenURL | `https://account.naids.com/api/oauth2/token` | POST |
| userDataURL | `https://account.naids.com/api/api/user/data` | GET |

环境变量建议：

```env
NYK_OAUTH_AUTHORIZATION_URL=https://account.naids.com/oauth2/authorize
NYK_OAUTH_TOKEN_URL=https://account.naids.com/api/oauth2/token
NYK_OAUTH_USERINFO_URL=https://account.naids.com/api/api/user/data
NYK_OAUTH_CLIENT_ID=
NYK_OAUTH_CLIENT_SECRET=
NYK_OAUTH_REDIRECT_URI=https://example.com/api/auth/natayarkid/callback
```

流程：

1. 用户点击 NatayarkID 登录。
2. 后端生成 `state`，写入短期缓存。
3. 浏览器跳转到 `authorizationURL`：

```text
https://account.naids.com/oauth2/authorize?response_type=code&redirect_uri=${urlEncodedRedirectUri}&client_id=${clientId}&state=${state}
```

4. NatayarkID 回调：

```text
${redirect_uri}?code=CODE&state=STATE
```

5. 后端校验 `state`。
6. 后端将 `client_secret` 做 `PASSWORD_HASH` 后请求 token。Node.js 实现建议使用 bcrypt，等价于 PHP `password_hash($secret, PASSWORD_DEFAULT)` 的 bcrypt 结果。
7. 后端 POST JSON 到 `tokenURL`：

```json
{
  "grant_type": "authorization_code",
  "code": "CODE",
  "client_id": "example",
  "client_secret": "$2y$10$oQfDIqchgv9xv5UVUo9QNeM7fhqDJj69lZsbU3pPA9NOa0kLgohuS",
  "redirect_uri": "https%3A%2F%2Fexample.com%2Fauth%2Fcallback"
}
```

8. 后端使用返回的 `access_token` 请求用户信息：

```http
GET https://account.naids.com/api/api/user/data
Authorization: Bearer ${accessToken}
```

9. 用户信息返回示例字段包括 `data.id`、`data.username`、`data.email`、`data.realname`、`data.status`、`data.last_login`。
10. 创建或绑定 `auth_identities(provider='natayarkid')`。

字段映射：

- `provider_subject`：使用 `data.id` 的字符串形式。
- `provider_user_id`：使用 `data.id` 的字符串形式。
- `display_name`：优先 `data.username`。
- `email`：使用 `data.email`。
- `raw_profile_json`：保存完整返回 JSON 字符串。

注意：

- `redirect_uri` 在授权请求和 token 请求中必须一致；按当前指南，token 请求体内也传 URL 编码后的值。
- `client_secret` 不直接明文传给 NatayarkID token 接口，而是传 PASSWORD_HASH 结果。
- `state` 必须校验，防止 CSRF 和登录串号。
- 当前指南未说明 OIDC、ID Token 或 refresh_token，因此不要按 OIDC 强校验实现。

## 账号绑定策略

绑定入口：

- 个人中心绑定另一个身份。
- 登录后触发强制绑定页。
- 管理员手动合并账号。

绑定冲突处理：

- 如果外部身份未绑定任何本地用户，直接绑定当前用户。
- 如果外部身份已绑定当前用户，返回成功。
- 如果外部身份已绑定另一个用户，禁止自动合并，进入管理员处理流程。
- 管理员合并时必须写审计日志，且保留两个身份源的历史记录。

## 权限模型

### 系统权限

建议后端以能力点控制：

- `issue.read.public`
- `issue.read.login`
- `issue.read.group`
- `issue.create`
- `issue.update.any`
- `issue.close`
- `issue.vote`
- `comment.create`
- `comment.moderate`
- `admin.users`
- `admin.groups`
- `admin.settings`
- `audit.read`

### 判断顺序

1. 用户是否登录。
2. 用户状态是否 `active`。
3. 是否满足强制绑定策略。
4. Issue 可见性是否允许访问。
5. 如果 Issue 是 `groups`，用户是否属于 `issue_view_groups` 至少一个组。
6. 对投票操作，用户是否属于 `issue_vote_groups` 至少一个组，且在投票窗口内。
7. 对管理操作，用户是否属于 `admin` 或对应能力组。

### 公开可见与登录可见

- `public`：未登录可看议题正文和已公开评论；不能评论和投票。
- `login`：任意登录用户可看；是否能投票看投票组。
- `groups`：只有指定查看组可看；不应在列表 API 泄露标题。

## 登录态建议

- Web 端使用 HttpOnly、Secure、SameSite=Lax Cookie。
- API 返回 `/api/me` 用于前端恢复用户状态。
- 管理员操作要求短期内活跃登录；高风险操作可增加二次确认。
- Token、第三方 refresh_token 如需存储，必须加密后落库。
