import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './env';

loadEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.APP_URL || 'http://localhost:5173',
    credentials: true
  });
  app.use(cookieParser());
  await app.listen(Number(process.env.PORT || 3000));
}

bootstrap();
