import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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

  @Get('auth/natayarkid/start')
  async startNyk(@Res() res: Response) {
    const url = await this.auth.startNatayarkId(res);
    res.redirect(url);
  }

  @Get('auth/natayarkid/callback')
  async callbackNyk(@Req() req: Request, @Res() res: Response, @Query('redirect') redirect?: string) {
    await this.auth.handleNatayarkIdCallback(req, res);
    res.redirect(redirect || process.env.APP_URL || 'http://localhost:5173');
  }

  @Post('auth/logout')
  logout(@Res({ passthrough: true }) res: Response) {
    return { data: this.auth.logout(res) };
  }
}
