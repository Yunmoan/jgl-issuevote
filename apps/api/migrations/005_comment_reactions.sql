CREATE TABLE IF NOT EXISTS issue_comment_reactions (
  comment_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  reaction ENUM('like', 'yes', 'no') NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (comment_id, user_id, reaction),
  KEY idx_comment_reaction_comment (comment_id, reaction),
  CONSTRAINT fk_comment_reaction_comment FOREIGN KEY (comment_id) REFERENCES issue_comments(id),
  CONSTRAINT fk_comment_reaction_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
