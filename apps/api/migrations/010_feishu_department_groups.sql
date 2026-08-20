ALTER TABLE permission_groups
  MODIFY kind ENUM('system', 'custom', 'feishu_org') NOT NULL DEFAULT 'custom';

CREATE TABLE IF NOT EXISTS feishu_department_groups (
  department_id VARCHAR(191) NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  department_name VARCHAR(80) NOT NULL,
  parent_department_id VARCHAR(191) NULL,
  synced_at DATETIME NOT NULL,
  PRIMARY KEY (department_id),
  UNIQUE KEY uk_feishu_department_group (group_id),
  CONSTRAINT fk_feishu_department_group FOREIGN KEY (group_id) REFERENCES permission_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
