import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../db/database.service';
import { nowSql, toSqlDate } from '../db/sql-time';
import type { IssueVisibility, Viewer, VoteChoice } from '../types';

export const createIssueSchema = z.object({
  title: z.string().min(3).max(200),
  bodyMd: z.string().min(1),
  visibility: z.enum(['public', 'login', 'groups']).default('login'),
  viewGroupKeys: z.array(z.string()).default([]),
  voteGroupKeys: z.array(z.string()).default([]),
  labelIds: z.array(z.number()).default([]),
  commentPublishAt: z.string().datetime().nullable().optional(),
  voteStartsAt: z.string().datetime().nullable().optional(),
  voteEndsAt: z.string().datetime().nullable().optional(),
  voteVisibility: z.enum(['counts_after_vote', 'counts_after_close', 'names_after_close', 'admin_only']).default('counts_after_close'),
  allowVoteChange: z.boolean().default(true),
  quorumCount: z.number().int().positive().nullable().optional(),
  passRule: z.enum(['simple_majority', 'two_thirds', 'custom']).default('simple_majority')
});

@Injectable()
export class IssuesService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

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
    const now = nowSql();
    const next = await this.db.first(`SELECT COALESCE(MAX(number), 0) + 1 AS next_number FROM issues`);
    const result = await this.db.exec(
      `INSERT INTO issues
       (number, title, body_md, status, visibility, comment_publish_at, vote_starts_at, vote_ends_at,
        vote_visibility, allow_vote_change, quorum_count, pass_rule, created_by, created_at, updated_at)
       VALUES
       (:number, :title, :bodyMd, 'open', :visibility, :commentPublishAt, :voteStartsAt, :voteEndsAt,
        :voteVisibility, :allowVoteChange, :quorumCount, :passRule, :createdBy, :now, :now)`,
      {
        number: next.next_number,
        title: input.title,
        bodyMd: input.bodyMd,
        visibility: input.visibility,
        commentPublishAt: toSqlDate(input.commentPublishAt || null),
        voteStartsAt: toSqlDate(input.voteStartsAt || null),
        voteEndsAt: toSqlDate(input.voteEndsAt || null),
        voteVisibility: input.voteVisibility,
        allowVoteChange: input.allowVoteChange,
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

    const [labels, viewGroups, voteGroups, summary, myVote] = await Promise.all([
      this.labelsForIssues([issue.id]),
      this.groupsForIssue('issue_view_groups', issue.id),
      this.groupsForIssue('issue_vote_groups', issue.id),
      this.voteSummary(issue, viewer),
      viewer
        ? this.db.first(`SELECT choice, cast_at FROM issue_votes WHERE issue_id = :issueId AND voter_id = :viewerId`, {
            issueId: issue.id,
            viewerId: viewer.id
          })
        : null
    ]);

    return {
      issue: {
        id: String(issue.id),
        number: issue.number,
        title: issue.title,
        bodyMd: issue.body_md,
        status: issue.status,
        visibility: issue.visibility,
        commentPublishAt: issue.comment_publish_at,
        voteStartsAt: issue.vote_starts_at,
        voteEndsAt: issue.vote_ends_at,
        voteVisibility: issue.vote_visibility,
        allowVoteChange: Boolean(issue.allow_vote_change),
        quorumCount: issue.quorum_count,
        passRule: issue.pass_rule,
        createdByName: issue.created_by_name,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        labels: labels.get(String(issue.id)) || [],
        viewGroups,
        voteGroups
      },
      viewer: {
        canComment: Boolean(viewer) && issue.status !== 'archived',
        canVote: await this.canVote(issue, viewer),
        canEdit: Boolean(viewer && (viewer.groups.includes('admin') || String(issue.created_by) === viewer.id)),
        canModerate: Boolean(viewer?.groups.includes('admin'))
      },
      voteSummary: summary,
      myVote: myVote ? { choice: myVote.choice, castAt: myVote.cast_at } : null
    };
  }

  async comments(number: string, viewer: Viewer | null) {
    const { issue } = await this.getByNumber(number, viewer);
    const canModerate = Boolean(viewer?.groups.includes('admin'));
    const rows = await this.db.rows(
      `SELECT c.id, c.body_md, c.publish_at, c.published_at, c.created_at, c.updated_at,
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
    return rows.map((row) => ({
      id: String(row.id),
      bodyMd: row.body_md,
      publishAt: row.publish_at,
      published: !row.publish_at || new Date(row.publish_at).getTime() <= Date.now(),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      author: {
        id: String(row.author_id),
        displayName: row.author_name,
        avatarUrl: row.author_avatar
      },
      viewerCanSeeBeforePublish: canModerate || String(row.author_id) === viewer?.id
    }));
  }

  async createComment(number: string, bodyMd: string, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    if (!detail.viewer.canComment) throw new ForbiddenException('无评论权限');
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

  async vote(number: string, choice: VoteChoice, reason: string | undefined, viewer: Viewer) {
    const detail = await this.getByNumber(number, viewer);
    if (!detail.viewer.canVote) throw new ForbiddenException('当前用户无投票权限或不在投票时间内');
    const existing = await this.db.first(
      `SELECT choice FROM issue_votes WHERE issue_id = :issueId AND voter_id = :voterId`,
      { issueId: detail.issue.id, voterId: viewer.id }
    );
    if (existing && !detail.issue.allowVoteChange) {
      throw new ForbiddenException('该议题不允许改票');
    }
    const now = nowSql();
    if (existing) {
      await this.db.exec(
        `UPDATE issue_votes SET choice = :choice, updated_at = :now WHERE issue_id = :issueId AND voter_id = :voterId`,
        { issueId: detail.issue.id, voterId: viewer.id, choice, now }
      );
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
    this.requireAnyGroup(viewer, ['admin', 'issue_creator']);
    const detail = await this.getByNumber(number, viewer);
    const now = nowSql();
    await this.db.exec(
      `UPDATE issues SET status = 'closed', closed_by = :viewerId, closed_at = :now, updated_at = :now WHERE id = :issueId`,
      { viewerId: viewer.id, now, issueId: detail.issue.id }
    );
    await this.audit(viewer.id, 'issue.close', 'issue', detail.issue.id, { number });
    return this.getByNumber(number, viewer);
  }

  async reopen(number: string, viewer: Viewer) {
    this.requireAnyGroup(viewer, ['admin', 'issue_creator']);
    const detail = await this.getByNumber(number, viewer);
    if (detail.issue.status !== 'closed') throw new ForbiddenException('只有已关闭的议题可以重新开启');
    const now = nowSql();
    await this.db.exec(
      `UPDATE issues SET status = 'open', closed_by = NULL, closed_at = NULL, updated_at = :now WHERE id = :issueId`,
      { now, issueId: detail.issue.id }
    );
    await this.audit(viewer.id, 'issue.reopen', 'issue', detail.issue.id, { number });
    return this.getByNumber(number, viewer);
  }

  async labels() {
    return this.db.rows(`SELECT id, name, color, description FROM labels ORDER BY name`);
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

  private async audit(actorId: string, action: string, targetType: string, targetId: string, metadata: unknown) {
    await this.db.exec(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (:actorId, :action, :targetType, :targetId, :metadata, :now)`,
      { actorId, action, targetType, targetId, metadata: JSON.stringify(metadata), now: nowSql() }
    );
  }
}
