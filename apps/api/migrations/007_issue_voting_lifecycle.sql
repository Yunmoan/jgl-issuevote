ALTER TABLE issues
  ADD COLUMN voting_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER visibility,
  ADD COLUMN outcome ENUM('pending', 'passed', 'rejected', 'manual_required', 'not_applicable') NOT NULL DEFAULT 'pending' AFTER custom_pass_rule_json,
  ADD COLUMN outcome_confirmed_by BIGINT UNSIGNED NULL AFTER outcome,
  ADD COLUMN outcome_confirmed_at DATETIME NULL AFTER outcome_confirmed_by,
  ADD CONSTRAINT fk_issue_outcome_confirmed_by FOREIGN KEY (outcome_confirmed_by) REFERENCES users(id);
