CREATE TABLE IF NOT EXISTS issue_comment_replies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  comment_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  body_md MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_comment_reply_comment_created (comment_id, created_at),
  KEY idx_comment_reply_author (author_id),
  CONSTRAINT fk_comment_reply_comment FOREIGN KEY (comment_id) REFERENCES issue_comments(id),
  CONSTRAINT fk_comment_reply_author FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
