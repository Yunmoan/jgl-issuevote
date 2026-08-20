# 冀高联理事会投票系统文档索引

本文档集用于把项目拆给多个 agent 或开发者并行实现。当前仓库为空项目，因此文档先固定一套可落地的基线架构；后续如已选定其它后端框架，可保留业务模型和接口语义，替换工程实现。

## 建议技术栈

- 前端：Vue 3、TypeScript、Vite、Naive UI、Pinia、Vue Router、VueUse。
- 后端：NestJS、TypeScript、TypeORM 或 Knex、mysql2、MariaDB / MySQL 5.7、Redis。
- 鉴权：应用内 Session/JWT + OAuth2 身份绑定；飞书网页应用免登；NatayarkID 按 `account.naids.com` OAuth2 接入。
- 部署：Docker Compose 起步，生产环境拆分为 Web、API、MySQL、Redis、对象存储/附件服务。

## 文档阅读顺序

1. [系统架构](./01-system-architecture.md)
2. [数据库设计](./02-database-schema.md)
3. [认证、绑定与权限](./03-auth-and-permission.md)
4. [API 设计](./04-api-design.md)
5. [前端 UI 与交互](./05-frontend-ui.md)
6. [管理后台与运营能力](./06-admin-and-operations.md)
7. [多 agent 协作拆分](./07-agent-work-breakdown.md)
8. [Linux 非 Docker 部署说明](./08-linux-deployment.md)

## 关键产品原则

- 议题像 GitHub Issues：列表、分类、状态、评论、订阅、历史记录都要清晰。
- 投票像理事会事务：可追溯、可审计、可导出，不能只做一个简单按钮。
- 身份像组织系统：飞书和 NatayarkID 可以任选启用，也可以要求绑定后查看数据。
- UI 像内部工作台：克制、清楚、移动端可用，使用 Naive UI 的组件语言和蓝色主题，不做营销页。

## 外部资料

- 飞书网页应用免登示例说明：<https://open.feishu.cn/document/quickly-create-a-login-free-web-app/introduction-to-sample-code>
- 飞书网页应用配置说明：<https://open.feishu.cn/document/uYjL24iN/uMTMuMTMuMTM/development-guide/step1>
- 飞书获取用户访问凭证：<https://open.feishu.cn/document/server-docs/authentication-management/access-token/create-2>
- 飞书客户端 getUserInfo：<https://open.feishu.cn/document/client-docs/gadget/-web-app-api/open-ability/userinfo/getuserinfo>
- Naive UI：<https://www.naiveui.com/>
