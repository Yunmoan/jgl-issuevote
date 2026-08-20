# 多 agent 协作拆分

此文件用于把任务拆给多个 agent 并行推进。各 agent 应先阅读 `docs/README.md` 和自己相关文档，再动代码。

## 全局约定

- 不擅自改变技术栈；如必须改变，先更新文档并说明原因。
- 后端权限判断以服务端为准，前端只做展示。
- 涉及数据库结构变更时，同步更新 SQL 迁移、ORM 实体和 `docs/02-database-schema.md`。
- 涉及 API 变更时，同步更新 OpenAPI 或共享类型和 `docs/04-api-design.md`。
- UI 变更遵守 `docs/05-frontend-ui.md`。
- 每个模块至少提供基础测试或可运行验证步骤。

## Agent A：工程脚手架

目标：

- 创建 monorepo 或前后端目录。
- 配置 TypeScript、lint、format。
- 创建 Docker Compose：MySQL、Redis、API、Web。
- 提供 `.env.example`。
- 建立基础 CI 命令：类型检查、测试、构建。

交付：

- 项目能本地启动。
- Web 能访问 API health check。
- README 写清启动命令。

## Agent B：数据库与 ORM

目标：

- 按 `docs/02-database-schema.md` 建 TypeORM/Knex migration 和实体/查询层。
- 生成初始 SQL 迁移，必须兼容 MariaDB / MySQL 5.7，不能使用 MySQL 8 专属能力。
- 编写 seed：系统权限组、示例分类、初始管理员。
- 建索引和唯一约束。

重点：

- 投票唯一约束。
- 身份绑定唯一约束。
- 评论延时公开字段。
- 审计日志结构。

## Agent C：认证与账号绑定

目标：

- 实现飞书免登接口。
- 实现 NatayarkID OAuth2 接口，端点使用 `https://account.naids.com`。
- 实现登录态、退出、`/api/me`。
- 实现绑定策略和冲突处理。

重点：

- 飞书 App Secret 只在后端。
- NatayarkID `state` 校验，`client_secret` 按接入指南做 PASSWORD_HASH 后提交。
- 组织租户白名单。
- 强制绑定状态通过 `nextAction` 返回给前端。

## Agent D：权限系统

目标：

- 实现权限组 CRUD。
- 实现用户组分配。
- 实现 Issue 可见性 Policy。
- 实现投票资格 Policy。

重点：

- `public/login/groups` 三类可见性。
- 群组议题不可在列表泄露标题。
- 管理员可审计，不自动拥有投票资格。

## Agent E：议题、评论、投票 API

目标：

- 实现议题 CRUD、分类绑定、状态流转。
- 实现评论创建、编辑、删除、延时公开。
- 实现投票、改票、统计、导出。

重点：

- 每次投票写 `issue_vote_events`。
- 评论查询按权限过滤。
- 关闭议题后结果稳定。
- 所有变更写审计日志。

## Agent F：普通用户前端

目标：

- 实现 Naive UI 蓝色主题。
- 实现议题列表、详情、搜索筛选。
- 实现登录入口、飞书自动登录处理、绑定提示页。
- 实现评论和投票交互。

重点：

- PC 双栏、移动端单列。
- 投票窗口和权限限制要清楚展示。
- 待统一公布评论只在有权限视角显示。

## Agent G：管理后台前端

目标：

- 实现管理后台布局。
- 实现用户、权限组、分类、议题、设置、审计日志页面。
- 实现危险操作确认。

重点：

- 使用 `NDataTable` 和 `NForm`。
- 高信息密度但不拥挤。
- Secret 只展示“已配置/未配置”。

## Agent H：测试与验收

目标：

- 补充单元测试、集成测试、端到端测试。
- 覆盖权限矩阵。
- 覆盖飞书/NatayarkID mock 登录。
- 覆盖投票窗口、改票、评论延时公开。

最低验收场景：

1. 未登录用户看不到登录可见和群组可见议题。
2. 普通成员看不到仅理事会可见议题。
3. 理事会成员可以投票并改票。
4. 关闭且禁止公开明细的议题不泄露实名票。
5. 评论设置未来公布时间后，其他用户不可见。
6. 强制绑定 NatayarkID 时，飞书用户登录后不能直接看受限数据。

## 推荐开发顺序

1. Agent A 先完成脚手架。
2. Agent B、C、D 可并行，但 C/D 需共享用户和权限模型。
3. Agent E 在 B/D 基础上推进。
4. Agent F/G 可先用 mock API 开发，再切真实接口。
5. Agent H 从第一轮接口稳定后持续补测试。
