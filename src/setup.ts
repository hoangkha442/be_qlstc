import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ApiExceptionFilter } from './common/http.js';
import { SYSTEM_MAX_REQUEST_BYTES } from './config.js';
import { BRAND_NAME } from './brand.js';

export function setupApp(app: INestApplication, swagger = true) {
  const config = app.get(ConfigService);
  const express = app.getHttpAdapter().getInstance();
  if (config.get('TRUST_PROXY') === '1') express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.use(helmet());
  app.use(
    (
      req: import('express').Request,
      res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      res.setHeader('Cache-Control', 'no-store');
      if (
        Number(req.headers['content-length'] ?? 0) > SYSTEM_MAX_REQUEST_BYTES
      ) {
        res.status(413).json({
          statusCode: 413,
          message: 'Tổng dung lượng yêu cầu vượt giới hạn.',
        });
        return;
      }
      if (req.is('multipart/form-data')) {
        let received = 0;
        req.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > SYSTEM_MAX_REQUEST_BYTES && !res.headersSent) {
            req.unpipe();
            res.once('finish', () => req.destroy());
            res.status(413).json({
              statusCode: 413,
              message: 'Tổng dung lượng yêu cầu vượt giới hạn.',
            });
          }
        });
        // Multer resumes the stream after asynchronous guards have finished.
        req.pause();
      }
      next();
    },
  );
  app.enableCors({
    origin: config.getOrThrow<string>('FRONTEND_URL').split(','),
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: ['Content-Disposition', 'Retry-After'],
    maxAge: 600,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  if (swagger) {
    const spec = new DocumentBuilder()
      .setTitle(`${BRAND_NAME} API`)
      .setDescription(
        'Đại cương: nộp bài kèm email và biên nhận. Chuyên ngành: tài khoản sinh viên do giảng viên cấp, lộ trình và ghi danh. Thời gian trả về UTC.',
      )
      .setVersion('2.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, spec),
      { swaggerOptions: { persistAuthorization: false } },
    );
  }
}
