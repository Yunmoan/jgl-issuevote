SET @feishu_root_group_id := (
  SELECT group_id
  FROM feishu_department_groups
  WHERE department_id = '0'
  LIMIT 1
);

DELETE ugm
FROM user_group_memberships ugm
JOIN feishu_department_groups fdg ON fdg.group_id = ugm.group_id
WHERE fdg.department_id = '0';

DELETE ivg
FROM issue_view_groups ivg
JOIN feishu_department_groups fdg ON fdg.group_id = ivg.group_id
WHERE fdg.department_id = '0';

DELETE ivg
FROM issue_vote_groups ivg
JOIN feishu_department_groups fdg ON fdg.group_id = ivg.group_id
WHERE fdg.department_id = '0';

DELETE FROM feishu_department_groups WHERE department_id = '0';

DELETE FROM permission_groups
WHERE id = @feishu_root_group_id
  AND kind = 'feishu_org';
