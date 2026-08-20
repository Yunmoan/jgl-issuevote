const groupNames: Record<string, string> = {
  member: '普通成员', council: '理事会成员', issue_creator: '议题创建者', admin: '系统管理员', auditor: '审计员'
};
const providerNames: Record<string, string> = { feishu: '飞书', natayarkid: 'Natayark ID' };
const auditNames: Record<string, string> = {
  'issue.create': '创建议题', 'issue.submit': '提交议题预审', 'issue.resubmit': '重新提交议题预审', 'issue.review_approve': '通过议题预审', 'issue.review_reject': '驳回议题预审', 'issue.edit': '编辑议题', 'issue.close': '关闭议题', 'issue.reopen': '重新开启议题', 'issue.archive': '归档议题', 'issue.vote_start': '开始投票', 'issue.vote_end': '结束投票', 'issue.vote_end_auto': '自动结束投票', 'issue.outcome.confirm': '确认议题结果', 'vote.cast': '提交投票', 'comment.create': '发表意见', 'comment.edit': '编辑意见', 'comment.delete': '删除意见', 'comment.reaction': '回应意见', 'comment.reply': '回复意见', 'comment.reply.delete': '删除意见回复', 'comment.reply.hide': '屏蔽意见回复',
  'user.group.add': '添加用户权限组', 'user.group.remove': '移除用户权限组', 'user.status.update': '更新用户状态',
  'permission_group.create': '创建权限组', 'permission_group.update': '更新权限组', 'permission_group.delete': '删除权限组', 'feishu.department.sync': '同步飞书部门', 'feishu.user_department.sync': '同步用户飞书部门',
  'identity.bind': '绑定登录身份', 'identity.auto_link': '自动合并登录身份', 'setting.update': '更新站点设置',
  'label.create': '创建议题分类', 'label.update': '编辑议题分类', 'label.delete': '删除议题分类'
};

export function displayGroup(value: string) { return groupNames[value] || value; }
export function displayProvider(value: string) { return providerNames[value] || value; }
export function displayAuditAction(value: string) { return auditNames[value] || value; }
