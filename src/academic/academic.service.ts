import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientSession } from 'mongoose';
import { Database } from '../database/database.module.js';
import type { Assignment } from '../database/schemas.js';
import { assignmentStatus } from './assignment-policy.js';
import {
  AssignmentDto,
  CatalogDto,
  ListQuery,
  SectionDto,
  SemesterDto,
  UpdateAssignmentDto,
  UpdateSectionDto,
  SpecializedAssignmentDto,
  UpdateSpecializedAssignmentDto,
} from './academic.dto.js';
import type {
  AssignmentPlacement,
  SpecializedAssignmentContentDto,
} from './academic.dto.js';
import type { StudentRequest } from '../learning/student-auth.js';

export type CatalogKind = 'semesters' | 'subjects' | 'classes';
export const escapeRegex = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class AcademicService {
  constructor(
    private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  async listCatalog(kind: CatalogKind, lecturerId: string, q: ListQuery) {
    const filter = {
      lecturerId,
      ...(q.archived === 'all' ? {} : { archived: q.archived === 'true' }),
      ...(q.search
        ? {
            $or: [
              { name: new RegExp(escapeRegex(q.search), 'i') },
              { code: new RegExp(escapeRegex(q.search), 'i') },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db[kind]
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.db[kind].countDocuments(filter),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
  async createCatalog(
    kind: CatalogKind,
    lecturerId: string,
    dto: SemesterDto | CatalogDto,
  ) {
    if ('academicYear' in dto) this.validateYear(dto.academicYear);
    return this.db[kind].create({ ...dto, lecturerId });
  }
  async updateCatalog(
    kind: CatalogKind,
    lecturerId: string,
    id: string,
    dto: Partial<SemesterDto & CatalogDto>,
  ) {
    if (dto.academicYear) this.validateYear(dto.academicYear);
    const result = await this.db[kind].findOneAndUpdate(
      { _id: id, lecturerId },
      { $set: dto },
      { returnDocument: 'after', runValidators: true },
    );
    if (!result) throw new NotFoundException('Không tìm thấy dữ liệu.');
    return result;
  }
  private validateYear(year: string) {
    const [start, end] = year.split('-').map(Number);
    if (end !== start + 1)
      throw new BadRequestException('Năm học phải gồm hai năm liên tiếp.');
  }
  async archive(
    kind: CatalogKind | 'courseSections' | 'assignments',
    lecturerId: string,
    id: string,
    archived: boolean,
  ) {
    const result =
      kind === 'assignments'
        ? await this.db.assignments.findOneAndUpdate(
            { _id: id, lecturerId },
            { $set: { archived } },
            { returnDocument: 'after' },
          )
        : kind === 'courseSections'
          ? await this.db.courseSections.findOneAndUpdate(
              { _id: id, lecturerId },
              { $set: { archived } },
              { returnDocument: 'after' },
            )
          : await this.db[kind].findOneAndUpdate(
              { _id: id, lecturerId },
              { $set: { archived } },
              { returnDocument: 'after' },
            );
    if (!result) throw new NotFoundException('Không tìm thấy dữ liệu.');
    return result;
  }
  async listSections(lecturerId: string, q: ListQuery) {
    const filter = {
      lecturerId,
      ...(q.archived === 'all' ? {} : { archived: q.archived === 'true' }),
      ...(q.semesterId ? { semesterId: q.semesterId } : {}),
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.search
        ? {
            $or: [
              { name: new RegExp(escapeRegex(q.search), 'i') },
              { code: new RegExp(escapeRegex(q.search), 'i') },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.courseSections
        .find(filter)
        .populate('semesterId subjectId classId')
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.db.courseSections.countDocuments(filter),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
  private async validateSectionReferences(
    lecturerId: string,
    dto: SectionDto | UpdateSectionDto,
  ) {
    for (const [key, model] of [
      ['semesterId', this.db.semesters],
      ['subjectId', this.db.subjects],
      ['classId', this.db.classes],
    ] as const) {
      if (
        dto[key] &&
        !(await model.exists({ _id: dto[key], lecturerId, archived: false }))
      )
        throw new BadRequestException(
          'Học kỳ, môn học hoặc lớp không tồn tại, đã lưu trữ hoặc không thuộc quyền quản lý.',
        );
    }
  }
  async createSection(lecturerId: string, dto: SectionDto) {
    await this.validateSectionReferences(lecturerId, dto);
    return this.db.courseSections.create({ ...dto, lecturerId });
  }
  async updateSection(lecturerId: string, id: string, dto: UpdateSectionDto) {
    const section = await this.db.courseSections.findOne({
      _id: id,
      lecturerId,
    });
    if (!section) throw new NotFoundException('Không tìm thấy lớp học phần.');
    await this.validateSectionReferences(lecturerId, dto);
    // Keep the academic context of existing receipts stable.
    if (
      ['semesterId', 'subjectId', 'classId'].some(
        (key) =>
          dto[key as keyof UpdateSectionDto] !== undefined &&
          String(dto[key as keyof UpdateSectionDto]) !==
            String(section.get(key)),
      ) &&
      (await this.db.assignments.exists({ courseSectionId: id }))
    )
      throw new BadRequestException(
        'Lớp học phần đã có bài tập; hãy tạo lớp học phần mới nếu cần thay đổi liên kết.',
      );
    Object.assign(section, dto);
    return section.save();
  }
  async assertActiveSection(id: string, lecturerId?: string) {
    const section = await this.db.courseSections
      .findOne({
        _id: id,
        archived: false,
        ...(lecturerId ? { lecturerId } : {}),
      })
      .lean();
    if (!section)
      throw new NotFoundException(
        'Lớp học phần không tồn tại hoặc đã lưu trữ.',
      );
    const refs = await Promise.all([
      this.db.semesters.exists({ _id: section.semesterId, archived: false }),
      this.db.subjects.exists({ _id: section.subjectId, archived: false }),
      this.db.classes.exists({ _id: section.classId, archived: false }),
      this.db.lecturers.exists({ _id: section.lecturerId, active: true }),
    ]);
    if (refs.some((ref) => !ref))
      throw new NotFoundException('Lớp học phần hiện không khả dụng.');
    return section;
  }
  private validateDates(opensAt: string | Date, dueAt: string | Date) {
    for (const date of [opensAt, dueAt]) {
      if (typeof date === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/.test(date))
        throw new BadRequestException(
          'Thời gian cần có múi giờ (Z hoặc +07:00).',
        );
    }
    if (new Date(dueAt) <= new Date(opensAt))
      throw new BadRequestException('Hạn nộp phải sau thời gian mở.');
  }
  async createAssignment(lecturerId: string, dto: AssignmentDto) {
    await this.assertActiveSection(dto.courseSectionId, lecturerId);
    this.validateDates(dto.opensAt, dto.dueAt);
    return this.db.assignments.create({ ...dto, lecturerId });
  }
  async updateAssignment(
    lecturerId: string,
    id: string,
    dto: UpdateAssignmentDto,
  ) {
    const assignment = await this.ownedAssignment(id, lecturerId, 'general');
    if (
      dto.courseSectionId &&
      dto.courseSectionId !== assignment.courseSectionId?.toString()
    )
      throw new BadRequestException(
        'Không thể chuyển bài tập sang lớp học phần khác.',
      );
    this.validateDates(
      dto.opensAt ?? assignment.opensAt,
      dto.dueAt ?? assignment.dueAt,
    );
    Object.assign(assignment, dto);
    return assignment.save();
  }
  async ownedAssignment(
    id: string,
    lecturerId: string,
    category?: 'general' | 'specialized',
  ) {
    const assignment = await this.db.assignments.findOne({
      _id: id,
      lecturerId,
      ...(category
        ? {
            category:
              category === 'general' ? { $ne: 'specialized' } : 'specialized',
          }
        : {}),
    });
    if (!assignment) throw new NotFoundException('Không tìm thấy bài tập.');
    return assignment;
  }
  async listAssignments(
    lecturerId: string,
    q: ListQuery,
    category: 'general' | 'specialized' = 'general',
  ) {
    const filter = {
      lecturerId,
      category:
        category === 'general'
          ? { $ne: 'specialized' as const }
          : ('specialized' as const),
      ...(q.archived === 'all' ? {} : { archived: q.archived === 'true' }),
      ...(q.courseSectionId ? { courseSectionId: q.courseSectionId } : {}),
      ...(q.pathId ? { pathId: q.pathId } : {}),
      ...(q.moduleId ? { moduleId: q.moduleId } : {}),
      ...(q.lessonId ? { lessonId: q.lessonId } : {}),
      ...(q.search ? { title: new RegExp(escapeRegex(q.search), 'i') } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.assignments
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.db.assignments.countDocuments(filter),
    ]);
    return {
      items: items.map((a) => ({
        ...a,
        status: assignmentStatus(a),
        submissionUrl: `${this.config.getOrThrow<string>('FRONTEND_URL').split(',')[0]}/${category === 'specialized' ? 'specialized/' : ''}assignments/${a._id}`,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }
  async dashboard(lecturerId: string) {
    const [
      courseSections,
      assignments,
      submissions,
      versions,
      lateSubmissions,
    ] = await Promise.all([
      this.db.courseSections.countDocuments({ lecturerId, archived: false }),
      this.db.assignments.countDocuments({
        lecturerId,
        archived: false,
        category: { $ne: 'specialized' },
      }),
      this.db.submissions.countDocuments({
        lecturerId,
        category: { $ne: 'specialized' },
        latestVersion: { $gt: 0 },
      }),
      this.db.versions.countDocuments({
        lecturerId,
        category: { $ne: 'specialized' },
      }),
      this.db.submissions.countDocuments({
        lecturerId,
        category: { $ne: 'specialized' },
        latestVersion: { $gt: 0 },
        late: true,
      }),
    ]);
    return {
      courseSections,
      assignments,
      submissions,
      versions,
      lateSubmissions,
    };
  }

  async publicSemesters() {
    const ids = await this.visibleSectionIds();
    const semesterIds = await this.db.courseSections.distinct('semesterId', {
      _id: { $in: ids },
    });
    return this.db.semesters
      .find({ _id: { $in: semesterIds }, archived: false })
      .select('name academicYear')
      .sort({ academicYear: -1, name: 1 })
      .lean();
  }
  private async visibleSectionIds() {
    const [semesters, subjects, classes, lecturers] = await Promise.all([
      this.db.semesters.distinct('_id', { archived: false }),
      this.db.subjects.distinct('_id', { archived: false }),
      this.db.classes.distinct('_id', { archived: false }),
      this.db.lecturers.distinct('_id', { active: true }),
    ]);
    return this.db.courseSections.distinct('_id', {
      archived: false,
      semesterId: { $in: semesters },
      subjectId: { $in: subjects },
      classId: { $in: classes },
      lecturerId: { $in: lecturers },
    });
  }
  async publicClasses(q: ListQuery) {
    const ids = await this.visibleSectionIds();
    const classIds = await this.db.courseSections.distinct('classId', {
      _id: { $in: ids },
      ...(q.semesterId ? { semesterId: q.semesterId } : {}),
    });
    return this.db.classes
      .find({ _id: { $in: classIds }, archived: false })
      .select('name code')
      .sort({ code: 1 })
      .lean();
  }
  async publicSections(q: ListQuery) {
    const ids = await this.visibleSectionIds();
    const filter = {
      _id: { $in: ids },
      ...(q.semesterId ? { semesterId: q.semesterId } : {}),
      ...(q.classId ? { classId: q.classId } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.courseSections
        .find(filter)
        .select('code name semesterId subjectId classId lecturerId')
        .populate('semesterId', 'name academicYear')
        .populate('subjectId classId', 'name code')
        .populate('lecturerId', 'fullName')
        .sort({ code: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.db.courseSections.countDocuments(filter),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
  async publicAssignments(q: ListQuery) {
    const ids = await this.visibleSectionIds();
    const filter = {
      category: { $ne: 'specialized' as const },
      archived: false,
      courseSectionId: q.courseSectionId
        ? { $in: ids.filter((id) => id.toString() === q.courseSectionId) }
        : { $in: ids },
    };
    const [items, total] = await Promise.all([
      this.db.assignments
        .find(filter)
        .select('-lecturerId')
        .sort({ dueAt: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.db.assignments.countDocuments(filter),
    ]);
    return {
      items: items.map((a) => ({ ...a, status: assignmentStatus(a) })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }
  async publicAssignment(id: string) {
    const assignment = await this.db.assignments
      .findOne({ _id: id, archived: false, category: { $ne: 'specialized' } })
      .lean();
    if (!assignment) throw new NotFoundException('Không tìm thấy bài tập.');
    await this.assertActiveSection(assignment.courseSectionId!.toString());
    const section = await this.db.courseSections
      .findById(assignment.courseSectionId)
      .select('name code semesterId subjectId classId lecturerId')
      .populate('semesterId', 'name academicYear')
      .populate('subjectId classId', 'name code')
      .populate('lecturerId', 'fullName')
      .lean();
    const { lecturerId: _lecturerId, ...data } = assignment;
    return {
      ...data,
      courseSection: section,
      status: assignmentStatus(assignment),
      serverTime: new Date().toISOString(),
      timezone: 'Asia/Ho_Chi_Minh',
    };
  }

  async createSpecializedAssignment(
    lecturerId: string,
    pathId: string,
    dto: SpecializedAssignmentDto,
    session?: ClientSession,
  ) {
    if (
      !(await this.db.learningPaths
        .exists({
          _id: pathId,
          lecturerId,
          archived: false,
        })
        .session(session ?? null))
    )
      throw new NotFoundException('Không tìm thấy lộ trình đang sử dụng.');
    this.validateDates(dto.opensAt, dto.dueAt);
    const placement = await this.resolveAssignmentPlacement(
      lecturerId,
      pathId,
      dto,
      session,
    );
    const { moduleId: _moduleId, lessonId: _lessonId, ...content } = dto;
    const [assignment] = await this.db.assignments.create(
      [
        {
          ...content,
          ...placement,
          lecturerId,
          pathId,
          category: 'specialized',
          allowedExtensions: content.allowedExtensions ?? ['zip'],
          maxFiles: content.maxFiles ?? 1,
          maxFileBytes: content.maxFileBytes ?? 10485760,
        },
      ],
      { session },
    );
    return assignment;
  }
  async resolveAssignmentPlacement(
    lecturerId: string,
    pathId: string,
    placement: AssignmentPlacement,
    session?: ClientSession,
    published = false,
  ) {
    let moduleId = placement.moduleId?.toLowerCase();
    let lessonId: string | undefined;
    const visibility = published ? { published: true } : {};
    if (placement.lessonId) {
      const lesson = await this.db.lessons
        .findOne({
          _id: placement.lessonId,
          lecturerId,
          pathId,
          archived: false,
          ...visibility,
        })
        .select('moduleId')
        .session(session ?? null)
        .lean();
      if (!lesson)
        throw new NotFoundException(
          'Không tìm thấy bài học khả dụng trong lộ trình.',
        );
      if (moduleId && moduleId !== lesson.moduleId.toString())
        throw new BadRequestException('Bài học không thuộc chương đã chọn.');
      moduleId = lesson.moduleId.toString();
      lessonId = lesson._id.toString();
    }
    if (
      moduleId &&
      !(await this.db.learningModules
        .exists({
          _id: moduleId,
          lecturerId,
          pathId,
          archived: false,
          ...visibility,
        })
        .session(session ?? null))
    )
      throw new NotFoundException(
        'Không tìm thấy chương học khả dụng trong lộ trình.',
      );
    return { moduleId, lessonId };
  }
  async createModuleAssignment(
    lecturerId: string,
    moduleId: string,
    dto: SpecializedAssignmentContentDto,
  ) {
    const module = await this.db.learningModules
      .findOne({ _id: moduleId, lecturerId, archived: false })
      .select('pathId')
      .lean();
    if (!module) throw new NotFoundException('Không tìm thấy chương học.');
    return this.createSpecializedAssignment(
      lecturerId,
      module.pathId.toString(),
      { ...dto, moduleId },
    );
  }
  async createLessonAssignment(
    lecturerId: string,
    lessonId: string,
    dto: SpecializedAssignmentContentDto,
  ) {
    const lesson = await this.db.lessons
      .findOne({ _id: lessonId, lecturerId, archived: false })
      .select('pathId')
      .lean();
    if (!lesson) throw new NotFoundException('Không tìm thấy bài học.');
    return this.createSpecializedAssignment(
      lecturerId,
      lesson.pathId.toString(),
      { ...dto, lessonId },
    );
  }
  async linkSpecializedAssignments(
    lecturerId: string,
    pathId: string,
    placement: AssignmentPlacement,
    ids: string[],
    session: ClientSession,
  ) {
    if (!ids.length) return;
    if (
      !(await this.db.learningPaths
        .exists({ _id: pathId, lecturerId, archived: false })
        .session(session))
    )
      throw new NotFoundException('Không tìm thấy lộ trình đang sử dụng.');
    const resolved = await this.resolveAssignmentPlacement(
      lecturerId,
      pathId,
      placement,
      session,
    );
    const filter = {
      _id: { $in: ids },
      lecturerId,
      pathId,
      category: 'specialized' as const,
      archived: false,
    };
    if (
      (await this.db.assignments.countDocuments(filter).session(session)) !==
      ids.length
    )
      throw new BadRequestException(
        'Các bài tập liên kết phải đang sử dụng, cùng lộ trình và thuộc giảng viên quản lý.',
      );
    const $set = {
      ...(resolved.moduleId ? { moduleId: resolved.moduleId } : {}),
      ...(resolved.lessonId ? { lessonId: resolved.lessonId } : {}),
    };
    const $unset = {
      ...(!resolved.moduleId ? { moduleId: '' } : {}),
      ...(!resolved.lessonId ? { lessonId: '' } : {}),
    };
    const result = await this.db.assignments.updateMany(
      filter,
      { $set, $unset },
      { session, runValidators: true },
    );
    if (result.matchedCount !== ids.length)
      throw new BadRequestException(
        'Bài tập liên kết đã thay đổi. Vui lòng thử lại.',
      );
  }
  async assertStudentAssignmentPlacement(
    assignment: Assignment,
    session?: ClientSession,
  ) {
    return this.resolveAssignmentPlacement(
      assignment.lecturerId.toString(),
      assignment.pathId!.toString(),
      {
        moduleId: assignment.moduleId?.toString(),
        lessonId: assignment.lessonId?.toString(),
      },
      session,
      true,
    );
  }
  async visibleAssignmentPlacementFilter(lecturerId: string, pathId: string) {
    const modules = await this.db.learningModules.distinct('_id', {
      lecturerId,
      pathId,
      published: true,
      archived: false,
    });
    const lessons = await this.db.lessons.distinct('_id', {
      lecturerId,
      pathId,
      moduleId: { $in: modules },
      published: true,
      archived: false,
    });
    return {
      $or: [
        { moduleId: null, lessonId: null },
        { moduleId: { $in: modules }, lessonId: null },
        { moduleId: { $in: modules }, lessonId: { $in: lessons } },
      ],
    };
  }
  async updateSpecializedAssignment(
    lecturerId: string,
    id: string,
    dto: UpdateSpecializedAssignmentDto,
  ) {
    const assignment = await this.ownedAssignment(
      id,
      lecturerId,
      'specialized',
    );
    this.validateDates(
      dto.opensAt ?? assignment.opensAt,
      dto.dueAt ?? assignment.dueAt,
    );
    const { removePlacement, moduleId, lessonId, ...content } = dto;
    if (removePlacement && (moduleId || lessonId))
      throw new BadRequestException(
        'Không thể vừa gỡ vừa đặt liên kết chương/bài học.',
      );
    if (removePlacement || moduleId !== undefined || lessonId !== undefined) {
      const placement = removePlacement
        ? { moduleId: undefined, lessonId: undefined }
        : await this.resolveAssignmentPlacement(
            lecturerId,
            assignment.pathId!.toString(),
            { moduleId, lessonId },
          );
      assignment.set(placement);
    }
    Object.assign(assignment, content);
    return assignment.save();
  }
  async assertStudentPath(pathId: string, student: StudentRequest['student']) {
    const path = await this.db.learningPaths
      .findOne({
        _id: pathId,
        lecturerId: student.lecturerId,
        published: true,
        archived: false,
      })
      .lean();
    if (!path) throw new NotFoundException('Lộ trình không khả dụng.');
    if (
      !(await this.db.enrollments.exists({
        pathId,
        lecturerId: student.lecturerId,
        studentId: student.id,
        active: true,
      }))
    )
      throw new ForbiddenException(
        'Bạn cần được ghi danh để mở và nộp bài tập của lộ trình.',
      );
    return path;
  }
  async studentAssignment(id: string, student: StudentRequest['student']) {
    const assignment = await this.db.assignments
      .findOne({
        _id: id,
        category: 'specialized',
        lecturerId: student.lecturerId,
        archived: false,
      })
      .lean();
    if (!assignment?.pathId)
      throw new NotFoundException('Không tìm thấy bài tập.');
    const path = await this.assertStudentPath(
      assignment.pathId.toString(),
      student,
    );
    await this.assertStudentAssignmentPlacement(assignment);
    return {
      ...assignment,
      learningPath: { id: path._id, title: path.title },
      status: assignmentStatus(assignment),
      serverTime: new Date().toISOString(),
    };
  }
  async studentAssignments(
    pathId: string,
    student: StudentRequest['student'],
    q: ListQuery,
  ) {
    await this.assertStudentPath(pathId, student);
    const filter = {
      pathId,
      lecturerId: student.lecturerId,
      category: 'specialized' as const,
      archived: false,
      ...(q.moduleId ? { moduleId: q.moduleId } : {}),
      ...(q.lessonId ? { lessonId: q.lessonId } : {}),
      ...(await this.visibleAssignmentPlacementFilter(
        student.lecturerId,
        pathId,
      )),
    };
    const [items, total] = await Promise.all([
      this.db.assignments
        .find(filter)
        .sort({ dueAt: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.db.assignments.countDocuments(filter),
    ]);
    return {
      items: items.map((a) => ({ ...a, status: assignmentStatus(a) })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }
}
