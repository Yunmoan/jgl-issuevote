# Linux 部署说明

## 目标环境

- OS：Linux x86_64。
- Node.js：建议 LTS 版本。
- 数据库：MariaDB / MySQL 5.7。
- 缓存：Redis。
- 反向代理：Nginx 或 Caddy。

## 数据库兼容要求

由于目标不是 MySQL 8，且 MariaDB 与 MySQL 5.7 在 JSON、全文索引、部分 SQL 细节上并不完全一致，开发和部署必须遵守：

- 不使用原生 JSON 类型，JSON 数据用 `LONGTEXT` 保存。
- 不使用 `DATETIME(3)`，时间精度到秒。
- 不依赖 `DEFAULT CURRENT_TIMESTAMP` 和 `ON UPDATE CURRENT_TIMESTAMP`，由后端写入时间字段。
- 不使用 MySQL 8 专属能力。
- 字符集默认 `utf8mb4`。

## 推荐部署拓扑

```text
Nginx/Caddy
  |
  +-- /          -> Web 静态文件
  +-- /api       -> API Node.js 进程
  +-- /uploads   -> 附件静态目录或对象存储代理

API Node.js
  +-- MariaDB / MySQL 5.7
  +-- Redis
```

## 环境变量

生产环境至少配置：

```env
NODE_ENV=production
APP_URL=https://vote.example.com
API_URL=https://vote.example.com/api
DATABASE_URL=mysql://user:password@127.0.0.1:3306/jgl_issuevote
REDIS_URL=redis://127.0.0.1:6379/0
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

## 发布步骤

1. 构建前端静态文件。
2. 构建后端 Node.js 产物。
3. 执行 SQL migration。
4. 执行 seed。
5. 启动 API 进程，建议用 systemd 或 PM2。
6. 配置反向代理和 HTTPS。
7. 检查 `/api/health`。
8. 分别测试飞书免登、NatayarkID 登录、权限组可见性和投票流程。

## Nginx 示例

```nginx
server {
  listen 443 ssl http2;
  server_name vote.example.com;

  root /var/www/jgl-issuevote/web;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3000/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```
