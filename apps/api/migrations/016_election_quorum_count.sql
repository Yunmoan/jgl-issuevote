ALTER TABLE issues
  ADD COLUMN election_quorum_count INT UNSIGNED NULL AFTER election_quorum_percent;
