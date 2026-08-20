import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../db/database.service';
import { nowSql, toSqlDate } from '../db/sql-time';
import type { IssueVisibility, Viewer, VoteChoice } from '../types';

export const createIssueSchema = z.object({
  title: z.string().trim().min(3).max(200),
  bodyMd: z.string().trim().min(1).max(1024 * 1024),
  visibility: z.enum(['public', 'login', 'groups']).default('login'),
  viewGroupKeys: z.array(z.string().trim().min(1).max(80)).max(20).default([]).transform(uniqueValues),
  voteGroupKeys: z.array(z.string().trim().min(1).max(80)).max(20).default([]).transform(uniqueValues),
  labelIds: z.array(z.coerce.number().int().positive()).max(20).default([]).transform(uniqueValues),
  commentPublishAt: z.string().datetime().nullable().optional(),
  commentEndsAt: z.string().datetime().nullable().optional(),
  voteStartsAt: z.string().datetime().nullable().optional(),
  voteEndsAt: z.string().datetime().nullable().optional(),
  voteVisibility: z.enum(['counts_after_vote', 'counts_after_close', 'names_after_close', 'admin_only']).default('counts_after_close'),
  allowVoteChange: z.boolean().default(true),
  maxVoteChanges: z.number().int().min(0).max(100).default(1),
  maxCommentsPerUser: z.number().int().min(1).max(100).default(3),
  quorumCount: z.number().int().positive().nullable().optional(),
  passRule: z.enum(['simple_majority', 'two_thirds', 'custom']).default('simple_majority')
}).superRefine((input, context) => {
  if (input.visibility === 'groups' && input.viewGroupKeys.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['viewGroupKeys'], message: '指定权限组可见时，至少选择一个查看权限组' });
  }
  if (input.commentPublishAt && input.commentEndsAt && input.commentPublishAt > input.commentEndsAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['commentEndsAt'], message: '意见截止时间不能早于公布时间' });
  }
  if (input.voteStartsAt && input.voteEndsAt && input.voteStartsAt > input.voteEndsAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['voteEndsAt'], message: '投票结束时间不能早于开始时间' });
  }
});
export const updateIssueSchema = createIssueSchema;

function uniqueValues<T>(values: T[]) {
  return [...new Set(values)];
}

@Injectable()
export class IssuesService implements OnModuleInit {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  onModuleInit() {
    void this.archiveDueClosedIssues();
    setInterval(() => void this.archiveDueClosedIssues(), 60 * 60 * 1000).unref();
  }

  async list(query: Record<string, unknown>, viewer: Viewer | null) {
    const conditions = [`i.status <> 'draft'`];
    const params: Record<string, unknown> = {};

    if (query.status) {
      conditions.push('i.status = :status');
      params.status = query.status;
    }
    if (query.q) {
      conditions.push('(i.title LIKE :q OR i.body_md LIKE :q)');
      params.q = `%${String(query.q)}%`;
    }
    if (query.label) {
      conditions.push(`EXISTS (
        SELECT 1 FROM issue_labels il
        JOIN labels l ON l.id = il.label_id
        WHERE il.issue_id = i.id AND l.name = :label
      )`);
      params.label = query.label;
    }

    if (!viewer) {
      conditions.push(`i.visibility = 'public'`);
    } else if (!viewer.groups.includes('admin')) {
      conditions.push(`(
        i.visibility IN ('public', 'login')
        OR EXISTS (
          SELECT 1 FROM issue_view_groups ivg
          JOIN permission_groups pg ON pg.id = ivg.group_id
          JOIN user_group_memberships ugm ON ugm.group_id = pg.id
          WHERE ivg.issue_id = i.id AND ugm.user_id = :viewerId
        )
      )`);
      params.viewerId = viewer.id;
    }

    const rows = await this.db.rows(
      `SELECT i.id, i.number, i.title, i.status, i.visibility, i.vote_starts_at, i.vote_ends_at,
              i.updated_at, u.display_name AS created_by_name,
              COUNT(DISTINCT c.id) AS comment_count,
              COUNT(DISTINCT v.id) AS vote_count
       FROM issues i
       JOIN users u ON u.id = i.created_by
       LEFT JOIN issue_comments c ON c.issue_id = i.id AND c.deleted_at IS NULL AND (c.publish_at IS NULL OR c.publish_at <= NOW())
       LEFT JOIN issue_votes v ON v.issue_id = i.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY i.id
       ORDER BY i.updated_at DESC
       LIMIT 50`,
      params
    );

    const issueIds = rows.map((row) => row.id);
    const labels = await this.labelsForIssues(issueIds);
    return rows.map((row) => ({
      number: row.number,
      title: row.title,
      status: row.status,
      visibility: row.visibility,
      voteStartsAt: row.vote_starts_at,
      voteEndsAt: row.vote_ends_at,
      updatedAt: row.updated_at,
      createdByName: row.created_by_name,
      commentCount: Number(row.comment_count),
      voteCount: Number(row.vote_count),
      labels: labels.get(String(row.id)) || []
    }));
  }

  async create(input: z.infer<typeof createIssueSchema>, viewer: Viewer) {
    this.requireAnyGroup(viewer, ['admin', 'issue_creator']);
    await this.ensureKnownSelections(input.labelIds, input.viewGroupKeys, input.voteGroupKeys);
    const now = nowSql();
    const next = await this.db.first(`SELECT COALESCE(MAX(number), 0) + 1 AS next_number FROM issues`);
    const result = await this.db.exec(
      `INSERT INTO issues
       (number, title, body_md, status, visibility, comment_publish_at, comment_ends_at, vote_starts_at, vote_ends_at,
        vote_visibility, allow_vote_change, max_vote_changes, max_comments_per_user, quorum_count, pass_rule, created_by, created_at, updated_at)
       VALUES
       (:number, :title, :bodyMd, 'open', :visibility, :commentPublishAt, :commentEndsAt, :voteStartsAt, :voteEndsAt,
        :voteVisibility, :allowVoteChange, :maxVoteChanges, :maxCommentsPerUser, :quorumCount, :passRule, :createdBy, :now, :now)`,
      {
        number: next.next_number,
        title: input.title,
        bodyMd: input.bodyMd,
        visibility: input.visibility,
        commentPublishAt: toSqlDate(input.commentPublishAt || null),
        commentEndsAt: toSqlDate(input.commentEndsAt || null),
        voteStartsAt: toSqlDate(input.voteStartsAt || null),
        voteEndsAt: toSqlDate(input.voteEndsAt || null),
        voteVisibility: input.voteVisibility,
        allowVoteChange: input.allowVoteChange,
        maxVoteChanges: input.maxVoteChanges,
        maxCommentsPerUser: input.maxCommentsPerUser,
        quorumCount: input.quorumCount || null,
        passRule: input.passRule,
        createdBy: viewer.id,
        now
      }
    );
    const issueId = result.insertId;
    await this.replaceLabels(issueId, input.labelIds);
    await this.replaceIssueGroups('issue_view_groups', issueId, input.viewGroupKeys);
    await this.replaceIssueGroups('issue_vote_groups', issueId, input.voteGroupKeys);
    await this.audit(viewer.id, 'issue.create', 'issue', String(issueId), { number: next.next_number });
    return this.getByNumber(String(next.next_number), viewer);
  }

  async getByNumber(number: string, viewer: Viewer | null) {
    const issue = await this.db.first(
      `SELECT i.*, u.display_name AS created_by_name
       FROM issues i
       JOIN users u ON u.id = i.created_by
       WHERE i.number = :number`,
      { number }
    );
    if (!issue || !(await this.canViewIssue(issue, viewer))) {
      throw new NotFoundException('议题不存在或不可见');
    }

    const [labels, viewGroups, voteGroups, summary, myVote, myCommentCount] = await Promise.all([
      this.labelsForIssues([issue.id]),
      this.groupsForIssue('issue_view_groups', issue.id),
      this.groupsForIssue('issue_vote_groups', issue.id),
      this.voteSummary(issue, viewer),
      viewer
        ? this.db.first(`SELECT choice, cast_at, change_count FROM issue_votes WHERE issue_id = :issueId AND voter_id = :viewerId`, {
            issueId: issue.id,
            viewerId: viewer.id
          })
        : null,
      viewer
        ? this.db.first(`SELECT COUNT(*) AS count FROM issue_comments WHERE issue_id = :issueId AND author_id = :viewerId AND deleted_at IS NULL`, {
            issueId: issue.id,
            viewerId: viewer.id
          })
        : null
    ]);
    const canCommentAtThisTime = this.canCommentOnIssue(issue, viewer);
    const commentCount = Number(myCommentCount?.count || 0);

    return {
      issue: {
        id: String(issue.id),
        number: issue.number,
        title: issue.title,
        bodyMd: issue.body_md,
        status: issue.status,
        visibility: issue.visibility,
        commentPublishAt: issue.comment_publish_at,
        commentEndsAt: issue.comment_ends_at,
        voteStartsAt: issue.vote_starts_at,
        voteEndsAt: issue.vote_ends_at,
        voteVisibility: issue.vote_visibility,
        allowVoteChange: Boolean(issue.allow_vote_change),
        maxVoteChanges: Number(issue.max_vote_changes),
        maxCommentsPerUser: Number(issue.max_comments_per_user),
        quorumCount: issue.quorum_count,
        passRule: issue.pass_rule,
        createdByName: issue.created_by_name,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        contentEditedAt: issue.content_edited_at,
        labels: labels.get(String(issue.id)) || [],
        viewGroups,
        voteGroups
      },
      viewer: {
        canComment: canCommentAtThisTime && commentCount < Number(issue.max_comments_per_user),
        canEditComment: canCommentAtThisTime,
        commentCount,
        commentRemaining: Math.max(Number(issue.max_comments_per_user) - commentCount, 0),
        canVote: await this.canVote(issue, viewer),
        canEdit: Boolean(viewer && (viewer.groups.includes('admin') || String(issue.created_by) === viewer.id)),
        canModerate: Boolean(viewer?.groups.includes('admin'))
      },
      voteSummary: summary,
      myVote: myVote ? { choice: myVote.choice, castAt: myVote.cast_at, changeCount: Number(myVote.change_count) } : null
    };
  }

  async comments(number: string, viewer: Viewer | null) {
    const { issue } = await this.getByNumber(number, viewer);
    const canModerate = Boolean(viewer?.groups.includes('admin'));
    const rows = await this.db.rows(
      `SELECT c.id, c.body_md, c.publish_at, c.published_at, c.edited_at, c.created_at, c.updated_at,
              u.id AS author_id, u.display_name AS author_name, u.avatar_url AS author_avatar
       FROM issue_comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.issue_id = :issueId
         AND c.deleted_at IS NULL
         AND (:canModerate = 1 OR c.author_id = :viewerId OR c.publish_at IS NULL OR c.publish_at <= NOW())
       ORDER BY c.created_at ASC`,
      {
        issueId: issue.id,
        canModerate: canModerate ? 1 : 0,
        viewerId: viewer?.id || 0
      }
    );
    const commentIds = rows.map((row) => row.id);
    const [reactions, replies] = await Promise.all([
      this.reactionsForComments(commentIds, viewer?.id || null),
      this.repliesForComments(commentIds)
    ]);
    return rows.map((row) => ({
      id: String(row.id),
      bodyMd: row.body_md,
      publishAt: row.publish_at,
      published: !row.publish_at || new Date(row.publish_at).getTime() <= Date.now(),
      editedAt: row.edited_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      author: {
        id: String(row.author_id),
        displayName: row.author_name,
        avatarUrl: row.author_avatar
      },
      viewerCanSeeBeforePublish: canModerate || String(row.author_id) === viewer?.id,
      viewerCanEdit: Boolean(viewer && String(row.author_id) === viewer.id && this.canCommentOnIssue(issue, viewer)),
      viewerCanReact: Boolean(viewer && String(row.author_id) !== viewer.id && (!row.publish_at || new Date(row.publish_at).getTime() <= Date.now())),
      viewerCanReply: Boolean(viewer && this.canCommentOnIssue(issue, viewer) && (!row.publish_at || new Date(row.publish_at).getTime() <= Date.now())),
      reactionCounts: reactions.get(String(row.id))?.counts || { like: 0, yes: 0, no: 0 },
      myReactions: reactions.get(String(row.id))?.mine || [],
      replies: replies.get(String(row.id)) || []
    }));
  }

  async createComment(number: string, bodyMd: string, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    if (!detail.viewer.canComment) throw new ForbiddenException('无评论权限');
    const count = await this.db.first(`SELECT COUNT(*) AS count FROM issue_comments WHERE issue_id = :issueId AND author_id = :authorId AND deleted_at IS NULL`, {
      issueId: detail.issue.id,
      authorId: viewer.id
    });
    if (Number(count?.count || 0) >= detail.issue.maxCommentsPerUser) {
      throw new ForbiddenException(`每位成员最多可发表 ${detail.issue.maxCommentsPerUser} 条意见`);
    }
    const publishAt = detail.issue.commentPublishAt ? toSqlDate(detail.issue.commentPublishAt) : nowSql();
    const publishedAt = publishAt && new Date(publishAt).getTime() <= Date.now() ? nowSql() : null;
    const now = nowSql();
    const result = await this.db.exec(
      `INSERT INTO issue_comments (issue_id, author_id, body_md, publish_at, published_at, created_at, updated_at)
       VALUES (:issueId, :authorId, :bodyMd, :publishAt, :publishedAt, :now, :now)`,
      { issueId: detail.issue.id, authorId: viewer.id, bodyMd, publishAt, publishedAt, now }
    );
    await this.audit(viewer.id, 'comment.create', 'issue_comment', String(result.insertId), { issueNumber: number });
    return (await this.comments(number, viewer)).find((comment) => comment.id === String(result.insertId));
  }

  async updateComment(number: string, commentId: string, bodyMd: string, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    if (!this.canCommentOnIssue(detail.issue, viewer)) throw new ForbiddenException('当前不能修改意见');
    const comment = await this.db.first(
      `SELECT id, author_id FROM issue_comments WHERE id = :commentId AND issue_id = :issueId AND deleted_at IS NULL`,
      { commentId, issueId: detail.issue.id }
    );
    if (!comment) throw new NotFoundException('意见不存在');
    if (String(comment.author_id) !== viewer.id) throw new ForbiddenException('只能修改自己发表的意见');
    const now = nowSql();
    await this.db.exec(
      `UPDATE issue_comments SET body_md = :bodyMd, edited_at = :now, updated_at = :now WHERE id = :commentId`,
      { bodyMd, now, commentId }
    );
    await this.audit(viewer.id, 'comment.edit', 'issue_comment', String(commentId), { issueNumber: number });
    return (await this.comments(number, viewer)).find((item) => item.id === String(commentId));
  }

  async toggleCommentReaction(number: string, commentId: string, reaction: 'like' | 'yes' | 'no', viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    const comment = await this.db.first(
      `SELECT id, author_id, publish_at FROM issue_comments WHERE id = :commentId AND issue_id = :issueId AND deleted_at IS NULL`,
      { commentId, issueId: detail.issue.id }
    );
    if (!comment) throw new NotFoundException('意见不存在');
    if (String(comment.author_id) === viewer.id) throw new ForbiddenException('不能对自己发表的意见作出反应');
    if (comment.publish_at && new Date(comment.publish_at).getTime() > Date.now()) throw new ForbiddenException('意见尚未公布');
    const existing = await this.db.first(
      `SELECT 1 AS ok FROM issue_comment_reactions WHERE comment_id = :commentId AND user_id = :userId AND reaction = :reaction`,
      { commentId, userId: viewer.id, reaction }
    );
    if (existing) {
      await this.db.exec(
        `DELETE FROM issue_comment_reactions WHERE comment_id = :commentId AND user_id = :userId AND reaction = :reaction`,
        { commentId, userId: viewer.id, reaction }
      );
    } else {
      await this.db.exec(
        `INSERT INTO issue_comment_reactions (comment_id, user_id, reaction, created_at) VALUES (:commentId, :userId, :reaction, :now)`,
        { commentId, userId: viewer.id, reaction, now: nowSql() }
      );
    }
    const reactions = await this.reactionsForComments([commentId], viewer.id);
    const summary = reactions.get(String(commentId)) || { counts: { like: 0, yes: 0, no: 0 }, mine: [] };
    await this.audit(viewer.id, 'comment.reaction', 'issue_comment', String(commentId), { issueNumber: number, reaction, active: !existing });
    return { commentId: String(commentId), reactionCounts: summary.counts, myReactions: summary.mine };
  }

  async createCommentReply(number: string, commentId: string, bodyMd: string, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    if (!this.canCommentOnIssue(detail.issue, viewer)) throw new ForbiddenException('当前不能回复意见');
    const comment = await this.db.first(
      `SELECT id, publish_at FROM issue_comments WHERE id = :commentId AND issue_id = :issueId AND deleted_at IS NULL`,
      { commentId, issueId: detail.issue.id }
    );
    if (!comment) throw new NotFoundException('意见不存在');
    if (comment.publish_at && new Date(comment.publish_at).getTime() > Date.now()) throw new ForbiddenException('意见尚未公布');
    const now = nowSql();
    const result = await this.db.exec(
      `INSERT INTO issue_comment_replies (comment_id, author_id, body_md, created_at, updated_at)
       VALUES (:commentId, :authorId, :bodyMd, :now, :now)`,
      { commentId, authorId: viewer.id, bodyMd, now }
    );
    await this.audit(viewer.id, 'comment.reply', 'issue_comment_reply', String(result.insertId), { issueNumber: number, commentId: String(commentId) });
    return { id: String(result.insertId) };
  }

  async vote(number: string, choice: VoteChoice, reason: string | undefined, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    if (!detail.viewer.canVote) throw new ForbiddenException('当前用户无投票权限或不在投票时间内');
    const existing = await this.db.first(
      `SELECT choice, change_count FROM issue_votes WHERE issue_id = :issueId AND voter_id = :voterId`,
      { issueId: detail.issue.id, voterId: viewer.id }
    );
    if (existing && !detail.issue.allowVoteChange) {
      throw new ForbiddenException('本议题禁止修改投票');
    }
    if (existing && Number(existing.change_count) >= detail.issue.maxVoteChanges) {
      throw new ForbiddenException(`该议题最多允许重投 ${detail.issue.maxVoteChanges} 次`);
    }
    const now = nowSql();
    if (existing) {
      const result = await this.db.exec(
        `UPDATE issue_votes SET choice = :choice, change_count = change_count + 1, updated_at = :now
         WHERE issue_id = :issueId AND voter_id = :voterId AND change_count < :maxVoteChanges`,
        { issueId: detail.issue.id, voterId: viewer.id, choice, now, maxVoteChanges: detail.issue.maxVoteChanges }
      );
      if (result.affectedRows === 0) throw new ConflictException('重投次数已达到上限，请刷新后重试');
    } else {
      await this.db.exec(
        `INSERT INTO issue_votes (issue_id, voter_id, choice, cast_at, updated_at)
         VALUES (:issueId, :voterId, :choice, :now, :now)`,
        { issueId: detail.issue.id, voterId: viewer.id, choice, now }
      );
    }
    await this.db.exec(
      `INSERT INTO issue_vote_events (issue_id, voter_id, old_choice, new_choice, reason, created_at)
       VALUES (:issueId, :voterId, :oldChoice, :newChoice, :reason, :now)`,
      {
        issueId: detail.issue.id,
        voterId: viewer.id,
        oldChoice: existing?.choice || null,
        newChoice: choice,
        reason: reason || null,
        now
      }
    );
    await this.audit(viewer.id, 'vote.cast', 'issue', detail.issue.id, { choice, oldChoice: existing?.choice || null });
    return this.getByNumber(number, viewer);
  }

  async close(number: string, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    this.requireIssueManager(detail, viewer);
    if (detail.issue.status !== 'open' && detail.issue.status !== 'voting') throw new ForbiddenException('只有开放中的议题可以关闭');
    const now = nowSql();
    await this.db.exec(
      `UPDATE issues SET status = 'closed', closed_by = :viewerId, closed_at = :now, updated_at = :now WHERE id = :issueId`,
      { viewerId: viewer.id, now, issueId: detail.issue.id }
    );
    await this.audit(viewer.id, 'issue.close', 'issue', detail.issue.id, { number });
    return this.getByNumber(number, viewer);
  }

  async reopen(number: string, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    this.requireIssueManager(detail, viewer);
    if (detail.issue.status !== 'closed') throw new ForbiddenException('只有已关闭的议题可以重新开启');
    const now = nowSql();
    await this.db.exec(
      `UPDATE issues SET status = 'open', closed_by = NULL, closed_at = NULL, updated_at = :now WHERE id = :issueId`,
      { now, issueId: detail.issue.id }
    );
    await this.audit(viewer.id, 'issue.reopen', 'issue', detail.issue.id, { number });
    return this.getByNumber(number, viewer);
  }

  async update(number: string, input: z.infer<typeof updateIssueSchema>, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    if (!detail.viewer.canEdit || detail.issue.status === 'archived') throw new ForbiddenException('无编辑权限或议题已归档');
    await this.ensureKnownSelections(input.labelIds, input.viewGroupKeys, input.voteGroupKeys);
    const now = nowSql();
    await this.db.exec(
      `UPDATE issues SET title = :title, body_md = :bodyMd, visibility = :visibility, comment_publish_at = :commentPublishAt,
       comment_ends_at = :commentEndsAt, vote_starts_at = :voteStartsAt, vote_ends_at = :voteEndsAt, vote_visibility = :voteVisibility,
       allow_vote_change = :allowVoteChange, max_vote_changes = :maxVoteChanges, max_comments_per_user = :maxCommentsPerUser,
       quorum_count = :quorumCount, pass_rule = :passRule, content_edited_at = :now, updated_at = :now
       WHERE id = :issueId`,
      { title: input.title, bodyMd: input.bodyMd, visibility: input.visibility, commentPublishAt: toSqlDate(input.commentPublishAt || null), commentEndsAt: toSqlDate(input.commentEndsAt || null), voteStartsAt: toSqlDate(input.voteStartsAt || null), voteEndsAt: toSqlDate(input.voteEndsAt || null), voteVisibility: input.voteVisibility, allowVoteChange: input.allowVoteChange, maxVoteChanges: input.maxVoteChanges, maxCommentsPerUser: input.maxCommentsPerUser, quorumCount: input.quorumCount || null, passRule: input.passRule, now, issueId: detail.issue.id }
    );
    await this.replaceLabels(detail.issue.id, input.labelIds);
    await this.replaceIssueGroups('issue_view_groups', detail.issue.id, input.viewGroupKeys);
    await this.replaceIssueGroups('issue_vote_groups', detail.issue.id, input.voteGroupKeys);
    await this.audit(viewer.id, 'issue.edit', 'issue', detail.issue.id, { number });
    return this.getByNumber(number, viewer);
  }

  async archive(number: string, viewer: Viewer) {
    if (!viewer.groups.includes('admin')) throw new ForbiddenException('需要管理员权限');
    const detail = await this.getByNumber(number, viewer);
    if (detail.issue.status !== 'closed') throw new ForbiddenException('只有已关闭的议题可以归档');
    await this.db.exec(`UPDATE issues SET status = 'archived', updated_at = :now WHERE id = :issueId`, { now: nowSql(), issueId: detail.issue.id });
    await this.audit(viewer.id, 'issue.archive', 'issue', detail.issue.id, { number, mode: 'manual' });
    return this.getByNumber(number, viewer);
  }

  private async archiveDueClosedIssues() {
    try {
      const setting = await this.db.first(`SELECT setting_value FROM system_settings WHERE setting_key = 'closed_issue_archive_after_days'`);
      const configured = setting ? Number(JSON.parse(setting.setting_value)) : 7;
      const days = Number.isInteger(configured) && configured >= 1 ? configured : 7;
      await this.db.exec(
        `UPDATE issues
         SET status = 'archived', updated_at = :now
         WHERE status = 'closed'
           AND closed_at IS NOT NULL
           AND TIMESTAMPDIFF(DAY, closed_at, UTC_TIMESTAMP()) >= :days`,
        { now: nowSql(), days }
      );
    } catch {
      // Archival is retried hourly and must not prevent the API from serving requests.
    }
  }

  async labels() {
    return this.db.rows(`SELECT id, name, color, description FROM labels ORDER BY name`);
  }

  async adminLabels(viewer: Viewer) {
    this.requireAdmin(viewer);
    const rows = await this.db.rows(
      `SELECT l.id, l.name, l.color, l.description, COUNT(il.issue_id) AS issue_count
       FROM labels l
       LEFT JOIN issue_labels il ON il.label_id = l.id
       GROUP BY l.id
       ORDER BY l.name`
    );
    return rows.map((row) => ({ id: Number(row.id), name: row.name, color: row.color, description: row.description, issueCount: Number(row.issue_count) }));
  }

  async createLabel(input: { name: string; color: string; description?: string | null }, viewer: Viewer) {
    this.requireAdmin(viewer);
    try {
      const result = await this.db.exec(
        `INSERT INTO labels (name, color, description, created_at) VALUES (:name, :color, :description, :now)`,
        { name: input.name, color: input.color, description: input.description || null, now: nowSql() }
      );
      await this.audit(viewer.id, 'label.create', 'label', String(result.insertId), input);
      return { id: Number(result.insertId), ...input };
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') throw new ConflictException('分类名称已存在');
      throw error;
    }
  }

  async updateLabel(labelId: number, input: { name: string; color: string; description?: string | null }, viewer: Viewer) {
    this.requireAdmin(viewer);
    const existing = await this.db.first(`SELECT id FROM labels WHERE id = :labelId`, { labelId });
    if (!existing) throw new NotFoundException('分类不存在');
    try {
      await this.db.exec(
        `UPDATE labels SET name = :name, color = :color, description = :description WHERE id = :labelId`,
        { labelId, name: input.name, color: input.color, description: input.description || null }
      );
      await this.audit(viewer.id, 'label.update', 'label', String(labelId), input);
      return { ok: true };
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') throw new ConflictException('分类名称已存在');
      throw error;
    }
  }

  async deleteLabel(labelId: number, viewer: Viewer) {
    this.requireAdmin(viewer);
    const usage = await this.db.first(`SELECT COUNT(*) AS count FROM issue_labels WHERE label_id = :labelId`, { labelId });
    if (Number(usage?.count || 0) > 0) throw new ConflictException('该分类已被议题使用，无法删除');
    const result = await this.db.exec(`DELETE FROM labels WHERE id = :labelId`, { labelId });
    if (result.affectedRows === 0) throw new NotFoundException('分类不存在');
    await this.audit(viewer.id, 'label.delete', 'label', String(labelId), {});
    return { ok: true };
  }

  private async reactionsForComments(commentIds: unknown[], viewerId: string | null) {
    const result = new Map<string, { counts: Record<'like' | 'yes' | 'no', number>; mine: Array<'like' | 'yes' | 'no'> }>();
    if (commentIds.length === 0) return result;
    const rows = await this.db.rows(
      `SELECT comment_id, reaction, COUNT(*) AS count, SUM(user_id = :viewerId) AS mine
       FROM issue_comment_reactions
       WHERE comment_id IN (${commentIds.map((_, index) => `:commentId${index}`).join(',')})
       GROUP BY comment_id, reaction`,
      { viewerId: viewerId || 0, ...Object.fromEntries(commentIds.map((id, index) => [`commentId${index}`, id])) }
    );
    for (const row of rows) {
      const key = String(row.comment_id);
      const summary = result.get(key) || { counts: { like: 0, yes: 0, no: 0 }, mine: [] as Array<'like' | 'yes' | 'no'> };
      const reaction = row.reaction as 'like' | 'yes' | 'no';
      summary.counts[reaction] = Number(row.count);
      if (Number(row.mine) > 0) summary.mine.push(reaction);
      result.set(key, summary);
    }
    return result;
  }

  private async repliesForComments(commentIds: unknown[]) {
    const result = new Map<string, Array<{ id: string; bodyMd: string; createdAt: string; updatedAt: string; author: { id: string; displayName: string; avatarUrl: string | null } }>>();
    if (commentIds.length === 0) return result;
    const rows = await this.db.rows(
      `SELECT r.id, r.comment_id, r.body_md, r.created_at, r.updated_at, u.id AS author_id, u.display_name AS author_name, u.avatar_url AS author_avatar
       FROM issue_comment_replies r
       JOIN users u ON u.id = r.author_id
       WHERE r.comment_id IN (${commentIds.map((_, index) => `:commentId${index}`).join(',')})
       ORDER BY r.created_at ASC`,
      Object.fromEntries(commentIds.map((id, index) => [`commentId${index}`, id]))
    );
    for (const row of rows) {
      const key = String(row.comment_id);
      const items = result.get(key) || [];
      items.push({
        id: String(row.id), bodyMd: row.body_md, createdAt: row.created_at, updatedAt: row.updated_at,
        author: { id: String(row.author_id), displayName: row.author_name, avatarUrl: row.author_avatar }
      });
      result.set(key, items);
    }
    return result;
  }

  private async canViewIssue(issue: any, viewer: Viewer | null) {
    if (viewer?.groups.includes('admin')) return true;
    if (issue.visibility === 'public') return true;
    if (!viewer) return false;
    if (issue.visibility === 'login') return true;
    const row = await this.db.first(
      `SELECT 1 AS ok
       FROM issue_view_groups ivg
       JOIN permission_groups pg ON pg.id = ivg.group_id
       JOIN user_group_memberships ugm ON ugm.group_id = pg.id
       WHERE ivg.issue_id = :issueId AND ugm.user_id = :viewerId
       LIMIT 1`,
      { issueId: issue.id, viewerId: viewer.id }
    );
    return Boolean(row);
  }

  private canCommentOnIssue(issue: any, viewer: Viewer | null) {
    return Boolean(viewer) && issue.status === 'open' && (!issue.comment_ends_at || new Date(issue.comment_ends_at).getTime() >= Date.now());
  }

  private async canVote(issue: any, viewer: Viewer | null) {
    if (!viewer) return false;
    if (!(await this.canViewIssue(issue, viewer))) return false;
    if (issue.status === 'closed' || issue.status === 'archived') return false;
    const now = Date.now();
    if (issue.vote_starts_at && new Date(issue.vote_starts_at).getTime() > now) return false;
    if (issue.vote_ends_at && new Date(issue.vote_ends_at).getTime() < now) return false;
    const voteGroups = await this.groupsForIssue('issue_vote_groups', issue.id);
    if (voteGroups.length === 0) return true;
    return voteGroups.some((group) => viewer.groups.includes(group.groupKey));
  }

  private async voteSummary(issue: any, viewer: Viewer | null) {
    const visible =
      viewer?.groups.includes('admin') ||
      issue.vote_visibility === 'counts_after_vote' ||
      (issue.vote_visibility === 'counts_after_close' && issue.status === 'closed') ||
      (issue.vote_visibility === 'names_after_close' && issue.status === 'closed');
    if (!visible) {
      return { visible: false, agree: null, disagree: null, abstain: null, total: null };
    }
    const rows = await this.db.rows(
      `SELECT choice, COUNT(*) AS count FROM issue_votes WHERE issue_id = :issueId GROUP BY choice`,
      { issueId: issue.id }
    );
    const counts = { agree: 0, disagree: 0, abstain: 0 };
    for (const row of rows) counts[row.choice as VoteChoice] = Number(row.count);
    return { visible: true, ...counts, total: counts.agree + counts.disagree + counts.abstain };
  }

  private async labelsForIssues(issueIds: unknown[]) {
    const map = new Map<string, Array<{ id: number; name: string; color: string }>>();
    if (issueIds.length === 0) return map;
    const rows = await this.db.rows(
      `SELECT il.issue_id, l.id, l.name, l.color
       FROM issue_labels il
       JOIN labels l ON l.id = il.label_id
       WHERE il.issue_id IN (${issueIds.map((_, index) => `:id${index}`).join(',')})
       ORDER BY l.name`,
      Object.fromEntries(issueIds.map((id, index) => [`id${index}`, id]))
    );
    for (const row of rows) {
      const key = String(row.issue_id);
      const list = map.get(key) || [];
      list.push({ id: row.id, name: row.name, color: row.color });
      map.set(key, list);
    }
    return map;
  }

  private async groupsForIssue(table: 'issue_view_groups' | 'issue_vote_groups', issueId: string | number) {
    const rows = await this.db.rows(
      `SELECT pg.group_key, pg.name
       FROM ${table} ig
       JOIN permission_groups pg ON pg.id = ig.group_id
       WHERE ig.issue_id = :issueId
       ORDER BY pg.name`,
      { issueId }
    );
    return rows.map((row) => ({ groupKey: row.group_key, name: row.name }));
  }

  private async replaceLabels(issueId: string | number, labelIds: number[]) {
    await this.db.exec(`DELETE FROM issue_labels WHERE issue_id = :issueId`, { issueId });
    for (const labelId of labelIds) {
      await this.db.exec(`INSERT IGNORE INTO issue_labels (issue_id, label_id) VALUES (:issueId, :labelId)`, {
        issueId,
        labelId
      });
    }
  }

  private async ensureKnownSelections(labelIds: number[], viewGroupKeys: string[], voteGroupKeys: string[]) {
    const groupKeys = uniqueValues([...viewGroupKeys, ...voteGroupKeys]);
    const [knownLabels, knownGroups] = await Promise.all([
      this.findKnownValues('labels', 'id', labelIds),
      this.findKnownValues('permission_groups', 'group_key', groupKeys)
    ]);
    if (knownLabels.size !== labelIds.length) throw new BadRequestException('选择的分类不存在或已被删除，请刷新页面后重试');
    if (knownGroups.size !== groupKeys.length) throw new BadRequestException('选择的权限组不存在或已被删除，请刷新页面后重试');
  }

  private async findKnownValues(table: 'labels' | 'permission_groups', column: 'id' | 'group_key', values: Array<number | string>) {
    if (values.length === 0) return new Set<string>();
    const parameters = Object.fromEntries(values.map((value, index) => [`value${index}`, value]));
    const placeholders = values.map((_, index) => `:value${index}`).join(', ');
    const rows = await this.db.rows(`SELECT ${column} AS value FROM ${table} WHERE ${column} IN (${placeholders})`, parameters);
    return new Set(rows.map((row) => String(row.value)));
  }

  private async replaceIssueGroups(table: 'issue_view_groups' | 'issue_vote_groups', issueId: string | number, groupKeys: string[]) {
    await this.db.exec(`DELETE FROM ${table} WHERE issue_id = :issueId`, { issueId });
    for (const groupKey of groupKeys) {
      await this.db.exec(
        `INSERT IGNORE INTO ${table} (issue_id, group_id)
         SELECT :issueId, id FROM permission_groups WHERE group_key = :groupKey`,
        { issueId, groupKey }
      );
    }
  }

  private requireAnyGroup(viewer: Viewer, groups: string[]) {
    if (!groups.some((group) => viewer.groups.includes(group))) {
      throw new ForbiddenException('权限不足');
    }
  }

  private requireAdmin(viewer: Viewer) {
    if (!viewer.groups.includes('admin')) throw new ForbiddenException('需要管理员权限');
  }

  private requireIssueManager(detail: Awaited<ReturnType<IssuesService['getByNumber']>>, viewer: Viewer) {
    if (!detail.viewer.canEdit || (!viewer.groups.includes('admin') && !viewer.groups.includes('issue_creator'))) {
      throw new ForbiddenException('仅议题发布人或管理员可以执行此操作');
    }
  }

  private async audit(actorId: string, action: string, targetType: string, targetId: string, metadata: unknown) {
    await this.db.exec(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (:actorId, :action, :targetType, :targetId, :metadata, :now)`,
      { actorId, action, targetType, targetId, metadata: JSON.stringify(metadata), now: nowSql() }
    );
  }
}
