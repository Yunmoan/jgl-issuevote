import { Controller, Get, Inject } from '@nestjs/common';
import { UsersService } from '../users/users.service';

@Controller('site-config')
export class SiteController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  async config() {
    return { data: await this.users.publicSiteConfig() };
  }
}
