# API 设计

API 前缀统一为 `/api`，返回 JSON。后端应提供 OpenAPI 文档，前端类型由 OpenAPI 或共享 schema 生成。

## 通用响应

成功：

```json
{
  "data": {}
}
```

失败：

```json
{
  "error": {
    "code": "ISSUE_NOT_FOUND",
    "message": "议题不存在或不可见",
    "requestId": "req_xxx"
  }
}
```

分页：

```json
{
  "data": [],
  "page": {
    "cursor": "next_cursor",
    "hasMore": true
  }
}
```

## Auth

```http
GET  /api/auth/providers
POST /api/auth/feishu/code
GET  /api/auth/natayarkid/start
GET  /api/auth/natayarkid/callback
POST /api/auth/bind/feishu
GET  /api/auth/bind/natayarkid/start
GET  /api/auth/bind/natayarkid/callback
POST /api/auth/logout
GET  /api/me
```

`POST /api/auth/feishu/code`

```json
{
  "code": "temporary_code_from_feishu"
}
```

返回：

```json
{
  "data": {
    "user": {
      "id": "1",
      "displayName": "张三",
      "avatarUrl": null,
      "groups": ["member", "council"],
      "boundProviders": ["feishu"]
    },
    "nextAction": "ok"
  }
}
```

`nextAction` 可为：

- `ok`
- `bind_feishu_required`
- `bind_natayarkid_required`
- `disabled`
- `org_not_allowed`

## Issues

```http
GET    /api/issues
POST   /api/issues
POST   /api/issues/ai-review
GET    /api/issues/reviews
POST   /api/issues/:number/review
GET    /api/issues/:number
PATCH  /api/issues/:number
POST   /api/issues/:number/close
POST   /api/issues/:number/end-voting
POST   /api/issues/:number/start-voting
POST   /api/issues/:number/outcome
POST   /api/issues/:number/reopen
POST   /api/issues/:number/archive
POST   /api/issues/:number/subscribe
DELETE /api/issues/:number/subscribe
```

AI 预审配置仅由管理员在以下接口维护：

```http
GET    /api/admin/ai-review-settings
PATCH  /api/admin/ai-review-settings
POST   /api/admin/ai-review-settings/test
```

`PATCH /api/admin/ai-review-settings` 使用数据库中的 `ai_review_config` 系统设置，支持：

```json
{
  "mode": "ai",
  "endpoint": "http://127.0.0.1:8000/v1",
  "model": "Qwen3-8B",
  "apiKey": "optional-for-local-models",
  "policyPrompt": "议题必须说明预算来源，且不得包含个人隐私信息。"
}
```

`endpoint` 可以填写 OpenAI 兼容 API 的基础地址或完整的 `/chat/completions` 地址。接口不使用供应商私有参数，适用于 Qwen3-8B 的 OpenAI 兼容服务；返回结果要求模型输出 JSON，后端会兼容 Qwen 的思考内容后再解析最终 JSON。

AI 模式下，创建页面第 1 步调用 `POST /api/issues/ai-review`：

```json
{
  "title": "是否通过 2026 年预算调整方案",
  "bodyMd": "议题正文"
}
```

响应包含 `approved`、法律法规和自定义条件检查结果、`similarIssues`（最多 5 条）及短时 `reviewToken`。发现相似议题后由创建者确认是否继续；最终 `POST /api/issues` 必须携带未过期且与标题、正文及当前 AI 配置一致的 `aiReviewToken`，因此不能绕过预审。

列表查询参数：

- `status=open`：返回开放讨论和投票中的议题；`status=voting`：只返回投票中的议题。
- `label=财务`
- `visibility=public|login|groups`
- `q=关键词`
- `cursor=...`

创建议题：

```json
{
  "title": "是否通过 2026 年预算调整方案",
  "bodyMd": "议题正文，支持 Markdown",
  "visibility": "groups",
  "viewGroupKeys": ["council"],
  "voteGroupKeys": ["council"],
  "labelIds": [1, 2],
  "commentPublishAt": "2026-08-31T12:00:00.000Z",
  "votingEnabled": true,
  "voteStartsAt": "2026-08-20T12:00:00.000Z",
  "voteEndsAt": "2026-08-27T12:00:00.000Z",
  "voteVisibility": "counts_after_close",
  "allowVoteChange": true,
  "quorumCount": 9,
  "passRule": "simple_majority",
  "customPassRule": null
}
```

未配置投票时间时，议题先处于 `open`（开放讨论），创建者可通过 `POST /api/issues/:number/start-voting` 开始投票。`POST /api/issues/:number/end-voting` 会结束当前轮票并转为 `vote_ended`，保留讨论但不再接受新投票；`POST /api/issues/:number/close` 才会停止讨论和投票。关闭接口接收 `{ "visibility": "retain" | "public" | "admin_only" }`，用于保持现状、公开给所有访客，或对除管理员外的所有人隐藏。自定义规则结束后返回 `outcome=manual_required`，仅 `admin` 或 `auditor` 可通过 `POST /api/issues/:number/outcome` 提交 `{ "outcome": "passed" | "rejected" }`。

议题详情返回应包含当前用户能力：

```json
{
  "data": {
    "issue": {
      "number": 12,
      "title": "是否通过 2026 年预算调整方案",
      "status": "voting",
      "votingEnabled": true,
      "outcome": "pending",
      "visibility": "groups",
      "labels": [],
      "commentPublishAt": "2026-08-31T12:00:00.000Z"
    },
    "viewer": {
      "canComment": true,
      "canVote": true,
      "canEdit": false,
      "canModerate": false,
      "hasSubscribed": true
    },
    "voteSummary": {
      "visible": false,
      "agree": null,
      "disagree": null,
      "abstain": null,
      "total": null
    },
    "myVote": {
      "choice": "agree",
      "castAt": "2026-08-20T13:00:00.000Z"
    }
  }
}
```

## Comments

```http
GET    /api/issues/:number/comments
POST   /api/issues/:number/comments
PATCH  /api/issues/:number/comments/:commentId
DELETE /api/issues/:number/comments/:commentId
POST   /api/issues/:number/comments/:commentId/publish
```

创建评论：

```json
{
  "bodyMd": "我的意见是..."
}
```

返回中必须标出发布状态：

```json
{
  "data": {
    "id": "100",
    "bodyMd": "我的意见是...",
    "publishAt": "2026-08-31T12:00:00.000Z",
    "published": false,
    "viewerCanSeeBeforePublish": true
  }
}
```

## Votes

```http
GET  /api/issues/:number/vote
PUT  /api/issues/:number/vote
GET  /api/issues/:number/vote/events
GET  /api/issues/:number/vote/export
```

投票：

```json
{
  "choice": "agree",
  "reason": "可选，作为投票说明或审计备注"
}
```

后端行为：

- 校验登录、绑定策略、议题可见性、投票组、投票窗口。
- 如果已投票且 `allowVoteChange=false`，返回 `VOTE_CHANGE_NOT_ALLOWED`。
- 写入或更新 `issue_votes`。
- 每次投票写入 `issue_vote_events`。
- 返回当前用户投票和可见范围内的统计。

## Labels

```http
GET    /api/labels
POST   /api/admin/labels
PATCH  /api/admin/labels/:id
DELETE /api/admin/labels/:id
```

## Admin

```http
GET   /api/admin/users
GET   /api/admin/users/:id
PATCH /api/admin/users/:id
POST  /api/admin/users/:id/groups
DELETE /api/admin/users/:id/groups/:groupKey

GET   /api/admin/groups
POST  /api/admin/groups
PATCH /api/admin/groups/:id
DELETE /api/admin/groups/:id

GET   /api/admin/settings
PATCH /api/admin/settings

GET   /api/admin/audit-logs
GET   /api/admin/issues/:number/audit
```

用户管理列表应支持：

- 按名称、邮箱、飞书 ID、NatayarkID 搜索。
- 按状态筛选。
- 按权限组筛选。
- 查看身份绑定情况。

## 错误码建议

- `AUTH_REQUIRED`
- `BIND_FEISHU_REQUIRED`
- `BIND_NATAYARKID_REQUIRED`
- `ORG_NOT_ALLOWED`
- `PERMISSION_DENIED`
- `ISSUE_NOT_FOUND`
- `ISSUE_CLOSED`
- `COMMENT_NOT_PUBLISHED`
- `VOTE_NOT_STARTED`
- `VOTE_ENDED`
- `VOTE_CHANGE_NOT_ALLOWED`
- `VALIDATION_FAILED`
- `OAUTH_STATE_INVALID`
- `OAUTH_PROVIDER_ERROR`
