import { Module } from '@nestjs/common';
import { AdminController } from './admin/admin.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { DatabaseService } from './db/database.service';
import { IssuesController } from './issues/issues.controller';
import { IssuesService } from './issues/issues.service';
import { UsersService } from './users/users.service';

@Module({
  controllers: [AdminController, AuthController, IssuesController],
  providers: [AuthService, DatabaseService, IssuesService, UsersService]
})
export class AppModule {}

