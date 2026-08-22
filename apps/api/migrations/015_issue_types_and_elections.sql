ALTER TABLE issues
  ADD COLUMN issue_type ENUM('cycle', 'election', 'custom') NOT NULL DEFAULT 'custom' AFTER body_md,
  ADD COLUMN election_scope ENUM('all', 'department') NULL AFTER issue_type,
  ADD COLUMN election_max_votes INT UNSIGNED NULL AFTER election_scope,
  ADD COLUMN election_winner_count INT UNSIGNED NULL AFTER election_max_votes,
  ADD COLUMN election_quorum_percent DECIMAL(5,2) NULL AFTER election_winner_count,
  ADD COLUMN election_duration_preset ENUM('instant', 'day') NULL AFTER election_quorum_percent,
  ADD COLUMN election_start_mode ENUM('scheduled', 'manual') NULL AFTER election_duration_preset,
  ADD KEY idx_issue_type (issue_type);

CREATE TABLE IF NOT EXISTS issue_election_candidates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  issue_id BIGINT UNSIGNED NOT NULL,
  nickname VARCHAR(80) NOT NULL,
  remark VARCHAR(300) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_election_candidate_issue (issue_id, sort_order),
  CONSTRAINT fk_election_candidate_issue FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS issue_election_votes (
  issue_id BIGINT UNSIGNED NOT NULL,
  voter_id BIGINT UNSIGNED NOT NULL,
  candidate_id BIGINT UNSIGNED NOT NULL,
  cast_at DATETIME NOT NULL,
  PRIMARY KEY (issue_id, voter_id, candidate_id),
  KEY idx_election_vote_candidate (issue_id, candidate_id),
  CONSTRAINT fk_election_vote_issue FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
  CONSTRAINT fk_election_vote_voter FOREIGN KEY (voter_id) REFERENCES users(id),
  CONSTRAINT fk_election_vote_candidate FOREIGN KEY (candidate_id) REFERENCES issue_election_candidates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS issue_election_voter_state (
  issue_id BIGINT UNSIGNED NOT NULL,
  voter_id BIGINT UNSIGNED NOT NULL,
  change_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_cast_at DATETIME NOT NULL,
  PRIMARY KEY (issue_id, voter_id),
  CONSTRAINT fk_election_voter_state_issue FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
  CONSTRAINT fk_election_voter_state_user FOREIGN KEY (voter_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE system_settings SET setting_value = '60' WHERE setting_key = 'closed_issue_archive_after_days' AND setting_value = '7';
INSERT IGNORE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('closed_issue_archive_after_days', '60', NOW());
