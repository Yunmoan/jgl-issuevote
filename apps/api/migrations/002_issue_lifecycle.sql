ALTER TABLE issues
  ADD COLUMN comment_ends_at DATETIME NULL AFTER comment_publish_at,
  ADD COLUMN content_edited_at DATETIME NULL AFTER closed_at;

INSERT IGNORE INTO system_settings (setting_key, setting_value, updated_at) VALUES
('closed_issue_archive_after_days', '7', NOW());
