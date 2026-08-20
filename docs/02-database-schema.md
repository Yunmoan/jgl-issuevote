# 数据库设计

数据库目标为 Linux 环境中的 MariaDB / MySQL 5.7 兼容部署。MariaDB、MySQL 5.7 和 MySQL 8 不是完全等价的实现，因此 DDL 以非 MySQL 8 的公共子集为基线：不使用原生 JSON 字段、`DATETIME(3)`、数据库自动更新时间和 MySQL 8 专属能力。时间统一存 UTC，前端按用户时区展示。

注意：

- 所有 `created_at`、`updated_at`、`linked_at` 等时间字段由后端应用写入，不依赖数据库自动更新时间。
- JSON 结构以 `LONGTEXT` 保存，后端负责序列化、反序列化和 schema 校验；这样可以避开 MariaDB 与 MySQL 原生 JSON 行为差异。
- 字符集默认写 `utf8mb4`，用于兼容中文、emoji 和特殊字符。
- 搜索 MVP 使用标题 `LIKE`、分类和状态筛选；后续如升级数据库或接入搜索服务，再补全文搜索。

## 核心实体

- 用户：`users`
- 第三方身份：`auth_identities`
- 权限组：`permission_groups`
- 用户组关系：`user_group_memberships`
- 议题：`issues`
- 分类：`labels`
- 评论：`issue_comments`
- 投票：`issue_votes`
- 投票事件：`issue_vote_events`
- 审计日志：`audit_logs`

## DDL 草案

```sql
CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  display_name VARCHAR(80) NOT NULL,
  avatar_url VARCHAR(500) NULL,
  email VARCHAR(180) NULL,
  status ENUM('active', 'disabled', 'pending') NOT NULL DEFAULT 'active',
  primary_provider ENUM('feishu', 'natayarkid') NULL,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_users_status (status),
  KEY idx_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE auth_identities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  provider ENUM('feishu', 'natayarkid') NOT NULL,
  provider_subject VARCHAR(191) NOT NULL,
  tenant_key VARCHAR(191) NULL,
  open_id VARCHAR(191) NULL,
  union_id VARCHAR(191) NULL,
  provider_user_id VARCHAR(191) NULL,
  email VARCHAR(180) NULL,
  display_name VARCHAR(80) NULL,
  avatar_url VARCHAR(500) NULL,
  raw_profile_json LONGTEXT NULL,
  access_token_cipher TEXT NULL,
  refresh_token_cipher TEXT NULL,
  token_expires_at DATETIME NULL,
  linked_at DATETIME NOT NULL,
  last_used_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_identity_provider_subject (provider, provider_subject),
  UNIQUE KEY uk_identity_user_provider (user_id, provider),
  KEY idx_identity_tenant (provider, tenant_key),
  CONSTRAINT fk_identity_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE permission_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_key VARCHAR(80) NOT NULL,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(300) NULL,
  kind ENUM('system', 'custom') NOT NULL DEFAULT 'custom',
  is_assignable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_permission_group_key (group_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_group_memberships (
  user_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  source ENUM('manual', 'feishu_org', 'natayarkid_claim', 'system') NOT NULL DEFAULT 'manual',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, group_id),
  KEY idx_membership_group (group_id),
  CONSTRAINT fk_membership_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_membership_group FOREIGN KEY (group_id) REFERENCES permission_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE labels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(40) NOT NULL,
  color VARCHAR(20) NOT NULL,
  description VARCHAR(200) NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_label_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  number BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  body_md MEDIUMTEXT NOT NULL,
  status ENUM('draft', 'open', 'voting', 'vote_ended', 'closed', 'archived') NOT NULL DEFAULT 'open',
  visibility ENUM('public', 'login', 'groups', 'admin_only') NOT NULL DEFAULT 'login',
  voting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  comment_publish_at DATETIME NULL,
  vote_starts_at DATETIME NULL,
  vote_ends_at DATETIME NULL,
  vote_visibility ENUM('counts_after_vote', 'counts_after_close', 'names_after_close', 'admin_only') NOT NULL DEFAULT 'counts_after_close',
  allow_vote_change BOOLEAN NOT NULL DEFAULT TRUE,
  quorum_count INT UNSIGNED NULL,
  pass_rule ENUM('simple_majority', 'two_thirds', 'custom') NOT NULL DEFAULT 'simple_majority',
  custom_pass_rule_json LONGTEXT NULL,
  outcome ENUM('pending', 'passed', 'rejected', 'manual_required', 'not_applicable') NOT NULL DEFAULT 'pending',
  outcome_confirmed_by BIGINT UNSIGNED NULL,
  outcome_confirmed_at DATETIME NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  closed_by BIGINT UNSIGNED NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_issue_number (number),
  KEY idx_issue_status_updated (status, updated_at),
  KEY idx_issue_visibility (visibility),
  KEY idx_issue_vote_window (vote_starts_at, vote_ends_at),
  CONSTRAINT fk_issue_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_issue_closed_by FOREIGN KEY (closed_by) REFERENCES users(id),
  CONSTRAINT fk_issue_outcome_confirmed_by FOREIGN KEY (outcome_confirmed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issue_labels (
  issue_id BIGINT UNSIGNED NOT NULL,
  label_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (issue_id, label_id),
  CONSTRAINT fk_issue_label_issue FOREIGN KEY (issue_id) REFERENCES issues(id),
  CONSTRAINT fk_issue_label_label FOREIGN KEY (label_id) REFERENCES labels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issue_view_groups (
  issue_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (issue_id, group_id),
  CONSTRAINT fk_issue_view_group_issue FOREIGN KEY (issue_id) REFERENCES issues(id),
  CONSTRAINT fk_issue_view_group_group FOREIGN KEY (group_id) REFERENCES permission_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issue_vote_groups (
  issue_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (issue_id, group_id),
  CONSTRAINT fk_issue_vote_group_issue FOREIGN KEY (issue_id) REFERENCES issues(id),
  CONSTRAINT fk_issue_vote_group_group FOREIGN KEY (group_id) REFERENCES permission_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issue_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  issue_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  body_md MEDIUMTEXT NOT NULL,
  publish_at DATETIME NULL,
  published_at DATETIME NULL,
  edited_at DATETIME NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_comment_issue_publish (issue_id, publish_at, published_at),
  KEY idx_comment_author (author_id),
  CONSTRAINT fk_comment_issue FOREIGN KEY (issue_id) REFERENCES issues(id),
  CONSTRAINT fk_comment_author FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issue_votes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  issue_id BIGINT UNSIGNED NOT NULL,
  voter_id BIGINT UNSIGNED NOT NULL,
  choice ENUM('agree', 'disagree', 'abstain') NOT NULL,
  comment_id BIGINT UNSIGNED NULL,
  cast_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vote_issue_voter (issue_id, voter_id),
  KEY idx_vote_issue_choice (issue_id, choice),
  CONSTRAINT fk_vote_issue FOREIGN KEY (issue_id) REFERENCES issues(id),
  CONSTRAINT fk_vote_voter FOREIGN KEY (voter_id) REFERENCES users(id),
  CONSTRAINT fk_vote_comment FOREIGN KEY (comment_id) REFERENCES issue_comments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issue_vote_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  issue_id BIGINT UNSIGNED NOT NULL,
  voter_id BIGINT UNSIGNED NOT NULL,
  old_choice ENUM('agree', 'disagree', 'abstain') NULL,
  new_choice ENUM('agree', 'disagree', 'abstain') NOT NULL,
  reason VARCHAR(300) NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_vote_event_issue (issue_id, created_at),
  KEY idx_vote_event_voter (voter_id),
  CONSTRAINT fk_vote_event_issue FOREIGN KEY (issue_id) REFERENCES issues(id),
  CONSTRAINT fk_vote_event_voter FOREIGN KEY (voter_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issue_subscriptions (
  issue_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (issue_id, user_id),
  CONSTRAINT fk_subscription_issue FOREIGN KEY (issue_id) REFERENCES issues(id),
  CONSTRAINT fk_subscription_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE system_settings (
  setting_key VARCHAR(120) NOT NULL,
  setting_value LONGTEXT NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_setting_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_id VARCHAR(80) NOT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  metadata_json LONGTEXT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_audit_target (target_type, target_id),
  KEY idx_audit_actor (actor_id, created_at),
  KEY idx_audit_action (action, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## 初始系统组

启动迁移后应插入这些系统组：

```sql
INSERT INTO permission_groups (group_key, name, kind, is_assignable, created_at, updated_at) VALUES
('member', '普通成员', 'system', TRUE, NOW(), NOW()),
('council', '理事会成员', 'system', TRUE, NOW(), NOW()),
('issue_creator', '议题创建者', 'system', TRUE, NOW(), NOW()),
('admin', '系统管理员', 'system', TRUE, NOW(), NOW()),
('auditor', '审计员', 'system', TRUE, NOW(), NOW());
```

## 评论统一公布规则

- 创建议题时如果设置 `issues.comment_publish_at`，该议题的新评论默认写入同一个 `publish_at`。
- 若未设置，评论 `publish_at` 与 `published_at` 都写当前时间，表示即时公开。
- 管理员或作者编辑评论不应改变首次 `publish_at`；是否允许编辑已公开评论由产品设置控制。
- 查询评论时，普通用户只能看到 `deleted_at IS NULL` 且 `publish_at <= NOW()` 的评论；管理员和作者可看到自己的待公开评论，但 UI 必须标注待公开。

## 投票资格规则

- `issue_vote_groups` 为空时，默认任何可见该议题的登录用户都可投票。
- `issue_vote_groups` 不为空时，用户必须属于至少一个投票组。
- 管理员可以查看投票状态和审计信息，但默认不代表拥有投票资格。
- 投票窗口由 `vote_starts_at` 和 `vote_ends_at` 控制；为空表示不限制对应边界。

## 可扩展表

MVP 之后可以增加：

- `attachments`：议题和评论附件。
- `notifications`：站内通知。
- `issue_timeline_events`：把评论、状态变化、分类变化合并为 GitHub 风格时间线。
- `issue_result_snapshots`：关闭议题时冻结统计结果，防止后续用户组变化影响历史解释。
