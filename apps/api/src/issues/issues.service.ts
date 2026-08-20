import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService, type DatabaseExecutor } from '../db/database.service';
import { nowSql, toSqlDate } from '../db/sql-time';
import type { IssueOutcome, IssueVisibility, Viewer, VoteChoice } from '../types';
import { AiReviewService } from './ai-review.service';

export const MIN_VOTE_DURATION_MINUTES = 3;
const MIN_VOTE_DURATION_MS = MIN_VOTE_DURATION_MINUTES * 60 * 1000;
const CURRENT_TIME_TOLERANCE_MS = 5_000;

const issueInputSchema = z.object({
  title: z.string().trim().min(3).max(200),
  bodyMd: z.string().trim().min(1).max(1024 * 1024),
  visibility: z.enum(['public', 'login', 'groups', 'admin_only']).default('login'),
  viewGroupKeys: z.array(z.string().trim().min(1).max(80)).max(20).default([]).transform(uniqueValues),
  voteGroupKeys: z.array(z.string().trim().min(1).max(80)).max(20).default([]).transform(uniqueValues),
  labelIds: z.array(z.coerce.number().int().positive()).max(20).default([]).transform(uniqueValues),
  commentPublishAt: z.string().datetime().nullable().optional(),
  commentEndsAt: z.string().datetime().nullable().optional(),
  commentAnonymous: z.boolean().default(false),
  votingEnabled: z.boolean().default(true),
  voteStartsAt: z.string().datetime().nullable().optional(),
  voteEndsAt: z.string().datetime().nullable().optional(),
  voteVisibility: z.enum(['counts_after_vote', 'counts_after_close', 'names_after_close', 'admin_only']).default('counts_after_close'),
  allowVoteChange: z.boolean().default(true),
  maxVoteChanges: z.number().int().min(0).max(100).default(1),
  maxCommentsPerUser: z.number().int().min(1).max(100).default(3),
  quorumCount: z.number().int().positive().nullable().optional(),
  passRule: z.enum(['simple_majority', 'two_thirds', 'custom']).default('simple_majority'),
  customPassRule: z.string().trim().min(1).max(500).nullable().optional()
});

function validateIssueInput(input: z.infer<typeof issueInputSchema>, context: z.RefinementCtx, requireFutureTimes: boolean) {
  if (input.visibility === 'groups' && input.viewGroupKeys.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['viewGroupKeys'], message: '指定权限组可见时，至少选择一个查看权限组' });
  }
  if (input.commentPublishAt && input.commentEndsAt && new Date(input.commentPublishAt).getTime() <= new Date(input.commentEndsAt).getTime()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['commentPublishAt'], message: '意见统一公布时间必须晚于意见截止时间' });
  }
  if (input.voteStartsAt && input.voteEndsAt && new Date(input.voteEndsAt).getTime() <= new Date(input.voteStartsAt).getTime()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['voteEndsAt'], message: '投票结束时间必须晚于开始时间' });
  }
  if (input.voteEndsAt) {
    const publishAt = input.commentPublishAt
      ? new Date(input.commentPublishAt).getTime()
      : input.voteStartsAt
        ? new Date(input.voteStartsAt).getTime()
        : (requireFutureTimes ? Date.now() : null);
    if (publishAt !== null && new Date(input.voteEndsAt).getTime() < publishAt + MIN_VOTE_DURATION_MS) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['voteEndsAt'], message: `投票结束时间必须至少晚于意见统一公布时间 ${MIN_VOTE_DURATION_MINUTES} 分钟` });
    }
  }
  if (requireFutureTimes) {
    const now = Date.now();
    const configuredTimes = [
      ['commentEndsAt', input.commentEndsAt, '意见截止时间'],
      ['commentPublishAt', input.commentPublishAt, '意见统一公布时间'],
      ['voteStartsAt', input.voteStartsAt, '投票开始时间'],
      ['voteEndsAt', input.voteEndsAt, '投票结束时间']
    ] as const;
    for (const [path, value, label] of configuredTimes) {
      if (value && new Date(value).getTime() < now - CURRENT_TIME_TOLERANCE_MS) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `${label}不能早于当前时间` });
      }
    }
  }
  if (input.votingEnabled && Boolean(input.voteStartsAt) !== Boolean(input.voteEndsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['voteStartsAt'], message: '设置自动投票时，开始时间和结束时间必须同时填写' });
  }
  if (!input.votingEnabled && (input.voteStartsAt || input.voteEndsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['votingEnabled'], message: '未启用投票时不能设置投票时间' });
  }
  if (input.passRule === 'custom' && !input.customPassRule) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['customPassRule'], message: '请选择自定义规则说明' });
  }
}

export const createIssueSchema = issueInputSchema.superRefine((input, context) => validateIssueInput(input, context, true));
export const updateIssueSchema = issueInputSchema.superRefine((input, context) => validateIssueInput(input, context, false));

function uniqueValues<T>(values: T[]) {
  return [...new Set(values)];
}

@Injectable()
export class IssuesService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AiReviewService) private readonly aiReview: AiReviewService
  ) {}

  onModuleInit() {
    void this.archiveDueClosedIssues();
    void this.syncVotingLifecycle();
    setInterval(() => void this.archiveDueClosedIssues(), 60 * 60 * 1000).unref();
    setInterval(() => void this.syncVotingLifecycle(), 60 * 1000).unref();
  }

  async list(query: Record<string, unknown>, viewer: Viewer | null) {
    await this.syncVotingLifecycle();
    const conditions = [`i.status NOT IN ('draft', 'pending_review', 'review_rejected')`];
    const params: Record<string, unknown> = {};

    if (query.status) {
      if (query.status === 'open') {
        conditions.push(`i.status IN ('open', 'voting', 'vote_ended')`);
      } else {
        conditions.push('i.status = :status');
        params.status = query.status;
      }
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
        OR (i.visibility = 'groups' AND EXISTS (
          SELECT 1 FROM issue_view_groups ivg
          JOIN permission_groups pg ON pg.id = ivg.group_id
          JOIN user_group_memberships ugm ON ugm.group_id = pg.id
          WHERE ivg.issue_id = i.id AND ugm.user_id = :viewerId
        ))
      )`);
      params.viewerId = viewer.id;
    }

    const rows = await this.db.rows(
      `SELECT i.id, i.number, i.title, i.status, i.visibility, i.voting_enabled, i.comment_anonymous, i.vote_visibility, i.outcome, i.vote_starts_at, i.vote_ends_at,
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
        votingEnabled: Boolean(row.voting_enabled),
        commentAnonymous: Boolean(row.comment_anonymous),
        outcome: row.outcome,
      voteStartsAt: row.vote_starts_at,
      voteEndsAt: row.vote_ends_at,
      updatedAt: row.updated_at,
      createdByName: row.created_by_name,
      commentCount: Number(row.comment_count),
      voteCount: this.voteSummaryVisible(row, viewer) ? Number(row.vote_count) : null,
      labels: labels.get(String(row.id)) || []
    }));
  }

  async create(input: z.infer<typeof createIssueSchema>, viewer: Viewer, aiReviewToken?: string) {
    this.requireIssueSubmitter(viewer);
    if (input.visibility === 'admin_only') throw new BadRequestException('仅管理员可见只能在关闭议题时设置');
    await this.ensureKnownSelections(input.labelIds, input.viewGroupKeys, input.voteGroupKeys);
    const reviewMode = await this.aiReview.mode();
    if (reviewMode === 'ai') await this.aiReview.verifyReviewToken(aiReviewToken, input, viewer);
    const now = nowSql();
    const requiresReview = reviewMode === 'manual' && !this.canPublishIssue(viewer);
    const status = requiresReview ? 'pending_review' : this.initialStatus(input);
    const outcome: IssueOutcome = input.votingEnabled ? 'pending' : 'not_applicable';
    const issueNumber = await this.db.transaction(async (transaction) => {
      const latest = await transaction.first(`SELECT number FROM issues ORDER BY number DESC LIMIT 1 FOR UPDATE`);
      const number = Number(latest?.number || 0) + 1;
      const result = await transaction.exec(
        `INSERT INTO issues
         (number, title, body_md, status, visibility, voting_enabled, comment_publish_at, comment_ends_at, comment_anonymous, vote_starts_at, vote_ends_at,
          vote_visibility, allow_vote_change, max_vote_changes, max_comments_per_user, quorum_count, pass_rule, custom_pass_rule_json, outcome, created_by, created_at, updated_at)
         VALUES
         (:number, :title, :bodyMd, :status, :visibility, :votingEnabled, :commentPublishAt, :commentEndsAt, :commentAnonymous, :voteStartsAt, :voteEndsAt,
          :voteVisibility, :allowVoteChange, :maxVoteChanges, :maxCommentsPerUser, :quorumCount, :passRule, :customPassRule, :outcome, :createdBy, :now, :now)`,
        {
          number,
          title: input.title,
          bodyMd: input.bodyMd,
          status,
          visibility: input.visibility,
          votingEnabled: input.votingEnabled,
          commentPublishAt: toSqlDate(input.commentPublishAt || null),
          commentEndsAt: toSqlDate(input.commentEndsAt || null),
          commentAnonymous: input.commentAnonymous,
          voteStartsAt: toSqlDate(input.votingEnabled ? input.voteStartsAt || null : null),
          voteEndsAt: toSqlDate(input.votingEnabled ? input.voteEndsAt || null : null),
          voteVisibility: input.voteVisibility,
          allowVoteChange: input.allowVoteChange,
          maxVoteChanges: input.maxVoteChanges,
          maxCommentsPerUser: input.maxCommentsPerUser,
          quorumCount: input.quorumCount || null,
          passRule: input.passRule,
          customPassRule: input.passRule === 'custom' ? JSON.stringify({ description: input.customPassRule }) : null,
          outcome,
          createdBy: viewer.id,
          now
        }
      );
      const issueId = result.insertId;
      await this.replaceLabels(issueId, input.labelIds, transaction);
      await this.replaceIssueGroups('issue_view_groups', issueId, input.viewGroupKeys, transaction);
      await this.replaceIssueGroups('issue_vote_groups', issueId, input.voteGroupKeys, transaction);
      await this.audit(viewer.id, requiresReview ? 'issue.submit' : 'issue.create', 'issue', String(issueId), { number }, transaction);
      return number;
    });
    return this.getByNumber(String(issueNumber), viewer);
  }

  async aiReviewDraft(input: { title: string; bodyMd: string }, viewer: Viewer) {
    this.requireIssueSubmitter(viewer);
    return this.aiReview.reviewDraft(input, viewer);
  }

  async reviewQueue(query: Record<string, unknown>, viewer: Viewer) {
    if (await this.aiReview.mode() !== 'manual') throw new ForbiddenException('当前未启用手动预审');
    this.requireIssueReviewer(viewer);
    const params: Record<string, unknown> = {};
    const conditions = [`i.status = 'pending_review'`];
    if (query.q) {
      conditions.push('(i.title LIKE :q OR i.body_md LIKE :q)');
      params.q = `%${String(query.q)}%`;
    }
    const rows = await this.db.rows(
      `SELECT i.id, i.number, i.title, i.body_md, i.visibility, i.voting_enabled, i.created_by, i.created_at, i.updated_at,
              u.display_name AS created_by_name
       FROM issues i
       JOIN users u ON u.id = i.created_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY i.created_at ASC
       LIMIT 100`,
      params
    );
    const labels = await this.labelsForIssues(rows.map((row) => row.id));
    return rows.map((row) => ({
      number: Number(row.number),
      title: row.title,
      bodyMd: row.body_md,
      visibility: row.visibility,
      votingEnabled: Boolean(row.voting_enabled),
      createdByName: row.created_by_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      canReview: String(row.created_by) !== viewer.id,
      labels: labels.get(String(row.id)) || []
    }));
  }

  async review(number: string, decision: 'approve' | 'reject', note: string | null, viewer: Viewer) {
    if (await this.aiReview.mode() !== 'manual') throw new ForbiddenException('当前未启用手动预审');
    this.requireIssueReviewer(viewer);
    const issue = await this.db.first(`SELECT * FROM issues WHERE number = :number`, { number });
    if (!issue) throw new NotFoundException('待预审议题不存在');
    if (issue.status !== 'pending_review') throw new ForbiddenException('该议题不在待预审状态');
    if (String(issue.created_by) === viewer.id) throw new ForbiddenException('不能预审自己提交的议题');

    const approved = decision === 'approve';
    const now = nowSql();
    await this.db.exec(
      `UPDATE issues
       SET status = :status, reviewed_by = :reviewedBy, reviewed_at = :now, review_note = :reviewNote, updated_at = :now
       WHERE id = :issueId`,
      {
        status: approved ? 'open' : 'review_rejected',
        reviewedBy: viewer.id,
        reviewNote: note,
        now,
        issueId: issue.id
      }
    );
    await this.audit(viewer.id, approved ? 'issue.review_approve' : 'issue.review_reject', 'issue', String(issue.id), {
      number: Number(issue.number),
      note
    });
    return { number: Number(issue.number), status: approved ? 'open' : 'review_rejected' };
  }

  async getByNumber(number: string, viewer: Viewer | null) {
    await this.syncVotingLifecycle();
    const issue = await this.db.first(
      `SELECT i.*, u.display_name AS created_by_name, outcome_user.display_name AS outcome_confirmed_by_name,
              review_user.display_name AS reviewed_by_name
       FROM issues i
       JOIN users u ON u.id = i.created_by
       LEFT JOIN users outcome_user ON outcome_user.id = i.outcome_confirmed_by
       LEFT JOIN users review_user ON review_user.id = i.reviewed_by
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
        votingEnabled: Boolean(issue.voting_enabled),
        commentPublishAt: issue.comment_publish_at,
        commentEndsAt: issue.comment_ends_at,
        commentAnonymous: Boolean(issue.comment_anonymous),
        voteStartsAt: issue.vote_starts_at,
        voteEndsAt: issue.vote_ends_at,
        voteVisibility: issue.vote_visibility,
        allowVoteChange: Boolean(issue.allow_vote_change),
        maxVoteChanges: Number(issue.max_vote_changes),
        maxCommentsPerUser: Number(issue.max_comments_per_user),
        quorumCount: issue.quorum_count,
        passRule: issue.pass_rule,
        customPassRule: this.customPassRule(issue.custom_pass_rule_json),
        outcome: issue.outcome,
        outcomeConfirmedByName: issue.outcome_confirmed_by_name,
        outcomeConfirmedAt: issue.outcome_confirmed_at,
        reviewedByName: issue.reviewed_by_name,
        reviewedAt: issue.reviewed_at,
        reviewNote: issue.review_note,
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
        canModerate: Boolean(viewer?.groups.includes('admin')),
        canStartVoting: Boolean(viewer && (viewer.groups.includes('admin') || String(issue.created_by) === viewer.id) && Boolean(issue.voting_enabled) && issue.status === 'open' && !issue.vote_starts_at && !issue.vote_ends_at),
        canConfirmOutcome: Boolean(viewer && ['admin', 'auditor'].some((group) => viewer.groups.includes(group)) && issue.status === 'closed' && issue.outcome === 'manual_required')
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
      this.repliesForComments(commentIds, viewer, Boolean(issue.commentAnonymous), issue.status !== 'archived')
    ]);
    return rows.map((row) => ({
      id: String(row.id),
      bodyMd: row.body_md,
      publishAt: row.publish_at,
      published: !row.publish_at || new Date(row.publish_at).getTime() <= Date.now(),
      editedAt: row.edited_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      author: this.commentAuthor(row, Boolean(issue.commentAnonymous)),
      viewerCanSeeBeforePublish: canModerate || String(row.author_id) === viewer?.id,
      viewerCanEdit: Boolean(viewer && String(row.author_id) === viewer.id && this.canCommentOnIssue(issue, viewer)),
      viewerCanDelete: Boolean(issue.status !== 'archived' && viewer && (String(row.author_id) === viewer.id || viewer.groups.includes('admin'))),
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

  async deleteComment(number: string, commentId: string, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    if (detail.issue.status === 'archived') throw new ForbiddenException('已归档议题的意见不可删除');
    const comment = await this.db.first(
      `SELECT id, author_id FROM issue_comments WHERE id = :commentId AND issue_id = :issueId AND deleted_at IS NULL`,
      { commentId, issueId: detail.issue.id }
    );
    if (!comment) throw new NotFoundException('意见不存在');
    if (String(comment.author_id) !== viewer.id && !viewer.groups.includes('admin')) {
      throw new ForbiddenException('只能由发送人或管理员删除意见');
    }
    const now = nowSql();
    await this.db.exec(
      `UPDATE issue_comments SET deleted_at = :now, updated_at = :now
       WHERE id = :commentId AND deleted_at IS NULL`,
      { commentId, now }
    );
    await this.audit(viewer.id, 'comment.delete', 'issue_comment', String(commentId), { issueNumber: number });
    return { ok: true };
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

  async deleteCommentReply(number: string, commentId: string, replyId: string, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    if (detail.issue.status === 'archived') throw new ForbiddenException('已归档议题的回复不可删除');
    const reply = await this.replyForComment(detail.issue.id, commentId, replyId);
    if (!reply) throw new NotFoundException('意见回复不存在');
    if (String(reply.author_id) !== viewer.id && !viewer.groups.includes('admin')) {
      throw new ForbiddenException('只能由发送人或管理员删除意见回复');
    }
    const now = nowSql();
    await this.db.exec(
      `UPDATE issue_comment_replies SET deleted_at = :now, updated_at = :now
       WHERE id = :replyId AND deleted_at IS NULL AND hidden_at IS NULL`,
      { replyId, now }
    );
    await this.audit(viewer.id, 'comment.reply.delete', 'issue_comment_reply', String(replyId), { issueNumber: number, commentId: String(commentId) });
    return { ok: true };
  }

  async hideCommentReply(number: string, commentId: string, replyId: string, viewer: Viewer) {
    this.requireAdmin(viewer);
    const detail = await this.getByNumber(number, viewer);
    if (detail.issue.status === 'archived') throw new ForbiddenException('已归档议题的回复不可屏蔽');
    const reply = await this.replyForComment(detail.issue.id, commentId, replyId);
    if (!reply) throw new NotFoundException('意见回复不存在');
    const now = nowSql();
    await this.db.exec(
      `UPDATE issue_comment_replies SET hidden_at = :now, hidden_by = :viewerId, updated_at = :now
       WHERE id = :replyId AND deleted_at IS NULL AND hidden_at IS NULL`,
      { replyId, viewerId: viewer.id, now }
    );
    await this.audit(viewer.id, 'comment.reply.hide', 'issue_comment_reply', String(replyId), { issueNumber: number, commentId: String(commentId) });
    return { ok: true };
  }

  async vote(number: string, choice: VoteChoice, reason: string | undefined, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    if (!detail.viewer.canVote) throw new ForbiddenException('当前用户无投票权限或不在投票时间内');
    await this.db.transaction(async (transaction) => {
      const lockedIssue = await transaction.first(
        `SELECT status FROM issues WHERE id = :issueId FOR UPDATE`,
        { issueId: detail.issue.id }
      );
      if (!lockedIssue || lockedIssue.status !== 'voting') throw new ConflictException('投票已经结束，请刷新后重试');
      const existing = await transaction.first(
        `SELECT choice, change_count FROM issue_votes WHERE issue_id = :issueId AND voter_id = :voterId FOR UPDATE`,
        { issueId: detail.issue.id, voterId: viewer.id }
      );
      if (existing?.choice === choice) return;
      if (existing && !detail.issue.allowVoteChange) throw new ForbiddenException('本议题禁止修改投票');
      if (existing && Number(existing.change_count) >= detail.issue.maxVoteChanges) {
        throw new ForbiddenException(`该议题最多允许重投 ${detail.issue.maxVoteChanges} 次`);
      }
      const now = nowSql();
      if (existing) {
        const result = await transaction.exec(
          `UPDATE issue_votes SET choice = :choice, change_count = change_count + 1, updated_at = :now
           WHERE issue_id = :issueId AND voter_id = :voterId AND change_count < :maxVoteChanges`,
          { issueId: detail.issue.id, voterId: viewer.id, choice, now, maxVoteChanges: detail.issue.maxVoteChanges }
        );
        if (result.affectedRows === 0) throw new ConflictException('重投次数已达到上限，请刷新后重试');
      } else {
        await transaction.exec(
          `INSERT INTO issue_votes (issue_id, voter_id, choice, cast_at, updated_at)
           VALUES (:issueId, :voterId, :choice, :now, :now)`,
          { issueId: detail.issue.id, voterId: viewer.id, choice, now }
        );
      }
      await transaction.exec(
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
      await this.audit(viewer.id, 'vote.cast', 'issue', detail.issue.id, { choice, oldChoice: existing?.choice || null }, transaction);
    });
    return this.getByNumber(number, viewer);
  }

  async close(number: string, closeVisibility: 'retain' | 'public' | 'admin_only', viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    this.requireIssueManager(detail, viewer);
    if (!['open', 'voting', 'vote_ended'].includes(detail.issue.status)) throw new ForbiddenException('只有开放中的议题可以关闭');
    await this.closeIssue(detail.issue, viewer, 'manual', closeVisibility);
    if (closeVisibility === 'admin_only' && !viewer.groups.includes('admin')) {
      return { hidden: true, number: detail.issue.number, status: 'closed', visibility: 'admin_only' as const };
    }
    return this.getByNumber(number, viewer);
  }

  async endVoting(number: string, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    this.requireIssueManager(detail, viewer);
    if (detail.issue.status !== 'voting') throw new ForbiddenException('只有投票中的议题可以结束投票');
    const transitioned = await this.transitionVotingEnded(detail.issue.id, viewer, 'manual');
    if (!transitioned) throw new ConflictException('投票状态已经变化，请刷新后重试');
    return this.getByNumber(number, viewer);
  }

  async startVoting(number: string, durationMinutes: number, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    this.requireIssueManager(detail, viewer);
    if (!detail.issue.votingEnabled) throw new ForbiddenException('本议题未启用投票');
    if (detail.issue.status !== 'open') throw new ForbiddenException('只有开放讨论中的议题可以开始投票');
    if (detail.issue.voteStartsAt || detail.issue.voteEndsAt) throw new ForbiddenException('已设置自动投票时间的议题会按计划开始');
    if (!Number.isInteger(durationMinutes) || durationMinutes < MIN_VOTE_DURATION_MINUTES || durationMinutes > 43_200) {
      throw new BadRequestException(`手动投票时长必须在 ${MIN_VOTE_DURATION_MINUTES} 分钟到 30 天之间`);
    }
    const endsAt = Date.now() + durationMinutes * 60_000;
    const publishAt = detail.issue.commentPublishAt ? new Date(detail.issue.commentPublishAt).getTime() : Date.now();
    if (endsAt < publishAt + MIN_VOTE_DURATION_MS) {
      throw new BadRequestException(`投票结束时间必须至少晚于意见统一公布时间 ${MIN_VOTE_DURATION_MINUTES} 分钟`);
    }
    const transitioned = await this.transitionVotingStarted(detail.issue.id, viewer, 'manual', durationMinutes);
    if (!transitioned) throw new ConflictException('议题状态已经变化，请刷新后重试');
    return this.getByNumber(number, viewer);
  }

  async confirmOutcome(number: string, outcome: 'passed' | 'rejected', viewer: Viewer) {
    if (!viewer.groups.some((group) => ['admin', 'auditor'].includes(group))) throw new ForbiddenException('需要管理员或审计员权限');
    const detail = await this.getByNumber(number, viewer);
    if (detail.issue.status !== 'closed' || detail.issue.outcome !== 'manual_required') {
      throw new ForbiddenException('只有等待人工确认结果的已关闭议题可以确认');
    }
    const now = nowSql();
    await this.db.exec(
      `UPDATE issues SET outcome = :outcome, outcome_confirmed_by = :viewerId, outcome_confirmed_at = :now, updated_at = :now WHERE id = :issueId`,
      { outcome, viewerId: viewer.id, now, issueId: detail.issue.id }
    );
    await this.audit(viewer.id, 'issue.outcome.confirm', 'issue', detail.issue.id, { number, outcome });
    return this.getByNumber(number, viewer);
  }

  async reopen(number: string, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    this.requireIssueManager(detail, viewer);
    if (detail.issue.status !== 'closed') throw new ForbiddenException('只有已关闭的议题可以重新开启');
    const now = nowSql();
    await this.db.exec(
      `UPDATE issues SET status = 'open', outcome = :outcome, outcome_confirmed_by = NULL, outcome_confirmed_at = NULL,
       closed_by = NULL, closed_at = NULL, updated_at = :now WHERE id = :issueId`,
      { now, issueId: detail.issue.id, outcome: detail.issue.votingEnabled ? 'pending' : 'not_applicable' }
    );
    await this.audit(viewer.id, 'issue.reopen', 'issue', detail.issue.id, { number });
    return this.getByNumber(number, viewer);
  }

  async update(number: string, input: z.infer<typeof updateIssueSchema>, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    if (!detail.viewer.canEdit || detail.issue.status === 'archived') throw new ForbiddenException('无编辑权限或议题已归档');
    this.ensureChangedTimesNotPast(detail.issue, input);
    if (input.visibility === 'admin_only' && detail.issue.visibility !== 'admin_only') {
      throw new BadRequestException('仅管理员可见只能在关闭议题时设置');
    }
    await this.ensureKnownSelections(input.labelIds, input.viewGroupKeys, input.voteGroupKeys);
    const now = nowSql();
    const reviewMode = await this.aiReview.mode();
    const rejectedIssue = detail.issue.status === 'review_rejected';
    const resubmitting = rejectedIssue && reviewMode === 'manual' && !this.canPublishIssue(viewer);
    const releasingRejectedIssue = rejectedIssue && reviewMode !== 'manual';
    if (rejectedIssue && reviewMode === 'ai') {
      const aiResult = await this.aiReview.reviewDraft({ title: input.title, bodyMd: input.bodyMd }, viewer);
      if (!aiResult.approved) throw new ForbiddenException(`AI 预审未通过：${aiResult.summary}`);
    }
    const status = resubmitting ? 'pending_review' : releasingRejectedIssue ? this.initialStatus(input) : this.updatedStatus(detail.issue.status, input);
    const outcome = !input.votingEnabled ? 'not_applicable' : detail.issue.status === 'closed' && input.passRule === 'custom' ? 'manual_required' : detail.issue.outcome;
    await this.db.transaction(async (transaction) => {
      await transaction.exec(
        `UPDATE issues SET title = :title, body_md = :bodyMd, visibility = :visibility, comment_publish_at = :commentPublishAt,
         comment_ends_at = :commentEndsAt, comment_anonymous = :commentAnonymous, voting_enabled = :votingEnabled, vote_starts_at = :voteStartsAt, vote_ends_at = :voteEndsAt, vote_visibility = :voteVisibility,
         allow_vote_change = :allowVoteChange, max_vote_changes = :maxVoteChanges, max_comments_per_user = :maxCommentsPerUser,
         quorum_count = :quorumCount, pass_rule = :passRule, custom_pass_rule_json = :customPassRule, status = :status, outcome = :outcome,
         outcome_confirmed_by = CASE WHEN :outcome = 'manual_required' THEN outcome_confirmed_by ELSE NULL END,
         outcome_confirmed_at = CASE WHEN :outcome = 'manual_required' THEN outcome_confirmed_at ELSE NULL END,
         reviewed_by = CASE WHEN :clearReview = 1 THEN NULL ELSE reviewed_by END,
         reviewed_at = CASE WHEN :clearReview = 1 THEN NULL ELSE reviewed_at END,
         review_note = CASE WHEN :clearReview = 1 THEN NULL ELSE review_note END,
         content_edited_at = :now, updated_at = :now
         WHERE id = :issueId`,
        { title: input.title, bodyMd: input.bodyMd, visibility: input.visibility, commentPublishAt: toSqlDate(input.commentPublishAt || null), commentEndsAt: toSqlDate(input.commentEndsAt || null), commentAnonymous: input.commentAnonymous, votingEnabled: input.votingEnabled, voteStartsAt: toSqlDate(input.votingEnabled ? input.voteStartsAt || null : null), voteEndsAt: toSqlDate(input.votingEnabled ? input.voteEndsAt || null : null), voteVisibility: input.voteVisibility, allowVoteChange: input.allowVoteChange, maxVoteChanges: input.maxVoteChanges, maxCommentsPerUser: input.maxCommentsPerUser, quorumCount: input.quorumCount || null, passRule: input.passRule, customPassRule: input.passRule === 'custom' ? JSON.stringify({ description: input.customPassRule }) : null, status, outcome, clearReview: (resubmitting || releasingRejectedIssue) ? 1 : 0, now, issueId: detail.issue.id }
      );
      await this.replaceLabels(detail.issue.id, input.labelIds, transaction);
      await this.replaceIssueGroups('issue_view_groups', detail.issue.id, input.viewGroupKeys, transaction);
      await this.replaceIssueGroups('issue_vote_groups', detail.issue.id, input.voteGroupKeys, transaction);
      await this.audit(viewer.id, resubmitting ? 'issue.resubmit' : 'issue.edit', 'issue', detail.issue.id, { number }, transaction);
    });
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

  private initialStatus(input: z.infer<typeof createIssueSchema>) {
    return 'open';
  }

  private updatedStatus(currentStatus: string, input: z.infer<typeof updateIssueSchema>) {
    if (!input.votingEnabled) return currentStatus === 'voting' ? 'open' : currentStatus;
    return currentStatus;
  }

  private async transitionVotingStarted(issueId: string, viewer: Viewer | null, mode: 'manual' | 'scheduled', durationMinutes?: number) {
    return this.db.transaction(async (transaction) => {
      const issue = await transaction.first(
        `SELECT id, number, status, voting_enabled, vote_starts_at, vote_ends_at,
                vote_starts_at <= UTC_TIMESTAMP() AS has_started,
                vote_ends_at <= UTC_TIMESTAMP() AS has_ended
         FROM issues WHERE id = :issueId FOR UPDATE`,
        { issueId }
      );
      if (!issue || issue.status !== 'open' || !Boolean(issue.voting_enabled)) return false;
      if (mode === 'scheduled') {
        if (!issue.vote_starts_at || !issue.vote_ends_at) return false;
        if (Number(issue.has_started) !== 1 || Number(issue.has_ended) === 1) return false;
      }
      const currentTime = Date.now();
      const now = nowSql();
      const voteEndsAt = mode === 'manual'
        ? toSqlDate(new Date(currentTime + Number(durationMinutes) * 60_000).toISOString())
        : issue.vote_ends_at;
      const result = await transaction.exec(
        `UPDATE issues
         SET status = 'voting', vote_starts_at = CASE WHEN :manual = 1 THEN :now ELSE vote_starts_at END,
             vote_ends_at = :voteEndsAt, updated_at = :now
         WHERE id = :issueId AND status = 'open'`,
        { manual: mode === 'manual' ? 1 : 0, now, voteEndsAt, issueId }
      );
      if (result.affectedRows === 0) return false;
      await this.audit(viewer?.id || null, 'issue.vote_start', 'issue', String(issue.id), {
        number: Number(issue.number),
        mode,
        ...(mode === 'manual' ? { durationMinutes } : {})
      }, transaction);
      return true;
    });
  }

  private async transitionVotingEnded(issueId: string, viewer: Viewer | null, mode: 'manual' | 'scheduled') {
    return this.db.transaction(async (transaction) => {
      const issue = await transaction.first(
        `SELECT id, number, status, vote_ends_at, vote_ends_at <= UTC_TIMESTAMP() AS has_ended
         FROM issues WHERE id = :issueId FOR UPDATE`,
        { issueId }
      );
      const allowedStatuses = mode === 'scheduled' ? ['open', 'voting'] : ['voting'];
      if (!issue || !allowedStatuses.includes(String(issue.status))) return false;
      if (mode === 'scheduled' && (!issue.vote_ends_at || Number(issue.has_ended) !== 1)) return false;
      const now = nowSql();
      const result = await transaction.exec(
        `UPDATE issues
         SET status = 'vote_ended', vote_ends_at = CASE WHEN :manual = 1 THEN :now ELSE vote_ends_at END, updated_at = :now
         WHERE id = :issueId AND status = :expectedStatus`,
        { manual: mode === 'manual' ? 1 : 0, now, issueId, expectedStatus: issue.status }
      );
      if (result.affectedRows === 0) return false;
      await this.audit(viewer?.id || null, mode === 'manual' ? 'issue.vote_end' : 'issue.vote_end_auto', 'issue', String(issue.id), {
        number: Number(issue.number),
        mode
      }, transaction);
      return true;
    });
  }

  private async closeIssue(issue: { id: string; number?: number; votingEnabled: boolean; passRule: string }, viewer: Viewer | null, mode: 'manual' | 'scheduled', closeVisibility: 'retain' | 'public' | 'admin_only') {
    await this.db.transaction(async (transaction) => {
      const lockedIssue = await transaction.first(`SELECT status FROM issues WHERE id = :issueId FOR UPDATE`, { issueId: issue.id });
      if (!lockedIssue || !['open', 'voting', 'vote_ended'].includes(String(lockedIssue.status))) {
        throw new ConflictException('议题状态已经变化，请刷新后重试');
      }
      const now = nowSql();
      const outcome = await this.outcomeForIssue(issue.id, issue.votingEnabled, issue.passRule, transaction);
      await transaction.exec(
        `UPDATE issues SET status = 'closed', visibility = CASE
           WHEN :closeVisibility = 'public' THEN 'public'
           WHEN :closeVisibility = 'admin_only' THEN 'admin_only'
           ELSE visibility
         END,
         closed_by = :viewerId, closed_at = :now, outcome = :outcome, outcome_confirmed_by = NULL,
         outcome_confirmed_at = NULL, updated_at = :now WHERE id = :issueId`,
        { closeVisibility, viewerId: viewer?.id || null, now, outcome, issueId: issue.id }
      );
      if (closeVisibility === 'public') await this.replaceIssueGroups('issue_view_groups', issue.id, [], transaction);
      await this.audit(viewer?.id || null, mode === 'manual' ? 'issue.close' : 'issue.vote_end_auto', 'issue', issue.id, {
        number: issue.number,
        outcome,
        visibility: closeVisibility
      }, transaction);
    });
  }

  private async outcomeForIssue(issueId: string | number, votingEnabled: boolean, passRule: string, executor: DatabaseExecutor = this.db): Promise<IssueOutcome> {
    if (!votingEnabled) return 'not_applicable';
    if (passRule === 'custom') return 'manual_required';
    const rows = await executor.rows(`SELECT choice, COUNT(*) AS count FROM issue_votes WHERE issue_id = :issueId GROUP BY choice`, { issueId });
    const counts = { agree: 0, disagree: 0 };
    for (const row of rows) {
      if (row.choice === 'agree' || row.choice === 'disagree') counts[row.choice] = Number(row.count);
    }
    const validVotes = counts.agree + counts.disagree;
    if (validVotes === 0) return 'rejected';
    const passed = passRule === 'two_thirds' ? counts.agree * 3 >= validVotes * 2 : counts.agree > counts.disagree;
    return passed ? 'passed' : 'rejected';
  }

  private async syncVotingLifecycle() {
    try {
      const dueIssues = await this.db.rows(
        `SELECT id
         FROM issues
         WHERE status IN ('open', 'voting')
           AND voting_enabled = TRUE
           AND vote_starts_at IS NOT NULL
           AND vote_ends_at IS NOT NULL
           AND vote_ends_at <= UTC_TIMESTAMP()`
      );
      for (const issue of dueIssues) {
        await this.transitionVotingEnded(String(issue.id), null, 'scheduled');
      }
      const startingIssues = await this.db.rows(
        `SELECT id
         FROM issues
         WHERE status = 'open'
           AND voting_enabled = TRUE
           AND vote_starts_at IS NOT NULL
           AND vote_ends_at IS NOT NULL
           AND vote_starts_at <= UTC_TIMESTAMP()
           AND vote_ends_at > UTC_TIMESTAMP()`
      );
      for (const issue of startingIssues) {
        await this.transitionVotingStarted(String(issue.id), null, 'scheduled');
      }
    } catch {
      // Automatic voting transitions are retried on the next request and once per minute.
    }
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

  private async repliesForComments(commentIds: unknown[], viewer: Viewer | null, anonymous: boolean, canMutate: boolean) {
    const result = new Map<string, Array<any>>();
    if (commentIds.length === 0) return result;
    const rows = await this.db.rows(
      `SELECT r.id, r.comment_id, r.body_md, r.created_at, r.updated_at, u.id AS author_id, u.display_name AS author_name, u.avatar_url AS author_avatar
       FROM issue_comment_replies r
       JOIN users u ON u.id = r.author_id
       WHERE r.comment_id IN (${commentIds.map((_, index) => `:commentId${index}`).join(',')})
         AND r.deleted_at IS NULL
         AND r.hidden_at IS NULL
       ORDER BY r.created_at ASC`,
      Object.fromEntries(commentIds.map((id, index) => [`commentId${index}`, id]))
    );
    for (const row of rows) {
      const key = String(row.comment_id);
      const items = result.get(key) || [];
      items.push({
        id: String(row.id), bodyMd: row.body_md, createdAt: row.created_at, updatedAt: row.updated_at,
        author: this.commentAuthor(row, anonymous),
        viewerCanDelete: Boolean(canMutate && viewer && (String(row.author_id) === viewer.id || viewer.groups.includes('admin'))),
        viewerCanModerate: Boolean(canMutate && viewer?.groups.includes('admin'))
      });
      result.set(key, items);
    }
    return result;
  }

  private commentAuthor(row: any, anonymous: boolean) {
    if (anonymous) return { id: 'anonymous', displayName: '匿名成员', avatarUrl: null };
    return { id: String(row.author_id), displayName: row.author_name, avatarUrl: row.author_avatar };
  }

  private async replyForComment(issueId: string, commentId: string, replyId: string) {
    return this.db.first(
      `SELECT r.id, r.author_id
       FROM issue_comment_replies r
       JOIN issue_comments c ON c.id = r.comment_id
       WHERE r.id = :replyId
         AND r.comment_id = :commentId
         AND c.issue_id = :issueId
         AND r.deleted_at IS NULL
         AND r.hidden_at IS NULL
       LIMIT 1`,
      { issueId, commentId, replyId }
    );
  }

  private async canViewIssue(issue: any, viewer: Viewer | null) {
    if (viewer?.groups.includes('admin')) return true;
    if (issue.status === 'pending_review') {
      return Boolean(viewer && (String(issue.created_by) === viewer.id || this.canReviewIssueSubmissions(viewer)));
    }
    if (issue.status === 'review_rejected') {
      return Boolean(viewer && (String(issue.created_by) === viewer.id || String(issue.reviewed_by) === viewer.id));
    }
    if (issue.visibility === 'public') return true;
    if (issue.visibility === 'admin_only') return false;
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
    const endsAt = issue.comment_ends_at || issue.commentEndsAt;
    return Boolean(viewer) && ['open', 'vote_ended'].includes(issue.status) && (!endsAt || new Date(endsAt).getTime() >= Date.now());
  }

  private async canVote(issue: any, viewer: Viewer | null) {
    if (!viewer) return false;
    if (!(await this.canViewIssue(issue, viewer))) return false;
    if (!Boolean(issue.voting_enabled) || issue.status !== 'voting') return false;
    const voteGroups = await this.groupsForIssue('issue_vote_groups', issue.id);
    if (voteGroups.length === 0) return true;
    return voteGroups.some((group) => viewer.groups.includes(group.groupKey));
  }

  private async voteSummary(issue: any, viewer: Viewer | null) {
    if (!this.voteSummaryVisible(issue, viewer)) {
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

  private voteSummaryVisible(issue: any, viewer: Viewer | null) {
    const visibility = issue.vote_visibility || issue.voteVisibility;
    const votingFinished = ['vote_ended', 'closed', 'archived'].includes(String(issue.status));
    return visibility === 'counts_after_vote'
      || (votingFinished && ['counts_after_close', 'names_after_close'].includes(String(visibility)))
      || (votingFinished && visibility === 'admin_only' && Boolean(viewer?.groups.includes('admin')));
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

  private async replaceLabels(issueId: string | number, labelIds: number[], executor: DatabaseExecutor = this.db) {
    await executor.exec(`DELETE FROM issue_labels WHERE issue_id = :issueId`, { issueId });
    for (const labelId of labelIds) {
      await executor.exec(`INSERT IGNORE INTO issue_labels (issue_id, label_id) VALUES (:issueId, :labelId)`, {
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

  private customPassRule(value: string | null) {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed?.description === 'string' ? parsed.description : null;
    } catch {
      return null;
    }
  }

  private ensureChangedTimesNotPast(issue: any, input: z.infer<typeof updateIssueSchema>) {
    const now = Date.now();
    const configuredTimes = [
      [input.commentEndsAt, issue.commentEndsAt, '意见截止时间'],
      [input.commentPublishAt, issue.commentPublishAt, '意见统一公布时间'],
      [input.voteStartsAt, issue.voteStartsAt, '投票开始时间'],
      [input.voteEndsAt, issue.voteEndsAt, '投票结束时间']
    ] as const;
    for (const [nextValue, currentValue, label] of configuredTimes) {
      if (!nextValue) continue;
      const nextTime = new Date(nextValue).getTime();
      const currentTime = currentValue ? new Date(currentValue).getTime() : null;
      if (nextTime < now && nextTime !== currentTime) throw new BadRequestException(`${label}不能早于当前时间`);
    }
  }

  private async replaceIssueGroups(table: 'issue_view_groups' | 'issue_vote_groups', issueId: string | number, groupKeys: string[], executor: DatabaseExecutor = this.db) {
    await executor.exec(`DELETE FROM ${table} WHERE issue_id = :issueId`, { issueId });
    for (const groupKey of groupKeys) {
      await executor.exec(
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

  private canPublishIssue(viewer: Viewer) {
    return viewer.groups.some((group) => ['admin', 'issue_creator'].includes(group));
  }

  private canReviewIssueSubmissions(viewer: Viewer) {
    return viewer.groups.some((group) => ['member', 'council', 'issue_creator', 'admin', 'auditor'].includes(group));
  }

  private requireIssueSubmitter(viewer: Viewer) {
    if (!this.canReviewIssueSubmissions(viewer) && !this.hasFeishuDepartmentGroup(viewer)) {
      throw new ForbiddenException('需要普通成员或飞书部门权限才能提交议题');
    }
  }

  private hasFeishuDepartmentGroup(viewer: Viewer) {
    return viewer.groups.some((group) => group.startsWith('feishu_dept_'));
  }

  private requireIssueReviewer(viewer: Viewer) {
    if (!this.canReviewIssueSubmissions(viewer)) throw new ForbiddenException('需要普通成员或更高权限才能预审议题');
  }

  private requireAdmin(viewer: Viewer) {
    if (!viewer.groups.includes('admin')) throw new ForbiddenException('需要管理员权限');
  }

  private requireIssueManager(detail: Awaited<ReturnType<IssuesService['getByNumber']>>, viewer: Viewer) {
    if (!detail.viewer.canEdit) {
      throw new ForbiddenException('仅议题发布人或管理员可以执行此操作');
    }
  }

  private async audit(actorId: string | null, action: string, targetType: string, targetId: string, metadata: unknown, executor: DatabaseExecutor = this.db) {
    await executor.exec(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (:actorId, :action, :targetType, :targetId, :metadata, :now)`,
      { actorId, action, targetType, targetId, metadata: JSON.stringify(metadata), now: nowSql() }
    );
  }
}
