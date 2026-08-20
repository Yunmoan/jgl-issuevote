import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import type { VoteChoice } from '../types';
import { createIssueSchema, IssuesService } from './issues.service';
import { UsersService } from '../users/users.service';

@Controller()
export class IssuesController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(UsersService) private readonly users: UsersService
  ) {}

  @Get('health')
  health() {
    return { data: { ok: true, service: 'jgl-issuevote-api' } };
  }

  @Get('labels')
  async labels() {
    return { data: await this.issues.labels() };
  }

  @Get('permission-groups')
  async permissionGroups(@Req() req: Request) {
    await this.auth.requireViewer(req);
    return { data: await this.users.groups() };
  }

  @Get('issues')
  async list(@Query() query: Record<string, unknown>, @Req() req: Request) {
    const viewer = await this.auth.viewerFromRequest(req);
    return { data: await this.issues.list(query, viewer) };
  }

  @Post('issues')
  async create(@Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const input = createIssueSchema.parse(body);
    return { data: await this.issues.create(input, viewer) };
  }

  @Get('issues/:number')
  async detail(@Param('number') number: string, @Req() req: Request) {
    const viewer = await this.auth.viewerFromRequest(req);
    return { data: await this.issues.getByNumber(number, viewer) };
  }

  @Post('issues/:number/close')
  async close(@Param('number') number: string, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.issues.close(number, viewer) };
  }

  @Post('issues/:number/reopen')
  async reopen(@Param('number') number: string, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.issues.reopen(number, viewer) };
  }

  @Get('issues/:number/comments')
  async comments(@Param('number') number: string, @Req() req: Request) {
    const viewer = await this.auth.viewerFromRequest(req);
    return { data: await this.issues.comments(number, viewer) };
  }

  @Post('issues/:number/comments')
  async createComment(@Param('number') number: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({ bodyMd: z.string().min(1) }).parse(body);
    return { data: await this.issues.createComment(number, parsed.bodyMd, viewer) };
  }

  @Post('issues/:number/vote')
  async voteByPost(@Param('number') number: string, @Body() body: unknown, @Req() req: Request) {
    return this.castVote(number, body, req);
  }

  @Put('issues/:number/vote')
  async voteByPut(@Param('number') number: string, @Body() body: unknown, @Req() req: Request) {
    return this.castVote(number, body, req);
  }

  private async castVote(number: string, body: unknown, req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({
      choice: z.enum(['agree', 'disagree', 'abstain']),
      reason: z.string().max(300).optional()
    }).parse(body);
    return { data: await this.issues.vote(number, parsed.choice as VoteChoice, parsed.reason, viewer) };
  }
}
