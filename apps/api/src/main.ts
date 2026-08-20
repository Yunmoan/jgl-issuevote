import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { static as serveStatic } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './env';
import { uploadDirectory } from './uploads';

loadEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.APP_URL || 'http://localhost:5173',
    credentials: true
  });
  app.use(cookieParser());
  app.use('/uploads', serveStatic(uploadDirectory()));
  await app.listen(Number(process.env.PORT || 3000));
}

bootstrap();
