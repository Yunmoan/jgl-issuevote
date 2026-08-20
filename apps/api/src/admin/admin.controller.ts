import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';

@Controller('admin')
export class AdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(UsersService) private readonly users: UsersService
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
