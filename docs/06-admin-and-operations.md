# 管理后台与运营能力

## MVP 管理功能

### 用户管理

- 查看用户列表。
- 搜索用户：名称、邮箱、飞书 open_id/union_id、NatayarkID subject。
- 启用/禁用用户。
- 查看登录来源和绑定状态。
- 分配和移除权限组。
- 手动合并账号，必须二次确认并写审计日志。

### 权限组管理

- 创建自定义组。
- 修改名称和描述。
- 给用户批量分组。
- 查看某组可见的议题。
- 系统组不可删除，只允许改描述。

### 议题管理

- 创建、编辑、关闭、重开、归档议题。
- 设置可见组和投票组。
- 设置投票窗口、是否允许改票、通过规则、法定人数。
- 设置评论统一公布时间。
- 查看投票统计和导出。

### 标签管理

- 创建标签。
- 修改颜色和描述。
- 删除未使用标签；已使用标签需确认迁移或阻止删除。

### 系统设置

- 登录源启用开关。
- 飞书 App ID、组织校验策略只展示配置状态，不展示 secret 明文。
- NatayarkID OAuth2 端点配置状态，默认使用 `https://account.naids.com`。
- 强制绑定策略。
- 评论编辑策略。
- 投票结果公开策略默认值。

### 审计日志

记录：

- 登录失败和组织校验失败。
- 账号绑定、解绑、合并。
- 用户禁用、启用、分组变更。
- 议题创建、编辑、关闭、归档。
- 评论删除、强制发布。
- 投票和改票事件。
- 系统设置变更。

## 导出能力

议题关闭后支持导出：

- 议题正文 Markdown。
- 标签、权限、时间线。
- 投票统计。
- 有权限时导出实名投票明细。
- 已公开评论。

格式：

- MVP：CSV + JSON。
- 后续：PDF 纪要、飞书文档同步。

## 通知能力

MVP 可先做站内通知，后续接飞书消息：

- 新议题创建，通知有查看权限的组。
- 投票开始/即将结束提醒。
- 评论统一公布提醒。
- 议题关闭和结果发布提醒。

飞书消息推送需要额外申请机器人或消息 API 权限，不应阻塞 MVP。

## 数据保护

- 第三方 token 加密存储。
- 审计日志不可被普通管理员物理删除。
- 导出操作写审计日志。
- 禁用用户后保留历史投票和评论，不做匿名覆盖。
- 生产环境开启 MySQL 备份，至少每日一次。

## 配置示例

`.env.example` 应包含：

```env
APP_URL=https://vote.example.com
API_URL=https://vote.example.com/api
DATABASE_URL=mysql://user:password@mysql:3306/jgl_issuevote
REDIS_URL=redis://redis:6379/0
SESSION_SECRET=change-me
TOKEN_ENCRYPTION_KEY=base64-32-byte-key

FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_ALLOWED_TENANT_KEYS=

NYK_ENABLED=true
NYK_OAUTH_AUTHORIZATION_URL=https://account.naids.com/oauth2/authorize
NYK_OAUTH_TOKEN_URL=https://account.naids.com/api/oauth2/token
NYK_OAUTH_USERINFO_URL=https://account.naids.com/api/api/user/data
NYK_OAUTH_CLIENT_ID=
NYK_OAUTH_CLIENT_SECRET=
NYK_OAUTH_REDIRECT_URI=https://vote.example.com/api/auth/natayarkid/callback
```

## 验收清单

- 未登录用户只能看到公开议题。
- 登录用户能看到登录可见议题。
- 非权限组用户完全看不到群组议题标题。
- 理事会成员能在投票窗口内投票。
- 非投票组用户可评论但不可投票。
- 评论统一公布时间生效。
- 管理员能调整用户组，并立即影响后续权限判断。
- 所有高风险操作有审计记录。
