ALTER TABLE issues
  MODIFY COLUMN visibility ENUM('public', 'login', 'groups', 'admin_only') NOT NULL DEFAULT 'login';
