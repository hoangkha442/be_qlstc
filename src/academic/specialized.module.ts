import {
  Body,
  Controller,
  Get,
  Headers,
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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { LecturerGuard } from '../auth/auth.module.js';
import type { LecturerRequest } from '../auth/auth.module.js';
import { StudentGuard } from '../learning/student-auth.js';
import type { StudentRequest } from '../learning/student-auth.js';
import { LearningModule } from '../learning/learning.module.js';
import { ObjectIdPipe } from '../common/http.js';
import { AcademicModule } from './academic.module.js';
import { AcademicService } from './academic.service.js';
import {
  ArchiveDto,
  ListQuery,
  SpecializedAssignmentDto,
  SpecializedAssignmentContentDto,
  UpdateSpecializedAssignmentDto,
} from './academic.dto.js';
import { SubmissionsModule } from '../submissions/submissions.module.js';
import { SubmissionsService } from '../submissions/submissions.service.js';
import { DownloadFileQuery } from '../submissions/submission.dto.js';
import { SYSTEM_MAX_FILE_BYTES } from '../config.js';

class SourceSubmissionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(2000)
  note?: string;
}
@ApiTags('Bài tập Chuyên ngành - giảng viên')
@ApiBearerAuth()
@UseGuards(LecturerGuard)
@Controller('lecturer')
class SpecializedLecturerController {
  constructor(
    private readonly academic: AcademicService,
    private readonly submissions: SubmissionsService,
  ) {}
  @Get('specialized/assignments') list(
    @Req() r: LecturerRequest,
    @Query() q: ListQuery,
  ) {
    return this.academic.listAssignments(r.lecturer.id, q, 'specialized');
  }
  @Post('learning-paths/:id/assignments') create(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: SpecializedAssignmentDto,
  ) {
    return this.academic.createSpecializedAssignment(r.lecturer.id, id, dto);
  }
  @Patch('specialized/assignments/:id') update(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateSpecializedAssignmentDto,
  ) {
    return this.academic.updateSpecializedAssignment(r.lecturer.id, id, dto);
  }
  @Post('learning-modules/:id/assignments') createModuleAssignment(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: SpecializedAssignmentContentDto,
  ) {
    return this.academic.createModuleAssignment(r.lecturer.id, id, dto);
  }
  @Post('lessons/:id/assignments') createLessonAssignment(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: SpecializedAssignmentContentDto,
  ) {
    return this.academic.createLessonAssignment(r.lecturer.id, id, dto);
  }
  @Patch('specialized/assignments/:id/archive') async archive(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: ArchiveDto,
  ) {
    await this.academic.ownedAssignment(id, r.lecturer.id, 'specialized');
    return this.academic.archive(
      'assignments',
      r.lecturer.id,
      id,
      dto.archived,
    );
  }
  @Get('specialized/submissions') submissionsList(
    @Req() r: LecturerRequest,
    @Query() q: ListQuery,
  ) {
    return this.submissions.list(r.lecturer.id, q, 'specialized');
  }
}
@ApiTags('Bài tập Chuyên ngành - sinh viên')
@ApiBearerAuth()
@UseGuards(StudentGuard)
@Controller('student')
class SpecializedStudentController {
  constructor(
    private readonly academic: AcademicService,
    private readonly submissions: SubmissionsService,
  ) {}
  @Get('learning-paths/:id/assignments') list(
    @Req() r: StudentRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Query() q: ListQuery,
  ) {
    return this.academic.studentAssignments(id, r.student, q);
  }
  @Get('assignments/:id') assignment(
    @Req() r: StudentRequest,
    @Param('id', ObjectIdPipe) id: string,
  ) {
    return this.academic.studentAssignment(id, r.student);
  }
  @Get('assignments/:id/submission') async submission(
    @Req() r: StudentRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Res() res: Response,
  ) {
    return res.json(await this.submissions.studentSubmission(id, r.student));
  }
  @Post('assignments/:id/submissions')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        note: { type: 'string' },
        files: {
          type: 'array',
          maxItems: 1,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 1, {
      storage: memoryStorage(),
      limits: {
        fileSize: SYSTEM_MAX_FILE_BYTES,
        files: 1,
        fields: 1,
        parts: 2,
        fieldSize: 8192,
      },
    }),
  )
  submit(
    @Req() r: StudentRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: SourceSubmissionDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Headers('idempotency-key') key: string,
  ) {
    return this.submissions.submit(
      id,
      {
        studentCode: r.student.studentCode,
        fullName: r.student.fullName,
        email: r.student.email,
        note: dto.note,
      },
      files,
      key,
      r.student,
    );
  }
  @Get('submissions/:id/file')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  file(
    @Req() r: StudentRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Query() q: DownloadFileQuery,
    @Res() res: Response,
  ) {
    return this.submissions.studentFile(
      id,
      r.student,
      q.version,
      q.fileIndex,
      res,
    );
  }
}
@Module({
  imports: [AcademicModule, SubmissionsModule, LearningModule],
  controllers: [SpecializedLecturerController, SpecializedStudentController],
})
export class SpecializedAssignmentsModule {}
