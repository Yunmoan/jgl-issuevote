# 冀高联议事投票系统

Issue 风格的理事会议题与投票系统，支持 Naive UI 蓝色主题、移动端/PC 自适应、飞书网页应用免登、NatayarkID OAuth2、权限组可见性、评论统一公布时间和投票审计。

## 技术栈

- Web：Vue 3、Vite、TypeScript、Naive UI、Pinia、Vue Router。
- API：NestJS、TypeScript、mysql2。
- 数据库：MariaDB / MySQL 5.7 兼容 SQL。

## 本地启动

1. 安装依赖：

```bash
npm install
```

2. 启动数据库：

```bash
docker compose up -d mariadb redis
```

首次启动会自动执行 `apps/api/migrations/001_init.sql`。

3. 复制并按需修改环境变量：

```bash
cp .env.example .env
```

4. 启动 API：

```bash
npm run dev:api
```

5. 启动 Web：

```bash
npm run dev:web
```

默认地址：

- Web：<http://localhost:5173>
- API：<http://localhost:3000/api/health>

开发环境可使用“开发登录”进入系统，默认账号拥有管理员、理事会成员和议题创建权限。

## 常用命令

```bash
npm run typecheck
npm run build
```

## 文档

系统架构、数据库、认证、API、UI 和多 agent 拆分说明见 [docs/README.md](./docs/README.md)。

