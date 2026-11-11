import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AcademicModule } from './academic/academic.module.js';
import { SubmissionsModule } from './submissions/submissions.module.js';
import { serverEnvPath, validateEnvironment } from './config.js';
import { AppController } from './app.controller.js';
import { LearningModule } from './learning/learning.module.js';
import { SpecializedAssignmentsModule } from './academic/specialized.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: serverEnvPath,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuthModule,
    AcademicModule,
    SubmissionsModule,
    LearningModule,
    SpecializedAssignmentsModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
