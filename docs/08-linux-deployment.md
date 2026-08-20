# Linux 非 Docker 部署说明

## 目标环境

- OS：Linux x86_64。
- Node.js：建议 LTS 版本。
- 数据库：MariaDB / MySQL 5.7。
- 反向代理：Nginx 或 Caddy。

当前应用尚未连接 Redis，非 Docker 部署不需要安装 Redis。数据库和 API 可以在同一台机器，也可以分别部署。

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
VITE_API_BASE_URL=/api
DATABASE_URL=mysql://user:password@127.0.0.1:3306/jgl_issuevote
REDIS_URL=redis://127.0.0.1:6379/0
SESSION_SECRET=change-me
TOKEN_ENCRYPTION_KEY=base64-32-byte-key

FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_ALLOWED_TENANT_KEYS=
FEISHU_WEB_SDK_URL=https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.48.js

NYK_ENABLED=true
NYK_OAUTH_AUTHORIZATION_URL=https://account.naids.com/oauth2/authorize
NYK_OAUTH_TOKEN_URL=https://account.naids.com/api/oauth2/token
NYK_OAUTH_USERINFO_URL=https://account.naids.com/api/api/user/data
NYK_OAUTH_CLIENT_ID=
NYK_OAUTH_CLIENT_SECRET=
NYK_OAUTH_REDIRECT_URI=https://vote.example.com/api/auth/natayarkid/callback
```

飞书网页应用还必须在开发者后台将实际页面地址登记到 **安全设置 > 重定向 URL**。例如站点首页为 `https://vote.example.com/` 时，应填写该完整 URL；缺失或路径不一致时，客户端无法取得免登 code。

## 目录与账号

以下命令以 Ubuntu/Debian 为例。创建一个专用的非登录用户，并将代码放在固定路径：

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin jglvote
sudo mkdir -p /opt/jgl-issuevote /var/lib/jgl-issuevote/uploads /var/www/jgl-issuevote
sudo chown -R jglvote:jglvote /opt/jgl-issuevote /var/lib/jgl-issuevote
git clone https://github.com/Yunmoan/jgl-issuevote.git /opt/jgl-issuevote
sudo chown -R jglvote:jglvote /opt/jgl-issuevote
```

安装 Node.js LTS、MariaDB/MySQL 和 Nginx。Node.js 必须同时提供 `node` 和 `npm`；构建阶段需要 npm 的开发依赖。

## 初始化数据库

以 MariaDB 为例，先建立最小权限账户。将示例密码替换为随机强密码，并同步更新环境文件中的 `DATABASE_URL`。

```sql
CREATE DATABASE jgl_issuevote CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'jgl'@'127.0.0.1' IDENTIFIED BY 'replace-with-a-strong-password';
GRANT ALL PRIVILEGES ON jgl_issuevote.* TO 'jgl'@'127.0.0.1';
FLUSH PRIVILEGES;
```

不要手工逐个导入 SQL 文件。应用的迁移命令会记录已执行文件，只执行新增迁移。

## 配置环境文件

创建 `/opt/jgl-issuevote/.env`，只允许部署用户读取：

```bash
sudo -u jglvote cp /opt/jgl-issuevote/.env.example /opt/jgl-issuevote/.env
sudo chmod 600 /opt/jgl-issuevote/.env
```

生产环境至少应设置如下值：

```env
NODE_ENV=production
PORT=3000
APP_URL=https://vote.example.com
API_URL=https://vote.example.com/api
VITE_API_BASE_URL=/api
DATABASE_URL=mysql://jgl:replace-with-a-strong-password@127.0.0.1:3306/jgl_issuevote
SESSION_SECRET=replace-with-a-long-random-secret
TOKEN_ENCRYPTION_KEY=replace-with-a-32-byte-secret
UPLOAD_DIR=/var/lib/jgl-issuevote/uploads

NYK_ENABLED=true
NYK_OAUTH_CLIENT_ID=your-client-id
NYK_OAUTH_CLIENT_SECRET=your-client-secret
NYK_OAUTH_REDIRECT_URI=https://vote.example.com/api/auth/natayarkid/callback
```

`APP_URL` 和 `NYK_OAUTH_REDIRECT_URI` 必须使用实际 HTTPS 域名。后者还必须与 NatayarkID 管理端登记的回调地址完全一致；协议、域名、路径或末尾斜杠任何一项不一致都会导致登录回调失败。`VITE_API_BASE_URL=/api` 会在 Web 构建时写入静态文件；同域反向代理部署必须在运行 `npm run build` 前设置它，不能使用本地开发的 `http://localhost:3000/api`。

## 构建与迁移

每次发布新版本时，以部署用户执行以下步骤：

```bash
cd /opt/jgl-issuevote
sudo -u jglvote npm ci
sudo -u jglvote npm run build
sudo -u jglvote npm run migrate -w apps/api
sudo rsync -a --delete apps/web/dist/ /var/www/jgl-issuevote/web/
sudo chown -R www-data:www-data /var/www/jgl-issuevote/web
```

迁移成功后再重启 API，避免新代码先于数据库结构上线。

## systemd API 服务

创建 `/etc/systemd/system/jgl-issuevote-api.service`：

```ini
[Unit]
Description=JGL IssueVote API
After=network.target mariadb.service

[Service]
Type=simple
User=jglvote
Group=jglvote
WorkingDirectory=/opt/jgl-issuevote
EnvironmentFile=/opt/jgl-issuevote/.env
ExecStart=/usr/bin/node /opt/jgl-issuevote/apps/api/dist/main.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

确认 Node.js 的实际路径与 `command -v node` 一致，然后启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jgl-issuevote-api
sudo systemctl status jgl-issuevote-api
curl -fsS http://127.0.0.1:3000/api/health
```

排查启动错误时使用 `sudo journalctl -u jgl-issuevote-api -f`。变更 `.env`（包括 NatayarkID 配置）后必须执行 `sudo systemctl restart jgl-issuevote-api`。

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

  location /uploads/ {
    proxy_pass http://127.0.0.1:3000/uploads/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

在同一个 `server` 块增加 `client_max_body_size 5m;`，使 Nginx 的上传限制与应用的图片上传限制一致。配置 HTTPS 证书后检查并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 发布检查清单

1. `curl -fsS https://vote.example.com/api/health` 返回 `ok: true`。
2. 打开首页、创建议题并上传一张测试图片，确认 `/uploads/` 可访问。
3. 用 NatayarkID 完整登录一次，确认回调后回到 `APP_URL` 且会话已建立。
4. 创建带分类、权限组和投票时间的议题，确认详情页能显示分类并正常投票。
5. 查看 `journalctl`，确认无数据库连接、OAuth 回调或静态资源错误。
