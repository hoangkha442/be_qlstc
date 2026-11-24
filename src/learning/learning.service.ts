import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { CloudinaryService } from '../storage/cloudinary.service.js';
import { LessonFilesService, lessonView } from './lesson-files.js';
import { Database } from '../database/database.module.js';
import { MailService } from '../mail/mail.service.js';
import { AcademicService, escapeRegex } from '../academic/academic.service.js';
import { assignmentStatus } from '../academic/assignment-policy.js';
import type {
  AssignmentAttachmentsDto,
  AssignmentPlacement,
} from '../academic/academic.dto.js';
import type { Lesson, Student } from './learning.schemas.js';
import {
  CreateStudentDto,
  EnrollmentDto,
  LearningModuleDto,
  LearningPathDto,
  LearningQuery,
  LessonDto,
  UpdateLearningModuleDto,
  UpdateLearningPathDto,
  UpdateLessonDto,
  UpdateStudentDto,
} from './learning.dto.js';

const pageInfo = (q: LearningQuery, items: unknown[], total: number) => ({
  items,
  total,
  page: q.page,
  limit: q.limit,
});
const archiveFilter = (q: LearningQuery) =>
  q.archived === 'all' ? {} : { archived: q.archived === 'true' };
const studentProfile = (s: Student) => ({
  _id: s._id,
  lecturerId: s.lecturerId,
  username: s.username,
  studentCode: s.studentCode,
  fullName: s.fullName,
  email: s.email,
  active: s.active,
  mustChangePassword: s.mustChangePassword,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

@Injectable()
export class LearningService {
  constructor(
    private readonly db: Database,
    private readonly mail: MailService,
    private readonly academic: AcademicService,
    private readonly lessonFiles: LessonFilesService,
    private readonly storage: CloudinaryService,
  ) {}
  async students(lecturerId: string, q: LearningQuery) {
    const filter = {
      lecturerId,
      ...(q.active ? { active: q.active === 'true' } : {}),
      ...(q.search
        ? {
            $or: ['username', 'studentCode', 'fullName', 'email'].map(
              (key) => ({ [key]: new RegExp(escapeRegex(q.search!), 'i') }),
            ),
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.students
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.db.students.countDocuments(filter),
    ]);
    return pageInfo(q, items.map(studentProfile), total);
  }
  async createStudent(lecturerId: string, dto: CreateStudentDto) {
    this.mail.assertConfigured();
    const temporaryPassword = randomBytes(18).toString('base64url');
    const student = await this.db.students.create({
      ...dto,
      lecturerId,
      passwordHash: await hash(temporaryPassword, 12),
    });
    const emailSent = await this.mail.sendAccount(student, temporaryPassword);
    return {
      student: studentProfile(student.toObject()),
      emailSent,
      message: emailSent
        ? 'Đã cấp tài khoản và gửi thông tin đăng nhập tới email sinh viên.'
        : 'Tài khoản đã tạo nhưng chưa gửi được email. Kiểm tra Gmail rồi cấp lại mật khẩu để gửi lại.',
    };
  }
  async updateStudent(lecturerId: string, id: string, dto: UpdateStudentDto) {
    const student = await this.db.students
      .findOneAndUpdate(
        { _id: id, lecturerId },
        {
          $set: dto,
          ...(dto.active !== undefined ? { $inc: { tokenVersion: 1 } } : {}),
        },
        { returnDocument: 'after', runValidators: true },
      )
      .lean();
    if (!student) throw new NotFoundException('Không tìm thấy sinh viên.');
    return studentProfile(student);
  }
  async resetPassword(lecturerId: string, id: string) {
    this.mail.assertConfigured();
    const temporaryPassword = randomBytes(18).toString('base64url');
    const student = await this.db.students
      .findOneAndUpdate(
        { _id: id, lecturerId },
        {
          $set: {
            passwordHash: await hash(temporaryPassword, 12),
            mustChangePassword: true,
          },
          $inc: { tokenVersion: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean();
    if (!student) throw new NotFoundException('Không tìm thấy sinh viên.');
    const emailSent = await this.mail.sendAccount(
      student,
      temporaryPassword,
      true,
    );
    return {
      student: studentProfile(student),
      emailSent,
      message: emailSent
        ? 'Đã gửi mật khẩu mới tới email sinh viên và thu hồi phiên cũ.'
        : 'Mật khẩu đã đổi nhưng chưa gửi được email. Kiểm tra Gmail rồi thử cấp lại.',
    };
  }
  async ownedPath(lecturerId: string, id: string, session?: ClientSession) {
    const path = await this.db.learningPaths
      .findOne({ _id: id, lecturerId })
      .session(session ?? null)
      .lean();
    if (!path) throw new NotFoundException('Không tìm thấy lộ trình.');
    return path;
  }
  async paths(lecturerId: string, q: LearningQuery) {
    const filter = {
      lecturerId,
      ...archiveFilter(q),
      ...(q.published ? { published: q.published === 'true' } : {}),
      ...(q.search ? { title: new RegExp(escapeRegex(q.search), 'i') } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.learningPaths
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.db.learningPaths.countDocuments(filter),
    ]);
    return pageInfo(q, items, total);
  }
  createPath(lecturerId: string, dto: LearningPathDto) {
    return this.db.learningPaths.create({
      ...dto,
      lecturerId,
      category: 'specialized',
    });
  }
  async updatePath(
    lecturerId: string,
    id: string,
    dto: UpdateLearningPathDto | { archived: boolean },
  ) {
    const result = await this.db.learningPaths.findOneAndUpdate(
      { _id: id, lecturerId },
      { $set: dto },
      { returnDocument: 'after', runValidators: true },
    );
    if (!result) throw new NotFoundException('Không tìm thấy lộ trình.');
    return result;
  }
  async pathDetail(lecturerId: string, id: string) {
    const path = await this.ownedPath(lecturerId, id);
    const [modules, lessons, assignments] = await Promise.all([
      this.db.learningModules
        .find({ pathId: id, lecturerId })
        .sort({ order: 1, _id: 1 })
        .lean(),
      this.db.lessons
        .find({ pathId: id, lecturerId })
        .sort({ order: 1, _id: 1 })
        .lean(),
      this.pathAssignments(lecturerId, id),
    ]);
    return {
      ...path,
      assignments: assignments.filter((a) => !a.moduleId && !a.lessonId),
      modules: modules.map((m) => ({
        ...m,
        assignments: assignments.filter(
          (a) => a.moduleId?.equals(m._id) && !a.lessonId,
        ),
        lessons: lessons
          .filter((l) => l.moduleId.equals(m._id))
          .map((l) => ({
            ...lessonView(l),
            assignments: assignments.filter((a) => a.lessonId?.equals(l._id)),
          })),
      })),
    };
  }
  private async pathAssignments(
    lecturerId: string,
    pathId: string,
    student = false,
  ) {
    const assignments = await this.db.assignments
      .find({
        lecturerId,
        pathId,
        category: 'specialized',
        ...(student
          ? {
              archived: false,
              ...(await this.academic.visibleAssignmentPlacementFilter(
                lecturerId,
                pathId,
              )),
            }
          : {}),
      })
      .sort({ dueAt: 1, _id: 1 })
      .lean();
    return assignments.map((assignment) => ({
      ...assignment,
      status: assignmentStatus(assignment),
    }));
  }
  private async attachAssignments(
    lecturerId: string,
    pathId: string,
    placement: AssignmentPlacement,
    dto: AssignmentAttachmentsDto,
    session: ClientSession,
  ) {
    if (dto.assignmentIds?.length)
      await this.academic.linkSpecializedAssignments(
        lecturerId,
        pathId,
        placement,
        dto.assignmentIds,
        session,
      );
    for (const assignment of dto.assignments ?? [])
      await this.academic.createSpecializedAssignment(
        lecturerId,
        pathId,
        { ...assignment, ...placement },
        session,
      );
    const assignments = await this.db.assignments
      .find({
        lecturerId,
        pathId,
        category: 'specialized',
        moduleId: placement.moduleId,
        lessonId: placement.lessonId ?? null,
      })
      .sort({ dueAt: 1, _id: 1 })
      .session(session)
      .lean();
    return assignments.map((assignment) => ({
      ...assignment,
      status: assignmentStatus(assignment),
    }));
  }
  async createModule(
    lecturerId: string,
    pathId: string,
    dto: LearningModuleDto,
  ) {
    const { assignments, assignmentIds, ...data } = dto;
    return this.db.connection.transaction(async (session) => {
      const path = await this.ownedPath(lecturerId, pathId, session);
      if (path.archived)
        throw new BadRequestException(
          'Không thể thêm chương vào lộ trình đã lưu trữ.',
        );
      const [module] = await this.db.learningModules.create(
        [{ ...data, pathId, lecturerId }],
        { session },
      );
      const linked = await this.attachAssignments(
        lecturerId,
        pathId,
        { moduleId: module._id.toString() },
        { assignments, assignmentIds },
        session,
      );
      return { ...module.toObject(), assignments: linked };
    });
  }
  async updateModule(
    lecturerId: string,
    id: string,
    dto: UpdateLearningModuleDto | { archived: boolean },
  ) {
    const { assignments, assignmentIds, ...data } =
      dto as UpdateLearningModuleDto & { archived?: boolean };
    return this.db.connection.transaction(async (session) => {
      const result = await this.db.learningModules.findOneAndUpdate(
        { _id: id, lecturerId },
        { $set: data },
        { returnDocument: 'after', runValidators: true, session },
      );
      if (!result) throw new NotFoundException('Không tìm thấy chương học.');
      const linked = await this.attachAssignments(
        lecturerId,
        result.pathId.toString(),
        { moduleId: id },
        { assignments, assignmentIds },
        session,
      );
      return { ...result.toObject(), assignments: linked };
    });
  }
  private lessonData(dto: LessonDto | UpdateLessonDto) {
    const { removeVideo, assignments, assignmentIds, keepFileIds, ...data } =
      dto;
    if (removeVideo && data.videoUrl)
      throw new BadRequestException('Không thể vừa xóa vừa đặt video.');
    return { data, removeVideo, assignments, assignmentIds, keepFileIds };
  }
  async createLesson(
    lecturerId: string,
    moduleId: string,
    dto: LessonDto,
    files: Express.Multer.File[] = [],
  ) {
    this.lessonData(dto);
    this.lessonFiles.select([], dto.keepFileIds, files.length);
    const ownerModule = await this.db.learningModules
      .findOne({ _id: moduleId, lecturerId, archived: false })
      .lean();
    if (!ownerModule) throw new NotFoundException('Không tìm thấy chương học.');
    const ownerPath = await this.ownedPath(
      lecturerId,
      ownerModule.pathId.toString(),
    );
    if (ownerPath.archived)
      throw new BadRequestException(
        'Không thể thêm bài học vào lộ trình đã lưu trữ.',
      );
    const uploaded = await this.lessonFiles.upload(lecturerId, files);
    return this.db.connection.transaction(async (session) => {
      const module = await this.db.learningModules
        .findOne({ _id: moduleId, lecturerId, archived: false })
        .session(session)
        .lean();
      if (!module) throw new NotFoundException('Không tìm thấy chương học.');
      const pathId = module.pathId.toString();
      const path = await this.ownedPath(lecturerId, pathId, session);
      if (path.archived)
        throw new BadRequestException(
          'Không thể thêm bài học vào lộ trình đã lưu trữ.',
        );
      const { data, assignments, assignmentIds } = this.lessonData(dto);
      const [lesson] = await this.db.lessons.create(
        [
          {
            ...data,
            files: uploaded,
            lecturerId,
            moduleId,
            pathId: module.pathId,
          },
        ],
        { session },
      );
      const linked = await this.attachAssignments(
        lecturerId,
        pathId,
        { moduleId, lessonId: lesson._id.toString() },
        { assignments, assignmentIds },
        session,
      );
      return { ...lessonView(lesson.toObject()), assignments: linked };
    });
  }
  async updateLesson(
    lecturerId: string,
    id: string,
    dto: UpdateLessonDto | { archived: boolean },
    files: Express.Multer.File[] = [],
  ) {
    const { data, removeVideo, assignments, assignmentIds, keepFileIds } =
      this.lessonData(dto as UpdateLessonDto);
    const owner = await this.db.lessons.findOne({ _id: id, lecturerId }).lean();
    if (!owner) throw new NotFoundException('Không tìm thấy bài học.');
    this.lessonFiles.select(owner.files ?? [], keepFileIds, files.length);
    const uploaded = await this.lessonFiles.upload(lecturerId, files);
    return this.db.connection.transaction(async (session) => {
      const current = await this.db.lessons
        .findOne({ _id: id, lecturerId })
        .session(session)
        .lean();
      if (!current) throw new NotFoundException('Không tìm thấy bài học.');
      const retained = this.lessonFiles.select(
        current.files ?? [],
        keepFileIds,
        uploaded.length,
      );
      await this.lessonFiles.queueRemoved(
        (current.files ?? []).filter(
          (file) => !retained.some((kept) => kept.id === file.id),
        ),
        session,
      );
      const result = await this.db.lessons.findOneAndUpdate(
        { _id: id, lecturerId },
        {
          $set: { ...data, files: [...retained, ...uploaded] },
          ...(removeVideo ? { $unset: { videoUrl: '' } } : {}),
        },
        { returnDocument: 'after', runValidators: true, session },
      );
      if (!result) throw new NotFoundException('Không tìm thấy bài học.');
      const linked = await this.attachAssignments(
        lecturerId,
        result.pathId.toString(),
        { moduleId: result.moduleId.toString(), lessonId: id },
        { assignments, assignmentIds },
        session,
      );
      return { ...lessonView(result.toObject()), assignments: linked };
    });
  }
  async enroll(lecturerId: string, pathId: string, dto: EnrollmentDto) {
    await this.ownedPath(lecturerId, pathId);
    if (!(await this.db.students.exists({ _id: dto.studentId, lecturerId })))
      throw new NotFoundException(
        'Không tìm thấy sinh viên thuộc quyền quản lý.',
      );
    return this.db.enrollments.findOneAndUpdate(
      { pathId, studentId: dto.studentId },
      {
        $set: { lecturerId, active: dto.active ?? true },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
  }
  async enrollments(lecturerId: string, pathId: string, q: LearningQuery) {
    await this.ownedPath(lecturerId, pathId);
    const filter = {
      lecturerId,
      pathId,
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.active ? { active: q.active === 'true' } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.enrollments
        .find(filter)
        .populate('studentId', 'username studentCode fullName email active')
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.db.enrollments.countDocuments(filter),
    ]);
    return pageInfo(q, items, total);
  }
  async studentPaths(studentId: string, lecturerId: string, q: LearningQuery) {
    const filter = {
      lecturerId,
      published: true,
      archived: false,
      ...(q.search ? { title: new RegExp(escapeRegex(q.search), 'i') } : {}),
    };
    const [paths, total] = await Promise.all([
      this.db.learningPaths
        .find(filter)
        .select('-description')
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.db.learningPaths.countDocuments(filter),
    ]);
    const enrollments = await this.db.enrollments
      .find({
        studentId,
        active: true,
        pathId: { $in: paths.map((p) => p._id) },
      })
      .lean();
    return pageInfo(
      q,
      paths.map((path) => ({
        ...path,
        enrolled: enrollments.some((e) => e.pathId.equals(path._id)),
      })),
      total,
    );
  }
  private async visiblePath(lecturerId: string, id: string) {
    const path = await this.db.learningPaths
      .findOne({ _id: id, lecturerId, published: true, archived: false })
      .lean();
    if (!path)
      throw new NotFoundException(
        'Lộ trình chưa được công bố hoặc không thuộc giảng viên của bạn.',
      );
    return path;
  }
  private outline(lesson: Lesson, completed: boolean, enrolled: boolean) {
    return {
      _id: lesson._id,
      moduleId: lesson.moduleId,
      pathId: lesson.pathId,
      title: lesson.title,
      summary: lesson.summary,
      order: lesson.order,
      durationSeconds: lesson.durationSeconds,
      isPreview: lesson.isPreview,
      hasVideo: Boolean(lesson.videoUrl),
      resourceCount: lesson.resources.length + (lesson.files?.length ?? 0),
      accessible: enrolled || lesson.isPreview,
      completed,
    };
  }
  async studentPath(studentId: string, lecturerId: string, pathId: string) {
    const path = await this.visiblePath(lecturerId, pathId);
    const [modules, enrollment, progress] = await Promise.all([
      this.db.learningModules
        .find({ pathId, lecturerId, published: true, archived: false })
        .sort({ order: 1, _id: 1 })
        .lean(),
      this.db.enrollments.exists({
        studentId,
        pathId,
        lecturerId,
        active: true,
      }),
      this.db.lessonProgress
        .find({ studentId, pathId, completed: true })
        .select('lessonId')
        .lean(),
    ]);
    const lessons = await this.db.lessons
      .find({
        pathId,
        lecturerId,
        moduleId: { $in: modules.map((m) => m._id) },
        published: true,
        archived: false,
      })
      .sort({ order: 1, _id: 1 })
      .lean();
    const completedIds = new Set(progress.map((p) => p.lessonId.toString()));
    const assignments = enrollment
      ? await this.pathAssignments(lecturerId, pathId, true)
      : [];
    const completedLessons = lessons.filter((l) =>
      completedIds.has(l._id.toString()),
    ).length;
    return {
      ...path,
      enrolled: Boolean(enrollment),
      assignments: assignments.filter((a) => !a.moduleId && !a.lessonId),
      totalLessons: lessons.length,
      completedLessons,
      progressPercent: lessons.length
        ? Math.round((completedLessons * 100) / lessons.length)
        : 0,
      modules: modules.map((m) => ({
        ...m,
        assignments: assignments.filter(
          (a) => a.moduleId?.equals(m._id) && !a.lessonId,
        ),
        lessons: lessons
          .filter((l) => l.moduleId.equals(m._id))
          .map((l) => ({
            ...this.outline(
              l,
              completedIds.has(l._id.toString()),
              Boolean(enrollment),
            ),
            assignments: assignments.filter((a) => a.lessonId?.equals(l._id)),
          })),
      })),
    };
  }
  async studentLesson(
    studentId: string,
    lecturerId: string,
    id: string,
    requireEnrollment = false,
  ) {
    const lesson = await this.db.lessons
      .findOne({ _id: id, lecturerId, published: true, archived: false })
      .lean();
    if (!lesson) throw new NotFoundException('Không tìm thấy bài học.');
    await this.visiblePath(lecturerId, lesson.pathId.toString());
    if (
      !(await this.db.learningModules.exists({
        _id: lesson.moduleId,
        lecturerId,
        pathId: lesson.pathId,
        published: true,
        archived: false,
      }))
    )
      throw new NotFoundException('Chương học chưa được công bố.');
    const enrolled = Boolean(
      await this.db.enrollments.exists({
        studentId,
        lecturerId,
        pathId: lesson.pathId,
        active: true,
      }),
    );
    if (!enrolled && (requireEnrollment || !lesson.isPreview))
      throw new ForbiddenException(
        'Bạn chưa được giảng viên ghi danh vào lộ trình này.',
      );
    // Preview permits the lesson text and video; course materials require enrollment.
    const assignments = enrolled
      ? await this.db.assignments
          .find({
            lecturerId,
            pathId: lesson.pathId,
            moduleId: lesson.moduleId,
            lessonId: lesson._id,
            category: 'specialized',
            archived: false,
          })
          .sort({ dueAt: 1, _id: 1 })
          .lean()
      : [];
    return {
      ...lessonView(lesson),
      resources: enrolled ? lesson.resources : [],
      files: enrolled ? lessonView(lesson).files : [],
      enrolled,
      assignments: assignments.map((assignment) => ({
        ...assignment,
        status: assignmentStatus(assignment),
      })),
    };
  }
  async lessonFile(
    lecturerId: string,
    id: string,
    fileId: string,
    res: Response,
    studentId?: string,
  ) {
    if (studentId) await this.studentLesson(studentId, lecturerId, id, true);
    const lesson = await this.db.lessons
      .findOne({ _id: id, lecturerId })
      .lean();
    const file = lesson?.files?.find((file) => file.id === fileId);
    if (!file) throw new NotFoundException('Không tìm thấy tài liệu bài học.');
    const stream = await this.storage.download(file);
    res.attachment(file.originalName).type('application/octet-stream');
    res.setHeader('Content-Length', file.bytes);
    await pipeline(stream, res);
  }
  async progress(
    studentId: string,
    lecturerId: string,
    id: string,
    completed: boolean,
  ) {
    const lesson = await this.studentLesson(studentId, lecturerId, id, true);
    return this.db.lessonProgress.findOneAndUpdate(
      { studentId, lessonId: id },
      {
        $set: { pathId: lesson.pathId, completed },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
  }
}
