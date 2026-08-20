# 系统架构

## 目标范围

系统用于冀高联理事会议题管理和投票，核心对象是 Issue。一个 Issue 可以公开展示，也可以仅登录后展示，或限制给指定权限组。登录用户可以评论，符合投票资格的用户可以投同意、不同意、弃权。创建 Issue 时可设置评论统一公布时间，未设置时评论即时公开。

## 总体模块

```text
Browser / Feishu WebView
  |
  |  HTTPS
  v
Frontend Web App (Vue 3 + Naive UI)
  |
  |  JSON API, cookie session / bearer token
  v
Backend API (NestJS)
  |        |         |
  |        |         +-- Feishu Open Platform API
  |        +------------ NatayarkID OAuth2/OIDC
  |
  +-- MySQL 8
  +-- Redis
  +-- Object Storage / local uploads
```

## 后端分层

- `AuthModule`：飞书免登、NatayarkID OAuth2、账号绑定、Session 签发、退出登录。
- `UserModule`：用户资料、用户状态、身份源、用户组归属。
- `PermissionModule`：权限组、系统角色、议题可见性和投票资格判断。
- `IssueModule`：议题 CRUD、标签、状态流转、附件、订阅。
- `CommentModule`：评论创建、编辑、删除、延时公开。
- `VoteModule`：投票、改票规则、计票、结果快照。
- `AdminModule`：用户管理、权限组管理、议题管理、系统配置。
- `AuditModule`：审计日志、敏感操作记录、导出。
- `NotificationModule`：站内通知、飞书消息推送预留。

## 前端路由

- `/`：议题列表，支持状态、标签、可见范围、关键词筛选。
- `/issues/:number`：议题详情、评论、投票面板、结果。
- `/issues/new`：创建议题，需要创建权限。
- `/me`：个人资料、身份绑定、自己的投票和评论。
- `/admin`：管理后台入口。
- `/admin/users`：用户管理。
- `/admin/groups`：权限组管理。
- `/admin/issues`：议题管理。
- `/admin/settings`：登录源、飞书组织校验、系统开关。
- `/auth/callback/:provider`：OAuth2 回调处理页。

## 状态模型

Issue 状态建议：

- `draft`：草稿，仅创建者和管理员可见。
- `open`：公开讨论中，可评论，可按设置投票。
- `voting`：投票期，强调投票入口。
- `closed`：已结束，结果固定。
- `archived`：归档，只读。

Issue 可见性建议：

- `public`：未登录也可以查看标题、正文、已公开评论和公开结果。
- `login`：任意登录用户可见。
- `groups`：只有指定权限组成员可见。

投票可见性建议：

- `counts_after_vote`：投票后可见当前统计。
- `counts_after_close`：结束后可见统计。
- `names_after_close`：结束后可见实名投票明细，仅建议理事会内部使用。
- `admin_only`：仅管理员和有审计权限的人可看明细。

## 数据一致性原则

- 一个用户对一个议题只有一条有效投票记录，靠数据库唯一索引保证。
- 改票不覆盖历史，`issue_votes` 保存当前票，`issue_vote_events` 保存每次投票事件。
- 评论延时公开不靠前端隐藏，后端查询必须过滤未到 `publish_at` 的评论。
- 权限判断统一走后端 Policy，不在各个 Controller 里散写条件。
- 议题状态、投票结果、权限变更都写入审计日志。

## 推荐工程结构

```text
apps/
  web/                    # Vue 3 + Naive UI
  api/                    # NestJS
packages/
  shared/                 # 共享类型、常量、zod schema
docs/
  *.md
docker-compose.yml
.env.example
```

如果先做最小可用版本，也可以不建 monorepo，直接 `frontend/` 和 `backend/`。但接口类型和权限常量仍建议放在共享包或由 OpenAPI 生成。

## 非功能要求

- 安全：服务端校验所有权限；登录态使用 HttpOnly Cookie；CSRF 按 SameSite 或 CSRF Token 处理。
- 审计：管理员操作、投票、改票、议题关闭必须可追溯。
- 性能：议题列表分页；标签和状态建立索引；计票可先实时聚合，必要时加结果快照。
- 可维护：配置项进数据库和环境变量，不把组织 ID、Provider 端点写死。
- 移动端：飞书 WebView、手机浏览器都应可用；PC 端使用更高信息密度。

