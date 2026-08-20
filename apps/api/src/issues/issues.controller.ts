import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import type { VoteChoice } from '../types';
import { createIssueSchema, IssuesService, updateIssueSchema } from './issues.service';
import { UsersService } from '../users/users.service';
import { uploadDirectory } from '../uploads';

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

  @Post('uploads/images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadImage(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    await this.auth.requireViewer(req);
    if (!file || !isValidImage(file)) throw new BadRequestException('仅支持 5MB 以内的 JPEG、PNG、GIF 或 WebP 图片');
    const extension = imageExtensions[file.mimetype];
    const directory = join(uploadDirectory(), 'images');
    const filename = `${randomUUID()}${extension}`;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename), file.buffer);
    return { data: { path: `/uploads/images/${filename}` } };
  }

  @Get('issues')
  async list(@Query() query: Record<string, unknown>, @Req() req: Request) {
    const viewer = await this.auth.viewerFromRequest(req);
    return { data: await this.issues.list(query, viewer) };
  }

  @Post('issues')
  async create(@Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const input = parseIssueInput(createIssueSchema, body);
    return { data: await this.issues.create(input, viewer) };
  }

  @Get('issues/reviews')
  async reviewQueue(@Query() query: Record<string, unknown>, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.issues.reviewQueue(query, viewer) };
  }

  @Post('issues/:number/review')
  async review(@Param('number') number: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({
      decision: z.enum(['approve', 'reject']),
      note: z.string().trim().max(1000).optional()
    }).superRefine((value, context) => {
      if (value.decision === 'reject' && !value.note) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: '驳回时请说明原因' });
      }
    }).parse(body);
    return { data: await this.issues.review(number, parsed.decision, parsed.note || null, viewer) };
  }

  @Get('issues/:number')
  async detail(@Param('number') number: string, @Req() req: Request) {
    const viewer = await this.auth.viewerFromRequest(req);
    return { data: await this.issues.getByNumber(number, viewer) };
  }

  @Put('issues/:number')
  async update(@Param('number') number: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.issues.update(number, parseIssueInput(updateIssueSchema, body), viewer) };
  }

  @Post('issues/:number/close')
  async close(@Param('number') number: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({ visibility: z.enum(['retain', 'public']).default('retain') }).parse(body);
    return { data: await this.issues.close(number, parsed.visibility, viewer) };
  }

  @Post('issues/:number/start-voting')
  async startVoting(@Param('number') number: string, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.issues.startVoting(number, viewer) };
  }

  @Post('issues/:number/outcome')
  async confirmOutcome(@Param('number') number: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({ outcome: z.enum(['passed', 'rejected']) }).parse(body);
    return { data: await this.issues.confirmOutcome(number, parsed.outcome, viewer) };
  }

  @Post('issues/:number/reopen')
  async reopen(@Param('number') number: string, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.issues.reopen(number, viewer) };
  }

  @Post('issues/:number/archive')
  async archive(@Param('number') number: string, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.issues.archive(number, viewer) };
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

  @Put('issues/:number/comments/:commentId')
  async updateComment(@Param('number') number: string, @Param('commentId') commentId: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({ bodyMd: z.string().min(1) }).parse(body);
    return { data: await this.issues.updateComment(number, commentId, parsed.bodyMd, viewer) };
  }

  @Post('issues/:number/comments/:commentId/reactions')
  async toggleCommentReaction(@Param('number') number: string, @Param('commentId') commentId: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({ reaction: z.enum(['like', 'yes', 'no']) }).parse(body);
    return { data: await this.issues.toggleCommentReaction(number, commentId, parsed.reaction, viewer) };
  }

  @Post('issues/:number/comments/:commentId/replies')
  async createCommentReply(@Param('number') number: string, @Param('commentId') commentId: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({ bodyMd: z.string().min(1) }).parse(body);
    return { data: await this.issues.createCommentReply(number, commentId, parsed.bodyMd, viewer) };
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

const imageExtensions: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp'
};

function isValidImage(file: Express.Multer.File) {
  if (!imageExtensions[file.mimetype] || file.size > 5 * 1024 * 1024) return false;
  const buffer = file.buffer;
  if (file.mimetype === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (file.mimetype === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (file.mimetype === 'image/gif') return buffer.length >= 6 && (buffer.subarray(0, 6).toString() === 'GIF87a' || buffer.subarray(0, 6).toString() === 'GIF89a');
  return buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
}

function parseIssueInput(schema: z.ZodTypeAny, body: unknown) {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const message = result.error.issues
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '请求'}：${issue.message}`)
    .join('；');
  throw new BadRequestException(`议题内容不符合要求：${message}`);
}
