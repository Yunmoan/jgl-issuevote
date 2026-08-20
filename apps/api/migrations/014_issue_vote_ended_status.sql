ALTER TABLE issues
  MODIFY COLUMN status ENUM('draft', 'pending_review', 'review_rejected', 'open', 'voting', 'vote_ended', 'closed', 'archived') NOT NULL DEFAULT 'open';
