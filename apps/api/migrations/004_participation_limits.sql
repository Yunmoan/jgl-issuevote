ALTER TABLE issues
  ADD COLUMN max_vote_changes INT UNSIGNED NOT NULL DEFAULT 1 AFTER allow_vote_change,
  ADD COLUMN max_comments_per_user INT UNSIGNED NOT NULL DEFAULT 3 AFTER max_vote_changes;

ALTER TABLE issue_votes
  ADD COLUMN change_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER choice;
