import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ClientSession } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Database } from '../database/database.module.js';
import { CloudinaryService } from '../storage/cloudinary.service.js';
import { validateSubmissionFiles } from '../storage/submission-validator.js';
import {
  IMAGE_EXTENSIONS,
  OFFICE_EXTENSIONS,
  SYSTEM_MAX_FILES,
  SYSTEM_MAX_FILE_BYTES,
  UPLOAD_LEASE_MS,
} from '../config.js';
import type { Lesson, LessonFile } from './learning.schemas.js';

export const LESSON_FILE_EXTENSIONS = [
  ...OFFICE_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  'pdf',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'tar.gz',
  'txt',
  'csv',
  'md',
  'json',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'php',
  'py',
  'java',
  'cs',
  'go',
  'rs',
  'sql',
  'c',
  'cpp',
  'h',
  'hpp',
  'rb',
  'kt',
  'swift',
  'dart',
  'yaml',
  'yml',
  'ipynb',
];

export const lessonFileView = (file: LessonFile) => ({
  id: file.id,
  originalName: file.originalName,
  bytes: file.bytes,
  format: file.format,
  uploadedAt: file.uploadedAt,
});
export const lessonView = <T extends Lesson>(lesson: T) => ({
  ...lesson,
  files: (lesson.files ?? []).map(lessonFileView),
});

// Parse the JSON part before Nest's global DTO validation. Existing JSON clients still work.
@Injectable()
export class LessonBodyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.is('multipart/form-data')) {
      const body = request.body as Record<string, unknown>;
      try {
        if (Object.keys(body).length !== 1 || typeof body.data !== 'string')
          throw new Error();
        const parsed: unknown = JSON.parse(body.data);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error();
        request.body = parsed;
      } catch {
        throw new BadRequestException(
          'Thông tin bài học không hợp lệ. Gửi trường data chứa JSON và các trường files.',
        );
      }
    }
    return next.handle();
  }
}

@Injectable()
export class LessonFilesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LessonFilesService.name);
  private timer?: NodeJS.Timeout;
  private cleaning = false;
  constructor(
    private readonly db: Database,
    private readonly storage: CloudinaryService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.cleanup();
    }, 60000);
    this.timer.unref();
    void this.cleanup();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  select(
    existing: LessonFile[],
    keepIds: string[] | undefined,
    incomingCount: number,
  ) {
    if (keepIds?.some((id) => !existing.some((file) => file.id === id)))
      throw new BadRequestException(
        'Danh sách file đã thay đổi hoặc không thuộc bài học này. Vui lòng tải lại bài học.',
      );
    const kept = keepIds
      ? existing.filter((file) => keepIds.includes(file.id))
      : existing;
    if (kept.length + incomingCount > SYSTEM_MAX_FILES)
      throw new BadRequestException(
        `Mỗi bài học có tối đa ${SYSTEM_MAX_FILES} file đính kèm.`,
      );
    return kept;
  }
  async upload(lecturerId: string, files: Express.Multer.File[] = []) {
    if (!files.length) return [];
    const validated = await validateSubmissionFiles(files, {
      allowedExtensions: LESSON_FILE_EXTENSIONS,
      maxFiles: SYSTEM_MAX_FILES,
      maxFileBytes: SYSTEM_MAX_FILE_BYTES,
    });
    const stored: LessonFile[] = [];
    for (const file of validated) {
      const id = randomUUID();
      const publicId = `lesson-materials/${lecturerId}/${id}.${file.format}`;
      // Record intent before contacting storage, including uploads with an uncertain outcome.
      await this.db.lessonFileCleanup.create({
        publicId,
        fileId: id,
        retryAt: new Date(Date.now() + UPLOAD_LEASE_MS),
      });
      stored.push({ ...(await this.storage.upload(file, publicId)), id });
    }
    return stored;
  }
  async queueRemoved(files: LessonFile[], session: ClientSession) {
    for (const file of files)
      await this.db.lessonFileCleanup.updateOne(
        { publicId: file.publicId },
        {
          $set: {
            fileId: file.id,
            retryAt: new Date(Date.now() + UPLOAD_LEASE_MS),
          },
        },
        { upsert: true, session },
      );
  }
  private async cleanup() {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      const jobs = await this.db.lessonFileCleanup
        .find({ retryAt: { $lte: new Date() } })
        .sort({ retryAt: 1 })
        .limit(20)
        .lean();
      for (const job of jobs) {
        try {
          // A committed lesson owns the file. Never remove it after an ambiguous commit response.
          if (!(await this.db.lessons.exists({ 'files.id': job.fileId })))
            await this.storage.destroy(job.publicId);
          await this.db.lessonFileCleanup.deleteOne({
            _id: job._id,
            retryAt: job.retryAt,
          });
        } catch {
          await this.db.lessonFileCleanup.updateOne(
            { _id: job._id, retryAt: job.retryAt },
            { $set: { retryAt: new Date(Date.now() + UPLOAD_LEASE_MS) } },
          );
          this.logger.warn(
            'Chưa dọn được file tài liệu bài học. Sẽ tự thử lại.',
          );
        }
      }
    } catch {
      this.logger.warn(
        'Chưa kiểm tra được file tài liệu cần dọn. Sẽ tự thử lại.',
      );
    } finally {
      this.cleaning = false;
    }
  }
}
