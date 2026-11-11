import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LecturerGuard } from '../auth/auth.module.js';
import type { LecturerRequest } from '../auth/auth.module.js';
import { ObjectIdPipe } from '../common/http.js';
import { AcademicService } from './academic.service.js';
import {
  ArchiveDto,
  AssignmentDto,
  CatalogDto,
  ListQuery,
  SectionDto,
  SemesterDto,
  UpdateAssignmentDto,
  UpdateCatalogDto,
  UpdateSectionDto,
  UpdateSemesterDto,
} from './academic.dto.js';

@ApiTags('Quản lý học tập')
@ApiBearerAuth()
@UseGuards(LecturerGuard)
@Controller('lecturer')
export class AcademicController {
  constructor(private readonly service: AcademicService) {}
  @Get('dashboard') dashboard(@Req() r: LecturerRequest) {
    return this.service.dashboard(r.lecturer.id);
  }
  @Get('semesters') semesters(
    @Req() r: LecturerRequest,
    @Query() q: ListQuery,
  ) {
    return this.service.listCatalog('semesters', r.lecturer.id, q);
  }
  @Post('semesters') createSemester(
    @Req() r: LecturerRequest,
    @Body() dto: SemesterDto,
  ) {
    return this.service.createCatalog('semesters', r.lecturer.id, dto);
  }
  @Patch('semesters/:id') updateSemester(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateSemesterDto,
  ) {
    return this.service.updateCatalog('semesters', r.lecturer.id, id, dto);
  }
  @Patch('semesters/:id/archive') archiveSemester(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: ArchiveDto,
  ) {
    return this.service.archive('semesters', r.lecturer.id, id, dto.archived);
  }
  @Get('subjects') subjects(@Req() r: LecturerRequest, @Query() q: ListQuery) {
    return this.service.listCatalog('subjects', r.lecturer.id, q);
  }
  @Post('subjects') createSubject(
    @Req() r: LecturerRequest,
    @Body() dto: CatalogDto,
  ) {
    return this.service.createCatalog('subjects', r.lecturer.id, dto);
  }
  @Patch('subjects/:id') updateSubject(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateCatalogDto,
  ) {
    return this.service.updateCatalog('subjects', r.lecturer.id, id, dto);
  }
  @Patch('subjects/:id/archive') archiveSubject(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: ArchiveDto,
  ) {
    return this.service.archive('subjects', r.lecturer.id, id, dto.archived);
  }
  @Get('classes') classes(@Req() r: LecturerRequest, @Query() q: ListQuery) {
    return this.service.listCatalog('classes', r.lecturer.id, q);
  }
  @Post('classes') createClass(
    @Req() r: LecturerRequest,
    @Body() dto: CatalogDto,
  ) {
    return this.service.createCatalog('classes', r.lecturer.id, dto);
  }
  @Patch('classes/:id') updateClass(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateCatalogDto,
  ) {
    return this.service.updateCatalog('classes', r.lecturer.id, id, dto);
  }
  @Patch('classes/:id/archive') archiveClass(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: ArchiveDto,
  ) {
    return this.service.archive('classes', r.lecturer.id, id, dto.archived);
  }
  @Get('course-sections') sections(
    @Req() r: LecturerRequest,
    @Query() q: ListQuery,
  ) {
    return this.service.listSections(r.lecturer.id, q);
  }
  @Post('course-sections') createSection(
    @Req() r: LecturerRequest,
    @Body() dto: SectionDto,
  ) {
    return this.service.createSection(r.lecturer.id, dto);
  }
  @Patch('course-sections/:id') updateSection(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateSectionDto,
  ) {
    return this.service.updateSection(r.lecturer.id, id, dto);
  }
  @Patch('course-sections/:id/archive') archiveSection(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: ArchiveDto,
  ) {
    return this.service.archive(
      'courseSections',
      r.lecturer.id,
      id,
      dto.archived,
    );
  }
  @Get('assignments') assignments(
    @Req() r: LecturerRequest,
    @Query() q: ListQuery,
  ) {
    return this.service.listAssignments(r.lecturer.id, q);
  }
  @Post('assignments') createAssignment(
    @Req() r: LecturerRequest,
    @Body() dto: AssignmentDto,
  ) {
    return this.service.createAssignment(r.lecturer.id, dto);
  }
  @Get('assignments/:id') assignment(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
  ) {
    return this.service.ownedAssignment(id, r.lecturer.id);
  }
  @Patch('assignments/:id') updateAssignment(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.service.updateAssignment(r.lecturer.id, id, dto);
  }
  @Patch('assignments/:id/archive') archiveAssignment(
    @Req() r: LecturerRequest,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: ArchiveDto,
  ) {
    return this.service.archive('assignments', r.lecturer.id, id, dto.archived);
  }
}

@ApiTags('Danh mục công khai')
@Controller('public')
export class PublicAcademicController {
  constructor(private readonly service: AcademicService) {}
  @Get('semesters') semesters() {
    return this.service.publicSemesters();
  }
  @Get('classes') classes(@Query() q: ListQuery) {
    return this.service.publicClasses(q);
  }
  @Get('course-sections') sections(@Query() q: ListQuery) {
    return this.service.publicSections(q);
  }
  @Get('assignments') assignments(@Query() q: ListQuery) {
    return this.service.publicAssignments(q);
  }
  @Get('assignments/:id') assignment(@Param('id', ObjectIdPipe) id: string) {
    return this.service.publicAssignment(id);
  }
}

@Module({
  controllers: [AcademicController, PublicAcademicController],
  providers: [AcademicService],
  exports: [AcademicService],
})
export class AcademicModule {}
