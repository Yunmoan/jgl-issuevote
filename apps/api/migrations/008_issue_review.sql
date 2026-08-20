ALTER TABLE issues
  MODIFY COLUMN status ENUM('draft', 'pending_review', 'review_rejected', 'open', 'voting', 'closed', 'archived') NOT NULL DEFAULT 'open',
  ADD COLUMN reviewed_by BIGINT UNSIGNED NULL AFTER closed_at,
  ADD COLUMN reviewed_at DATETIME NULL AFTER reviewed_by,
  ADD COLUMN review_note VARCHAR(1000) NULL AFTER reviewed_at,
  ADD KEY idx_issue_review_status (status, reviewed_at),
  ADD CONSTRAINT fk_issue_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id);
