import { Body, Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('auth/providers')
  providers() {
    return { data: this.auth.providers() };
  }

  @Get('me')
  async me(@Req() req: Request) {
    return { data: await this.auth.viewerFromRequest(req) };
  }

  @Post('auth/dev-login')
  async devLogin(@Res({ passthrough: true }) res: Response) {
    return { data: await this.auth.devLogin(res) };
  }

  @Post('auth/feishu/code')
  async feishuCode(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = z.object({ code: z.string().min(1) }).parse(body);
    return { data: await this.auth.loginWithFeishuCode(parsed.code, res) };
  }

  @Post('auth/feishu/bind-code')
  async bindFeishuCode(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const viewer = await this.auth.requireViewer(req);
    const parsed = z.object({ code: z.string().min(1) }).parse(body);
    return { data: await this.auth.bindFeishuCode(parsed.code, viewer.id, res) };
  }

  @Post('auth/feishu/departments/sync')
  async refreshFeishuDepartments(@Req() req: Request) {
    const viewer = await this.auth.requireViewer(req);
    return { data: await this.auth.refreshFeishuDepartments(viewer.id) };
  }

  @Get('auth/natayarkid/start')
  async startNyk(@Res() res: Response) {
    const url = await this.auth.startNatayarkId(res);
    res.redirect(url);
  }

  @Get('auth/natayarkid/link/start')
  async startNykLink(@Req() req: Request, @Res() res: Response) {
    const viewer = await this.auth.requireViewer(req);
    const url = await this.auth.startNatayarkId(res, viewer.id);
    res.redirect(url);
  }

  @Get('auth/natayarkid/callback')
  async callbackNyk(@Req() req: Request, @Res() res: Response, @Query('redirect') redirect?: string) {
    await this.auth.handleNatayarkIdCallback(req, res);
    res.redirect(safeAppRedirect(redirect));
  }

  @Post('auth/logout')
  logout(@Res({ passthrough: true }) res: Response) {
    return { data: this.auth.logout(res) };
  }
}

function safeAppRedirect(redirect?: string) {
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  if (!redirect) return appUrl;
  try {
    const base = new URL(appUrl);
    const target = new URL(redirect, base);
    return target.origin === base.origin ? target.toString() : appUrl;
  } catch {
    return appUrl;
  }
}
