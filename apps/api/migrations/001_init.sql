CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS auth_identities (
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

CREATE TABLE IF NOT EXISTS permission_groups (
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

CREATE TABLE IF NOT EXISTS user_group_memberships (
  user_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  source ENUM('manual', 'feishu_org', 'natayarkid_claim', 'system') NOT NULL DEFAULT 'manual',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, group_id),
  KEY idx_membership_group (group_id),
  CONSTRAINT fk_membership_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_membership_group FOREIGN KEY (group_id) REFERENCES permission_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS labels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(40) NOT NULL,
  color VARCHAR(20) NOT NULL,
  description VARCHAR(200) NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_label_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS issues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  number BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  body_md MEDIUMTEXT NOT NULL,
  status ENUM('draft', 'open', 'voting', 'closed', 'archived') NOT NULL DEFAULT 'open',
  visibility ENUM('public', 'login', 'groups') NOT NULL DEFAULT 'login',
  comment_publish_at DATETIME NULL,
  vote_starts_at DATETIME NULL,
  vote_ends_at DATETIME NULL,
  vote_visibility ENUM('counts_after_vote', 'counts_after_close', 'names_after_close', 'admin_only') NOT NULL DEFAULT 'counts_after_close',
  allow_vote_change BOOLEAN NOT NULL DEFAULT TRUE,
  quorum_count INT UNSIGNED NULL,
  pass_rule ENUM('simple_majority', 'two_thirds', 'custom') NOT NULL DEFAULT 'simple_majority',
  custom_pass_rule_json LONGTEXT NULL,
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
  CONSTRAINT fk_issue_closed_by FOREIGN KEY (closed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id BIGINT UNSIGNED NOT NULL,
  label_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (issue_id, label_id),
  CONSTRAINT fk_issue_label_issue FOREIGN KEY (issue_id) REFERENCES issues(id),
  CONSTRAINT fk_issue_label_label FOREIGN KEY (label_id) REFERENCES labels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS issue_view_groups (
  issue_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (issue_id, group_id),
  CONSTRAINT fk_issue_view_group_issue FOREIGN KEY (issue_id) REFERENCES issues(id),
  CONSTRAINT fk_issue_view_group_group FOREIGN KEY (group_id) REFERENCES permission_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS issue_vote_groups (
  issue_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (issue_id, group_id),
  CONSTRAINT fk_issue_vote_group_issue FOREIGN KEY (issue_id) REFERENCES issues(id),
  CONSTRAINT fk_issue_vote_group_group FOREIGN KEY (group_id) REFERENCES permission_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS issue_comments (
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

CREATE TABLE IF NOT EXISTS issue_votes (
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

CREATE TABLE IF NOT EXISTS issue_vote_events (
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

CREATE TABLE IF NOT EXISTS issue_subscriptions (
  issue_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (issue_id, user_id),
  CONSTRAINT fk_subscription_issue FOREIGN KEY (issue_id) REFERENCES issues(id),
  CONSTRAINT fk_subscription_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(120) NOT NULL,
  setting_value LONGTEXT NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_setting_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
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

INSERT IGNORE INTO permission_groups (group_key, name, description, kind, is_assignable, created_at, updated_at) VALUES
('member', '普通成员', '登录后默认成员', 'system', TRUE, NOW(), NOW()),
('council', '理事会成员', '拥有理事会议题投票资格', 'system', TRUE, NOW(), NOW()),
('issue_creator', '议题创建者', '可以创建和维护议题', 'system', TRUE, NOW(), NOW()),
('admin', '系统管理员', '管理用户、权限组、设置和审计', 'system', TRUE, NOW(), NOW()),
('auditor', '审计员', '查看审计记录和投票历史', 'system', TRUE, NOW(), NOW());

INSERT IGNORE INTO labels (name, color, description, created_at) VALUES
('财务', '#1677ff', '预算、报销、财务制度', NOW()),
('人事', '#18a058', '成员、岗位、任免事项', NOW()),
('制度', '#722ed1', '章程、流程、管理制度', NOW()),
('紧急', '#d03050', '需要优先处理的议题', NOW());

INSERT IGNORE INTO system_settings (setting_key, setting_value, updated_at) VALUES
('site_name', '"冀高联事项"', NOW());
