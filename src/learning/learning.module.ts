import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LecturerGuard } from '../auth/auth.module.js';
import type { LecturerRequest } from '../auth/auth.module.js';
import { ArchiveDto } from '../academic/academic.dto.js';
import { ObjectIdPipe } from '../common/http.js';
import { LearningService } from './learning.service.js';
import { MailModule } from '../mail/mail.module.js';
import { AcademicModule } from '../academic/academic.module.js';
import { StudentAuthController, StudentGuard } from './student-auth.js';
import type { StudentRequest } from './student-auth.js';
import {
  CreateStudentDto,
  EnrollmentDto,
  LearningModuleDto,
  LearningPathDto,
  LearningQuery,
  LessonDto,
  ProgressDto,
  UpdateLearningModuleDto,
  UpdateLearningPathDto,
  UpdateLessonDto,
  UpdateStudentDto,
} from './learning.dto.js';

@ApiTags('Danh mục đào tạo')
@Controller('public/categories')
export class CategoriesController {
  @Get() categories() {
    return [
      {
        code: 'general',
        name: 'Đại cương',
        description: 'Các học phần đại cương, tin học.',
        requiresLogin: false,
        contentPath: '/api/public/course-sections',
      },
      {
        code: 'specialized',
        name: 'Chuyên ngành',
        description: 'Các lộ trình công nghệ thông tin và lập trình web.',
        requiresLogin: true,
        contentPath: '/api/student/learning-paths',
      },
    ];
  }
}

@ApiTags('Quản lý chuyên ngành')
@ApiBearerAuth()
@UseGuards(LecturerGuard)
@Controller('lecturer')
export class LecturerLearningController {
  constructor(private readonly service: LearningService) {}
  @Get('students') students(
    @Req() r: LecturerRequest,
    @Query() q: LearningQuery,
  ) {
    return this.service.students(r.lecturer.id, q);
  }
  @Post('students')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  createStudent(@Req() r: LecturerRequest, @Body() dto: CreateStudentDto) {
    return this.service.createStudent(r.lecturer.id, dto);
  }
  @Patch('students/:id') updateStudent(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.service.updateStudent(r.lecturer.id, id, dto);
  }
  @Post('students/:id/reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  resetPassword(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
  ) {
    return this.service.resetPassword(r.lecturer.id, id);
  }
  @Get('learning-paths') paths(
    @Req() r: LecturerRequest,
    @Query() q: LearningQuery,
  ) {
    return this.service.paths(r.lecturer.id, q);
  }
  @Post('learning-paths') createPath(
    @Req() r: LecturerRequest,
    @Body() dto: LearningPathDto,
  ) {
    return this.service.createPath(r.lecturer.id, dto);
  }
  @Get('learning-paths/:id') path(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
  ) {
    return this.service.pathDetail(r.lecturer.id, id);
  }
  @Patch('learning-paths/:id') updatePath(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateLearningPathDto,
  ) {
    return this.service.updatePath(r.lecturer.id, id, dto);
  }
  @Patch('learning-paths/:id/archive') archivePath(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: ArchiveDto,
  ) {
    return this.service.updatePath(r.lecturer.id, id, dto);
  }
  @Post('learning-paths/:id/modules') createModule(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: LearningModuleDto,
  ) {
    return this.service.createModule(r.lecturer.id, id, dto);
  }
  @Patch('learning-modules/:id') updateModule(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateLearningModuleDto,
  ) {
    return this.service.updateModule(r.lecturer.id, id, dto);
  }
  @Patch('learning-modules/:id/archive') archiveModule(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: ArchiveDto,
  ) {
    return this.service.updateModule(r.lecturer.id, id, dto);
  }
  @Post('learning-modules/:id/lessons') createLesson(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: LessonDto,
  ) {
    return this.service.createLesson(r.lecturer.id, id, dto);
  }
  @Patch('lessons/:id') updateLesson(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateLessonDto,
  ) {
    return this.service.updateLesson(r.lecturer.id, id, dto);
  }
  @Patch('lessons/:id/archive') archiveLesson(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: ArchiveDto,
  ) {
    return this.service.updateLesson(r.lecturer.id, id, dto);
  }
  @Get('learning-paths/:id/enrollments') enrollments(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Query() q: LearningQuery,
  ) {
    return this.service.enrollments(r.lecturer.id, id, q);
  }
  @Post('learning-paths/:id/enrollments') @HttpCode(200) enroll(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: EnrollmentDto,
  ) {
    return this.service.enroll(r.lecturer.id, id, dto);
  }
}

@ApiTags('Học chuyên ngành')
@ApiBearerAuth()
@UseGuards(StudentGuard)
@Controller('student')
export class StudentLearningController {
  constructor(private readonly service: LearningService) {}
  @Get('learning-paths') paths(
    @Req() r: StudentRequest,
    @Query() q: LearningQuery,
  ) {
    return this.service.studentPaths(r.student.id, r.student.lecturerId, q);
  }
  @Get('learning-paths/:id') path(
    @Req() r: StudentRequest,
    @Param('id', ObjectIdPipe) id: string,
  ) {
    return this.service.studentPath(r.student.id, r.student.lecturerId, id);
  }
  @Get('lessons/:id') lesson(
    @Req() r: StudentRequest,
    @Param('id', ObjectIdPipe) id: string,
  ) {
    return this.service.studentLesson(r.student.id, r.student.lecturerId, id);
  }
  @Patch('lessons/:id/progress') progress(
    @Req() r: StudentRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: ProgressDto,
  ) {
    return this.service.progress(
      r.student.id,
      r.student.lecturerId,
      id,
      dto.completed,
    );
  }
}

@Module({
  imports: [MailModule, AcademicModule],
  controllers: [
    CategoriesController,
    LecturerLearningController,
    StudentAuthController,
    StudentLearningController,
  ],
  providers: [LearningService, StudentGuard],
  exports: [StudentGuard],
})
export class LearningModule {}
