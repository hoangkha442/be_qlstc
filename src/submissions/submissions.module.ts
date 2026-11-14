import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AcademicModule } from '../academic/academic.module.js';
import { LecturerGuard } from '../auth/auth.module.js';
import type { LecturerRequest } from '../auth/auth.module.js';
import { ObjectIdPipe } from '../common/http.js';
import { SYSTEM_MAX_FILE_BYTES, SYSTEM_MAX_FILES } from '../config.js';
import { CloudinaryService } from '../storage/cloudinary.service.js';
import { ListQuery } from '../academic/academic.dto.js';
import { MailModule } from '../mail/mail.module.js';
import {
  DownloadFileQuery,
  LookupReceiptDto,
  SubmitDto,
  ReceiptFileDto,
  GradeSubmissionDto,
} from './submission.dto.js';
import { SubmissionsService } from './submissions.service.js';

@ApiTags('Nộp bài và biên nhận')
@Controller('public')
export class PublicSubmissionController {
  constructor(private readonly service: SubmissionsService) {}
  @Post('assignments/:id/submissions')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'crypto.randomUUID(); giữ nguyên khi thử lại cùng yêu cầu',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['studentCode', 'fullName', 'email', 'files'],
      properties: {
        studentCode: { type: 'string' },
        fullName: { type: 'string' },
        email: { type: 'string', format: 'email' },
        note: { type: 'string' },
        secret: { type: 'string' },
        files: {
          type: 'array',
          description:
            'File Office hoặc ảnh JPG/JPEG, PNG, WebP, GIF, AVIF, TIFF theo định dạng giảng viên cho phép.',
          maxItems: 5,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', SYSTEM_MAX_FILES, {
      storage: memoryStorage(),
      limits: {
        fileSize: SYSTEM_MAX_FILE_BYTES,
        files: SYSTEM_MAX_FILES,
        fields: 5,
        fieldSize: 8192,
        parts: SYSTEM_MAX_FILES + 5,
        headerPairs: 30,
      },
    }),
  )
  submit(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: SubmitDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.submit(id, dto, files, key);
  }
  @Post('receipts/lookup')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  lookup(@Body() dto: LookupReceiptDto) {
    return this.service.lookup(dto);
  }
  @Post('receipts/file')
  @HttpCode(200)
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  file(@Body() dto: ReceiptFileDto, @Res() res: Response) {
    return this.service.receiptFile(dto, res);
  }
}

@ApiTags('Quản lý bài nộp')
@ApiBearerAuth()
@UseGuards(LecturerGuard)
@Controller('lecturer')
export class LecturerSubmissionController {
  constructor(private readonly service: SubmissionsService) {}
  @Patch('submissions/:id/grade')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  grade(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: GradeSubmissionDto,
  ) {
    return this.service.grade(r.lecturer.id, id, dto);
  }
  @Get('submissions') list(@Req() r: LecturerRequest, @Query() q: ListQuery) {
    return this.service.list(r.lecturer.id, q);
  }
  @Get('submissions/:id') detail(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
  ) {
    return this.service.detail(r.lecturer.id, id);
  }
  @Get('submissions/:id/file')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  file(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Query() q: DownloadFileQuery,
    @Res() res: Response,
  ) {
    return this.service.file(r.lecturer.id, id, q.version, q.fileIndex, res);
  }
  @Get('assignments/:id/submissions.zip')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  zip(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Res() res: Response,
  ) {
    return this.service.zip(r.lecturer.id, id, res);
  }
  @Get('assignments/:id/submissions.xlsx')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  excel(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Res() res: Response,
  ) {
    return this.service.excel(r.lecturer.id, id, res);
  }
}

@Module({
  imports: [AcademicModule, MailModule],
  controllers: [PublicSubmissionController, LecturerSubmissionController],
  providers: [CloudinaryService, SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
