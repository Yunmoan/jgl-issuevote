import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { AuthService } from './auth/auth.service';
import { createIssueSchema, IssuesService, MIN_VOTE_DURATION_MINUTES } from './issues/issues.service';
import type { Viewer } from './types';

const activeViewer: Viewer = {
  id: '7',
  displayName: '测试成员',
  avatarUrl: null,
  email: null,
  status: 'active',
  groups: ['member'],
  boundProviders: ['natayarkid']
};

test('disabled sessions are not restored as authenticated viewers', async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'regression-test-session-secret';
  try {
    const database = {
      first: async () => ({ id: 7, display_name: '停用成员', avatar_url: null, email: null, status: 'disabled' }),
      rows: async () => []
    };
    const auth = new AuthService(database as never, {} as never);
    const token = jwt.sign({ sub: '7' }, process.env.SESSION_SECRET);
    const request = { cookies: { jgl_session: token }, header: () => undefined } as unknown as Request;
    assert.equal(await auth.viewerFromRequest(request), null);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test('required identity binding blocks business data but can be checked independently from login', () => {
  const previous = process.env.AUTH_REQUIRE_FEISHU_FOR_DATA_ACCESS;
  process.env.AUTH_REQUIRE_FEISHU_FOR_DATA_ACCESS = 'true';
  try {
    const auth = new AuthService({} as never, {} as never);
    assert.throws(() => auth.assertDataAccess(activeViewer), ForbiddenException);
  } finally {
    if (previous === undefined) delete process.env.AUTH_REQUIRE_FEISHU_FOR_DATA_ACCESS;
    else process.env.AUTH_REQUIRE_FEISHU_FOR_DATA_ACCESS = previous;
  }
});

test('NatayarkID link context cannot target a user other than the current session', async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'regression-test-session-secret';
  try {
    const auth = new AuthService({} as never, {} as never);
    (auth as unknown as { viewerFromRequest: () => Promise<Viewer> }).viewerFromRequest = async () => activeViewer;
    const context = jwt.sign({ sub: '99', state: 'oauth-state', purpose: 'natayarkid_link' }, process.env.SESSION_SECRET);
    const request = { cookies: { nyk_oauth_link_context: context } } as unknown as Request;
    const verify = (auth as unknown as {
      verifiedNatayarkIdLinkUser: (request: Request, state: string) => Promise<string | null>;
    }).verifiedNatayarkIdLinkUser.bind(auth);
    await assert.rejects(() => verify(request, 'oauth-state'), UnauthorizedException);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test('scheduled voting must end at least three minutes after comment publication', () => {
  const publishAt = Date.now() + 10 * 60_000;
  const input = {
    title: '投票时间约束测试',
    bodyMd: '测试正文',
    votingEnabled: true,
    commentPublishAt: new Date(publishAt).toISOString(),
    voteStartsAt: new Date(publishAt - 60_000).toISOString(),
    voteEndsAt: new Date(publishAt + (MIN_VOTE_DURATION_MINUTES - 1) * 60_000).toISOString()
  };
  assert.equal(createIssueSchema.safeParse(input).success, false);
  assert.equal(createIssueSchema.safeParse({
    ...input,
    voteEndsAt: new Date(publishAt + MIN_VOTE_DURATION_MINUTES * 60_000).toISOString()
  }).success, true);
});

test('comment publication must be later than the comment deadline', () => {
  const deadline = Date.now() + 10 * 60_000;
  const input = {
    title: '意见公布顺序测试',
    bodyMd: '测试正文',
    votingEnabled: false,
    commentEndsAt: new Date(deadline).toISOString(),
    commentPublishAt: new Date(deadline - 60_000).toISOString()
  };
  assert.equal(createIssueSchema.safeParse(input).success, false);
  assert.equal(createIssueSchema.safeParse({
    ...input,
    commentPublishAt: new Date(deadline + 60_000).toISOString()
  }).success, true);
});

test('new issue times cannot be earlier than the current time', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 10 * 60_000).toISOString();
  const base = { title: '时间不能早于当前时间', bodyMd: '测试正文', votingEnabled: false };
  assert.equal(createIssueSchema.safeParse({ ...base, commentEndsAt: past }).success, false);
  assert.equal(createIssueSchema.safeParse({ ...base, commentEndsAt: future }).success, true);
});

test('submitting the same vote is idempotent and does not consume a change', async () => {
  let transactionCount = 0;
  let writeCount = 0;
  const transaction = {
    first: async (sql: string) => sql.includes('FROM issues')
      ? { status: 'voting' }
      : { choice: 'agree', change_count: 0 },
    exec: async () => {
      writeCount += 1;
      return { affectedRows: 1 };
    },
    rows: async () => []
  };
  const database = {
    transaction: async (work: (executor: typeof transaction) => Promise<unknown>) => {
      transactionCount += 1;
      return work(transaction);
    }
  };
  const service = new IssuesService(database as never, {} as never);
  const detail = {
    issue: { id: '12', allowVoteChange: true, maxVoteChanges: 1 },
    viewer: { canVote: true }
  };
  (service as unknown as { getByNumber: () => Promise<typeof detail> }).getByNumber = async () => detail;
  await service.vote('12', 'agree', undefined, activeViewer);
  assert.equal(transactionCount, 1);
  assert.equal(writeCount, 0);
});

test('a changed vote, its event, and audit record use one transaction', async () => {
  const writes: string[] = [];
  const transaction = {
    first: async (sql: string) => sql.includes('FROM issues')
      ? { status: 'voting' }
      : { choice: 'disagree', change_count: 0 },
    exec: async (sql: string) => {
      writes.push(sql);
      return { affectedRows: 1 };
    },
    rows: async () => []
  };
  const database = {
    transaction: async (work: (executor: typeof transaction) => Promise<unknown>) => work(transaction)
  };
  const service = new IssuesService(database as never, {} as never);
  const detail = {
    issue: { id: '12', allowVoteChange: true, maxVoteChanges: 1 },
    viewer: { canVote: true }
  };
  (service as unknown as { getByNumber: () => Promise<typeof detail> }).getByNumber = async () => detail;
  await service.vote('12', 'agree', '修正选择', activeViewer);
  assert.equal(writes.length, 3);
  assert.match(writes[0], /UPDATE issue_votes/);
  assert.match(writes[1], /INSERT INTO issue_vote_events/);
  assert.match(writes[2], /INSERT INTO audit_logs/);
});

test('an administrator can delete another user anonymous reply', async () => {
  const writes: string[] = [];
  const database = {
    exec: async (sql: string) => {
      writes.push(sql);
      return { affectedRows: 1 };
    }
  };
  const service = new IssuesService(database as never, {} as never);
  const detail = {
    issue: { id: '12', status: 'open', commentAnonymous: true }
  };
  (service as unknown as { getByNumber: () => Promise<typeof detail> }).getByNumber = async () => detail;
  (service as unknown as { replyForComment: () => Promise<{ id: string; author_id: string }> }).replyForComment = async () => ({
    id: '34',
    author_id: '8'
  });
  const administrator: Viewer = { ...activeViewer, id: '1', groups: ['admin'] };

  assert.deepEqual(await service.deleteCommentReply('12', '23', '34', administrator), { ok: true });
  assert.equal(writes.length, 2);
  assert.match(writes[0], /UPDATE issue_comment_replies SET deleted_at/);
  assert.match(writes[1], /INSERT INTO audit_logs/);
});

test('a user cannot delete another user anonymous reply', async () => {
  let writeCount = 0;
  const database = {
    exec: async () => {
      writeCount += 1;
      return { affectedRows: 1 };
    }
  };
  const service = new IssuesService(database as never, {} as never);
  const detail = {
    issue: { id: '12', status: 'open', commentAnonymous: true }
  };
  (service as unknown as { getByNumber: () => Promise<typeof detail> }).getByNumber = async () => detail;
  (service as unknown as { replyForComment: () => Promise<{ id: string; author_id: string }> }).replyForComment = async () => ({
    id: '34',
    author_id: '8'
  });

  await assert.rejects(
    () => service.deleteCommentReply('12', '23', '34', activeViewer),
    ForbiddenException
  );
  assert.equal(writeCount, 0);
});

test('an administrator can delete another user anonymous comment', async () => {
  const writes: string[] = [];
  const database = {
    first: async () => ({ id: '23', author_id: '8' }),
    exec: async (sql: string) => {
      writes.push(sql);
      return { affectedRows: 1 };
    }
  };
  const service = new IssuesService(database as never, {} as never);
  const detail = {
    issue: { id: '12', status: 'open', commentAnonymous: true }
  };
  (service as unknown as { getByNumber: () => Promise<typeof detail> }).getByNumber = async () => detail;
  const administrator: Viewer = { ...activeViewer, id: '1', groups: ['admin'] };

  assert.deepEqual(await service.deleteComment('12', '23', administrator), { ok: true });
  assert.equal(writes.length, 2);
  assert.match(writes[0], /UPDATE issue_comments SET deleted_at/);
  assert.match(writes[1], /INSERT INTO audit_logs/);
});

test('an author can delete their own anonymous comment', async () => {
  let writeCount = 0;
  const database = {
    first: async () => ({ id: '23', author_id: activeViewer.id }),
    exec: async () => {
      writeCount += 1;
      return { affectedRows: 1 };
    }
  };
  const service = new IssuesService(database as never, {} as never);
  const detail = {
    issue: { id: '12', status: 'open', commentAnonymous: true }
  };
  (service as unknown as { getByNumber: () => Promise<typeof detail> }).getByNumber = async () => detail;

  assert.deepEqual(await service.deleteComment('12', '23', activeViewer), { ok: true });
  assert.equal(writeCount, 2);
});

test('a user cannot delete another user anonymous comment', async () => {
  let writeCount = 0;
  const database = {
    first: async () => ({ id: '23', author_id: '8' }),
    exec: async () => {
      writeCount += 1;
      return { affectedRows: 1 };
    }
  };
  const service = new IssuesService(database as never, {} as never);
  const detail = {
    issue: { id: '12', status: 'open', commentAnonymous: true }
  };
  (service as unknown as { getByNumber: () => Promise<typeof detail> }).getByNumber = async () => detail;

  await assert.rejects(
    () => service.deleteComment('12', '23', activeViewer),
    ForbiddenException
  );
  assert.equal(writeCount, 0);
});
