ALTER TABLE issues
  ADD COLUMN comment_anonymous BOOLEAN NOT NULL DEFAULT FALSE AFTER comment_ends_at;

ALTER TABLE issue_comment_replies
  ADD COLUMN deleted_at DATETIME NULL AFTER updated_at,
  ADD COLUMN hidden_at DATETIME NULL AFTER deleted_at,
  ADD COLUMN hidden_by BIGINT UNSIGNED NULL AFTER hidden_at,
  ADD KEY idx_comment_reply_visibility (comment_id, deleted_at, hidden_at),
  ADD CONSTRAINT fk_comment_reply_hidden_by FOREIGN KEY (hidden_by) REFERENCES users(id);

INSERT IGNORE INTO system_settings (setting_key, setting_value, updated_at) VALUES
('issue_time_presets', '{"discussionShortDays":3,"discussionLongDays":5,"voteInstantMinutes":10,"voteShortMinutes":60,"voteLongMinutes":1440}', NOW());
