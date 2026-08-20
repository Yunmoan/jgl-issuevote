import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { FeishuOrganizationService } from '../auth/feishu-organization.service';
import { AiReviewService } from '../issues/ai-review.service';
import { IssuesService } from '../issues/issues.service';
import { UsersService } from '../users/users.service';

@Controller('admin')
export class AdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(AiReviewService) private readonly aiReview: AiReviewService,
    @Inject(FeishuOrganizationService) private readonly feishuOrganization: FeishuOrganizationService
  ) {}

  @Get('users')
  async listUsers(@Query() query: Record<string, unknown>, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    this.users.requireAdmin(viewer);
    return { data: await this.users.users(query) };
  }

  @Patch('users/:id')
  async updateUser(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({ status: z.enum(['active', 'disabled', 'pending']) }).parse(body);
    return { data: await this.users.updateStatus(id, parsed.status, viewer) };
  }

  @Post('users/:id/groups')
  async addGroup(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({ groupKey: z.string().min(1) }).parse(body);
    return { data: await this.users.addGroup(id, parsed.groupKey, viewer) };
  }

  @Delete('users/:id/groups/:groupKey')
  async removeGroup(@Param('id') id: string, @Param('groupKey') groupKey: string, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.users.removeGroup(id, groupKey, viewer) };
  }

  @Get('groups')
  async groups(@Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    this.users.requireAdmin(viewer);
    return { data: await this.users.groups() };
  }

  @Post('feishu/departments/sync')
  async syncFeishuDepartments(@Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    this.users.requireAdmin(viewer);
    return { data: await this.feishuOrganization.syncAllDepartments(viewer) };
  }

  @Get('labels')
  async labels(@Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.issues.adminLabels(viewer) };
  }

  @Post('labels')
  async createLabel(@Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.issues.createLabel(labelSchema.parse(body), viewer) };
  }

  @Patch('labels/:id')
  async updateLabel(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.issues.updateLabel(labelIdSchema.parse(id), labelSchema.parse(body), viewer) };
  }

  @Delete('labels/:id')
  async deleteLabel(@Param('id') id: string, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.issues.deleteLabel(labelIdSchema.parse(id), viewer) };
  }

  @Post('groups')
  async createGroup(@Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = groupSchema.parse(body);
    return { data: await this.users.createGroup(parsed, viewer) };
  }

  @Patch('groups/:groupKey')
  async updateGroup(@Param('groupKey') groupKey: string, @Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = groupUpdateSchema.parse(body);
    return { data: await this.users.updateGroup(groupKey, parsed, viewer) };
  }

  @Delete('groups/:groupKey')
  async deleteGroup(@Param('groupKey') groupKey: string, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.users.deleteGroup(groupKey, viewer) };
  }

  @Get('settings')
  async settings(@Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    this.users.requireAdmin(viewer);
    return { data: await this.users.settings() };
  }

  @Patch('settings')
  async setSetting(@Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({ key: z.string().min(1), value: z.unknown() }).parse(body);
    return { data: await this.users.setSetting(parsed.key, parsed.value, viewer) };
  }

  @Get('ai-review-settings')
  async aiReviewSettings(@Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    this.users.requireAdmin(viewer);
    return { data: await this.aiReview.adminSettings() };
  }

  @Patch('ai-review-settings')
  async updateAiReviewSettings(@Body() body: unknown, @Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    this.users.requireAdmin(viewer);
    const parsed = aiReviewSettingsSchema.parse(body);
    return { data: await this.aiReview.updateSettings(parsed, viewer) };
  }

  @Post('ai-review-settings/test')
  async testAiReviewSettings(@Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    this.users.requireAdmin(viewer);
    return { data: await this.aiReview.testConnection() };
  }

  @Get('audit-logs')
  async auditLogs(@Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    this.users.requireAdmin(viewer);
    return { data: await this.users.auditLogs() };
  }
}

const groupSchema = z.object({
  groupKey: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/),
  name: z.string().min(1).max(80),
  description: z.string().max(300).nullable().optional(),
  isAssignable: z.boolean().default(true)
});
const groupUpdateSchema = groupSchema.omit({ groupKey: true });
const labelIdSchema = z.coerce.number().int().positive();
const labelSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().max(200).nullable().optional()
});
const aiReviewSettingsSchema = z.object({
  mode: z.enum(['disabled', 'manual', 'ai']),
  endpoint: z.string().trim().max(500).default(''),
  model: z.string().trim().max(160).default('Qwen3-8B'),
  apiKey: z.string().max(2000).optional(),
  clearApiKey: z.boolean().optional(),
  policyPrompt: z.string().trim().max(6000).default('')
});
