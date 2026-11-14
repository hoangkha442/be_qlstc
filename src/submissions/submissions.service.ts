import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import ExcelJS from 'exceljs';
import { Database } from '../database/database.module.js';
import type {
  StoredFile,
  Submission,
  UploadBatch,
} from '../database/schemas.js';
import {
  normalizeSearch,
  normalizeStudentCode,
  safeFilename,
  UPLOAD_LEASE_MS,
} from '../config.js';
import { AcademicService, escapeRegex } from '../academic/academic.service.js';
import { assertAccepting } from '../academic/assignment-policy.js';
import { ListQuery } from '../academic/academic.dto.js';
import {
  CloudinaryService,
  StorageUploadError,
} from '../storage/cloudinary.service.js';
import { validateSubmissionFiles } from '../storage/submission-validator.js';
import { validateSourceZip } from '../storage/source-zip-validator.js';
import type { StudentRequest } from '../learning/student-auth.js';
import {
  LookupReceiptDto,
  ReceiptFileDto,
  SubmitDto,
} from './submission.dto.js';
import { receiptSecret } from './receipt-secret.js';
import { MailService } from '../mail/mail.service.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function verifySecret(secret: string | undefined, secretHash: string) {
  return (
    typeof secret === 'string' &&
    timingSafeEqual(
      Buffer.from(hash(secret), 'hex'),
      Buffer.from(secretHash, 'hex'),
    )
  );
}

@Injectable()
export class SubmissionsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private cleaning = false;
  private readonly logger = new Logger(SubmissionsService.name);
  constructor(
    private readonly db: Database,
    private readonly academic: AcademicService,
    private readonly storage: CloudinaryService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}
  onModuleInit() {
    // Recover expired work after restart without blocking server startup on Cloudinary.
    void this.runCleanup().catch(() =>
      this.logger.warn('Chưa thể khôi phục tác vụ dọn file; sẽ thử lại.'),
    );
    this.timer = setInterval(() => {
      void this.runCleanup().catch(() =>
        this.logger.warn('Chưa thể chạy tác vụ dọn file; sẽ thử lại.'),
      );
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private firstSecret(receiptCode: string) {
    // A CSPRNG receipt nonce + a separate server key creates a reproducible, unpredictable secret.
    // This permits safe idempotent first-response replay while persisting only the secret hash.
    return receiptSecret(
      receiptCode,
      this.config.getOrThrow<string>('RECEIPT_SECRET'),
    );
  }
  private fingerprint(
    dto: SubmitDto,
    code: string,
    files: Express.Multer.File[],
  ) {
    return hash(
      JSON.stringify({
        code,
        fullName: dto.fullName,
        email: dto.email,
        note: dto.note ?? '',
        files: files.map((f) => ({
          name: safeFilename(f.originalname),
          mime: f.mimetype,
          digest: createHash('sha256').update(f.buffer).digest('hex'),
        })),
      }),
    );
  }
  private async replay(
    batch: UploadBatch,
    fingerprint: string,
    secret?: string,
    student?: StudentRequest['student'],
  ) {
    if (batch.fingerprint !== fingerprint)
      throw new ConflictException(
        'Idempotency-Key đã được dùng cho nội dung khác.',
      );
    if (batch.state !== 'completed') {
      const cleanup = batch.state === 'cleanup';
      const retryAfterSeconds = cleanup
        ? Math.max(1, Math.ceil((batch.retryAt.getTime() - Date.now()) / 1000))
        : 3;
      throw new ConflictException({
        statusCode: 409,
        code: cleanup ? 'UPLOAD_CLEANUP_PENDING' : 'SUBMISSION_PROCESSING',
        retryAfterSeconds,
        message: cleanup
          ? `${batch.failureMessage ? `${batch.failureMessage} ` : ''}Lần nộp trước chưa hoàn tất; hệ thống đang dọn file. Hãy giữ nguyên nội dung và thử lại sau ${retryAfterSeconds} giây.`
          : 'Yêu cầu đang được xử lý. Hãy giữ nguyên nội dung và thử lại sau vài giây.',
      });
    }
    const submission = await this.db.submissions
      .findById(batch.submissionId)
      .select('+secretHash')
      .lean();
    if (!submission || !batch.version)
      throw new ServiceUnavailableException(
        'Chưa thể lấy biên nhận. Vui lòng thử lại.',
      );
    if (student && String(submission.studentId) !== student.id)
      throw new ForbiddenException('Bài nộp không thuộc tài khoản của bạn.');
    if (
      !student &&
      batch.version > 1 &&
      !verifySecret(secret, submission.secretHash)
    )
      throw new UnauthorizedException('Mã bí mật không chính xác.');
    return this.confirmation(
      submission,
      batch.version,
      !student && batch.version === 1
        ? this.firstSecret(submission.receiptCode)
        : undefined,
      true,
      student,
    );
  }

  async submit(
    assignmentId: string,
    dto: SubmitDto,
    files: Express.Multer.File[] | undefined,
    idempotencyKey: string | undefined,
    student?: StudentRequest['student'],
  ) {
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{20,100}$/.test(idempotencyKey))
      throw new BadRequestException(
        'Header Idempotency-Key phải là chuỗi ngẫu nhiên 20–100 ký tự (khuyến nghị crypto.randomUUID()).',
      );
    const target = await this.db.assignments.findById(assignmentId).lean();
    if (!target || (target.category === 'specialized') !== Boolean(student))
      throw new NotFoundException('Không tìm thấy bài tập.');
    if (student) await this.academic.studentAssignment(assignmentId, student);
    const code = normalizeStudentCode(dto.studentCode);
    const requestKey = hash(`${assignmentId}:${code}:${idempotencyKey}`);
    const fingerprint = this.fingerprint(dto, code, files ?? []);
    let previousBatch = await this.db.batches.findOne({ requestKey }).lean();
    if (previousBatch && previousBatch.fingerprint !== fingerprint)
      throw new ConflictException(
        'Idempotency-Key đã được dùng cho nội dung khác.',
      );
    if (
      previousBatch?.state === 'processing' &&
      previousBatch.expiresAt <= new Date()
    ) {
      await this.db.batches.updateOne(
        {
          _id: previousBatch._id,
          state: 'processing',
          expiresAt: { $lte: new Date() },
        },
        { $set: { state: 'cleanup', retryAt: new Date() } },
      );
      previousBatch = await this.db.batches.findOne({ requestKey }).lean();
    }
    if (
      previousBatch?.state === 'cleanup' &&
      previousBatch.retryAt <= new Date()
    ) {
      await this.cleanupOne(previousBatch._id.toString());
      previousBatch = await this.db.batches.findOne({ requestKey }).lean();
    }
    if (previousBatch && previousBatch.state !== 'cleaned')
      return this.replay(previousBatch, fingerprint, dto.secret, student);
    if (!student) this.mail.assertConfigured();
    if (previousBatch && previousBatch.fingerprint !== fingerprint)
      throw new ConflictException(
        'Idempotency-Key đã được dùng cho nội dung khác.',
      );
    const assignment = target;
    if (assignment.archived)
      throw new NotFoundException('Không tìm thấy bài tập.');
    assertAccepting(assignment);
    const section = student
      ? undefined
      : await this.academic.assertActiveSection(
          assignment.courseSectionId!.toString(),
        );
    const validated = student
      ? await validateSourceZip(files)
      : await validateSubmissionFiles(files, assignment);
    let submission = await this.db.submissions
      .findOne({ assignmentId, studentCodeNormalized: code })
      .select('+secretHash')
      .lean();
    if (!submission) {
      const receiptCode = `BN-${randomBytes(16).toString('hex').toUpperCase()}`;
      try {
        const created = await this.db.submissions.create({
          assignmentId,
          courseSectionId: assignment.courseSectionId,
          category: student ? 'specialized' : 'general',
          ...(student
            ? { pathId: assignment.pathId, studentId: student.id }
            : {}),
          lecturerId: assignment.lecturerId,
          studentCodeNormalized: code,
          fullName: dto.fullName,
          email: dto.email,
          searchName: normalizeSearch(dto.fullName),
          note: dto.note ?? '',
          receiptCode,
          secretHash: hash(this.firstSecret(receiptCode)),
        });
        submission = created.toObject();
      } catch (error) {
        if ((error as { code?: number }).code === 11000)
          throw new ConflictException(
            'Một yêu cầu cho mã sinh viên này đang được xử lý. Hãy thử lại.',
          );
        throw error;
      }
    }
    if (student && String(submission.studentId) !== student.id)
      throw new ForbiddenException('Bài nộp không thuộc tài khoản của bạn.');
    if (submission.latestVersion > 0) {
      if (!student && !verifySecret(dto.secret, submission.secretHash))
        throw new UnauthorizedException(
          'Đã có bài nộp cho mã sinh viên này. Cần mã bí mật để nộp lại.',
        );
      if (!assignment.allowResubmit)
        throw new ForbiddenException('Bài tập không cho phép nộp lại.');
    }
    const token = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + UPLOAD_LEASE_MS);
    const locked = await this.db.submissions.findOneAndUpdate(
      {
        _id: submission._id,
        latestVersion: submission.latestVersion,
        $or: [{ lockUntil: null }, { lockUntil: { $lt: now } }],
      },
      { $set: { lockToken: token, lockUntil: expiresAt } },
      { returnDocument: 'after' },
    );
    if (!locked)
      throw new ConflictException(
        'Bài nộp này đang được xử lý. Vui lòng chờ và thử lại cùng Idempotency-Key.',
      );
    const plannedFiles = validated.map(
      (file) =>
        `${student ? `specialized/${assignment.pathId}` : `submissions/${section!.semesterId}/${section!._id}`}/${assignment._id}/${code}/${token}/${randomUUID()}.${file.format}`,
    );
    let batch: UploadBatch | undefined;
    let committed = false;
    const uploaded: StoredFile[] = [];
    try {
      if (previousBatch) {
        const updated = await this.db.batches.findOneAndUpdate(
          { _id: previousBatch._id, state: 'cleaned' },
          {
            $set: {
              state: 'processing',
              token,
              plannedFiles,
              expiresAt,
              retryAt: expiresAt,
              attempts: 0,
            },
            $unset: { failureCode: '', failureMessage: '' },
          },
          { returnDocument: 'after' },
        );
        if (!updated)
          throw new ConflictException('Yêu cầu này đang được xử lý.');
        batch = updated.toObject();
      } else {
        batch = (
          await this.db.batches.create({
            requestKey,
            fingerprint,
            submissionId: submission._id,
            state: 'processing',
            token,
            plannedFiles,
            expiresAt,
            retryAt: expiresAt,
          })
        ).toObject();
      }
      // Sequential uploads keep memory and provider concurrency bounded. Every planned ID is durable before upload.
      for (let index = 0; index < validated.length; index++)
        uploaded.push(
          await this.storage.upload(validated[index], plannedFiles[index]),
        );
      const submittedAt = new Date();
      const version = submission.latestVersion + 1;
      await this.db.connection.transaction(async (session) => {
        const current = await this.db.assignments
          .findOne({ _id: assignmentId, archived: false })
          .session(session)
          .lean();
        if (!current)
          throw new BadRequestException(
            'Bài tập đã lưu trữ trong khi tải file.',
          );
        // Use server time after upload, and recheck settings to handle closure during upload.
        assertAccepting(current, submittedAt);
        if (version > 1 && !current.allowResubmit)
          throw new ForbiddenException('Bài tập không còn cho phép nộp lại.');
        if (
          uploaded.length > current.maxFiles ||
          uploaded.some(
            (f) =>
              f.bytes > current.maxFileBytes ||
              !current.allowedExtensions.includes(f.format),
          )
        )
          throw new BadRequestException(
            'Quy định file đã thay đổi. Vui lòng kiểm tra và nộp lại.',
          );
        if (student) {
          const access = await this.db.enrollments
            .exists({
              pathId: current.pathId,
              studentId: student.id,
              lecturerId: student.lecturerId,
              active: true,
            })
            .session(session);
          const activePath = await this.db.learningPaths
            .exists({
              _id: current.pathId,
              lecturerId: student.lecturerId,
              published: true,
              archived: false,
            })
            .session(session);
          const activeStudent = await this.db.students
            .exists({
              _id: student.id,
              lecturerId: student.lecturerId,
              active: true,
              tokenVersion: student.tokenVersion,
              mustChangePassword: false,
            })
            .session(session);
          if (!access || !activePath || !activeStudent)
            throw new ForbiddenException(
              'Quyền nộp bài đã thay đổi trong khi tải file.',
            );
          await this.academic.assertStudentAssignmentPlacement(
            current,
            session,
          );
        } else {
          const activeSection = await this.db.courseSections
            .findOne({ _id: current.courseSectionId, archived: false })
            .session(session)
            .lean();
          if (!activeSection)
            throw new BadRequestException('Lớp học phần đã lưu trữ.');
          for (const [model, id] of [
            [this.db.semesters, activeSection.semesterId],
            [this.db.subjects, activeSection.subjectId],
            [this.db.classes, activeSection.classId],
          ] as const) {
            if (
              !(await model
                .exists({ _id: id, archived: false })
                .session(session))
            )
              throw new BadRequestException('Dữ liệu học tập đã lưu trữ.');
          }
        }
        const updated = await this.db.submissions.updateOne(
          {
            _id: submission._id,
            lockToken: token,
            lockUntil: { $gt: submittedAt },
            latestVersion: version - 1,
          },
          {
            $set: {
              latestVersion: version,
              fullName: dto.fullName,
              email: dto.email,
              searchName: normalizeSearch(dto.fullName),
              note: dto.note ?? '',
              submittedAt,
              late: submittedAt > current.dueAt,
            },
            $unset: { lockToken: '', lockUntil: '' },
          },
          { session },
        );
        if (updated.modifiedCount !== 1)
          throw new ConflictException(
            'Phiên xử lý đã hết hạn. Vui lòng thử lại.',
          );
        await this.db.versions.create(
          [
            {
              submissionId: submission._id,
              assignmentId,
              category: student ? 'specialized' : 'general',
              lecturerId: assignment.lecturerId,
              version,
              fullName: dto.fullName,
              email: dto.email,
              note: dto.note ?? '',
              files: uploaded,
              submittedAt,
              late: submittedAt > current.dueAt,
              requestKey,
            },
          ],
          { session },
        );
        const completed = await this.db.batches.updateOne(
          { _id: batch!._id, state: 'processing', token },
          { $set: { state: 'completed', version } },
          { session },
        );
        if (completed.modifiedCount !== 1)
          throw new ConflictException('Phiên xử lý đã hết hạn.');
      });
      committed = true;
      const saved = await this.db.submissions.findById(submission._id).lean();
      if (!saved)
        throw new ServiceUnavailableException(
          'Bài đã lưu nhưng chưa lấy được biên nhận. Thử lại cùng Idempotency-Key.',
        );
      return await this.confirmation(
        saved,
        version,
        !student && version === 1
          ? this.firstSecret(saved.receiptCode)
          : undefined,
        false,
        student,
      );
    } catch (error) {
      if (!committed && batch) {
        // A transaction commit can succeed even if the acknowledgement is lost. Never delete
        // files until a fresh database read proves the batch did not commit.
        const persisted = await this.db.batches.findById(batch._id).lean();
        if (persisted?.state === 'completed')
          return this.replay(persisted, fingerprint, dto.secret, student);
        await this.db.batches.updateOne(
          { _id: batch._id, state: 'processing', token },
          {
            $set: {
              state: 'cleanup',
              retryAt: new Date(),
              failureCode:
                error instanceof StorageUploadError
                  ? error.failureCode
                  : 'SUBMISSION_FAILED',
              failureMessage:
                error instanceof HttpException
                  ? error.message.slice(0, 500)
                  : 'Lần nộp trước gặp lỗi khi lưu dữ liệu.',
              // Only acknowledged uploads need deletion after a definitive rejection.
              // No asset exists for the rejected file or any subsequent unattempted file.
              ...(error instanceof StorageUploadError &&
              error.definitiveRejection
                ? {
                    plannedFiles: uploaded.map((file) => file.publicId),
                    expiresAt: new Date(),
                  }
                : {}),
            },
          },
        );
        await this.cleanupOne(batch._id.toString()).catch(() =>
          this.logger.warn('File chờ dọn tự động.'),
        );
      }
      throw error;
    } finally {
      await this.db.submissions
        .updateOne(
          { _id: submission._id, lockToken: token },
          { $unset: { lockToken: '', lockUntil: '' } },
        )
        .catch(() => this.logger.warn('Khóa bài nộp sẽ tự hết hạn.'));
    }
  }

  private async confirmation(
    submission: Submission,
    version: number,
    secret?: string,
    replayed = false,
    student?: StudentRequest['student'],
  ) {
    const receipt = await this.receipt(submission, version, secret, replayed);
    if (student)
      return { ...receipt, message: 'Đã lưu bài nộp mã nguồn thành công.' };
    const section = receipt.courseSection;
    const emailSent = receipt.email
      ? await this.mail.sendReceipt({
          email: receipt.email,
          fullName: receipt.fullName,
          studentCode: receipt.studentCode,
          receiptCode: receipt.receiptCode,
          secret: this.firstSecret(receipt.receiptCode),
          assignment: receipt.assignment.title,
          semester: [
            section?.semesterId?.name,
            section?.semesterId?.academicYear,
          ]
            .filter(Boolean)
            .join(' · '),
          className: section?.classId?.name ?? '',
          subject: section?.subjectId?.name ?? '',
          section: [section?.name, section?.code].filter(Boolean).join(' · '),
          version: receipt.version,
          submittedAt: receipt.submittedAt,
          late: receipt.late,
          files: receipt.files,
        })
      : false;
    return {
      ...receipt,
      emailSent,
      message: emailSent
        ? 'Đã nộp bài thành công. Hãy kiểm tra email để nhận mã xem lại bài.'
        : 'Bài đã được lưu nhưng chưa gửi được email. Hãy lưu mã biên nhận, mã bí mật hoặc thử lại cùng yêu cầu để nhận email.',
    };
  }

  private async receipt(
    submission: Submission,
    version: number,
    secret?: string,
    replayed = false,
  ) {
    const [savedVersion, assignment] = await Promise.all([
      this.db.versions
        .findOne({ submissionId: submission._id, version })
        .lean(),
      this.db.assignments
        .findById(submission.assignmentId)
        .select('title courseSectionId pathId category')
        .lean(),
    ]);
    if (!savedVersion || !assignment)
      throw new NotFoundException('Không tìm thấy biên nhận.');
    const section = assignment.courseSectionId
      ? await this.db.courseSections
          .findById(assignment.courseSectionId)
          .select('name code semesterId subjectId classId')
          .populate<{
            semesterId: { name: string; academicYear?: string } | null;
            subjectId: { name: string; code?: string } | null;
            classId: { name: string; code?: string } | null;
          }>([
            { path: 'semesterId', select: 'name academicYear' },
            { path: 'subjectId', select: 'name code' },
            { path: 'classId', select: 'name code' },
          ])
          .lean()
      : null;
    const path = assignment.pathId
      ? await this.db.learningPaths
          .findById(assignment.pathId)
          .select('title')
          .lean()
      : null;
    return {
      receiptCode: submission.receiptCode,
      submissionId: submission._id,
      studentCode: submission.studentCodeNormalized,
      fullName: savedVersion.fullName,
      email: savedVersion.email ?? null,
      note: savedVersion.note,
      assignment: { id: assignment._id, title: assignment.title },
      courseSection: section,
      ...(path ? { learningPath: { id: path._id, title: path.title } } : {}),
      version,
      latestVersion: submission.latestVersion,
      isLatest: version === submission.latestVersion,
      submittedAt: savedVersion.submittedAt,
      late: savedVersion.late,
      files: savedVersion.files.map((f) => ({
        originalName: f.originalName,
        bytes: f.bytes,
        format: f.format,
      })),
      ...(secret
        ? {
            secret,
            reminder:
              'Hãy lưu mã biên nhận và mã bí mật để tra cứu hoặc nộp lại. Giữ kín mã bí mật và Idempotency-Key.',
          }
        : {}),
      replayed,
      identityNotice:
        submission.category === 'specialized'
          ? 'Thông tin sinh viên từ tài khoản được giảng viên cấp.'
          : 'Thông tin sinh viên do người nộp tự khai; hệ thống không xác minh danh tính.',
    };
  }
  async lookup(dto: LookupReceiptDto) {
    const submission = await this.db.submissions
      .findOne({
        receiptCode: dto.receiptCode,
        latestVersion: { $gt: 0 },
        category: { $ne: 'specialized' },
      })
      .select('+secretHash')
      .lean();
    if (!submission || !verifySecret(dto.secret, submission.secretHash))
      throw new UnauthorizedException(
        'Mã biên nhận hoặc mã bí mật không chính xác.',
      );
    const versions = await this.db.versions
      .find({ submissionId: submission._id })
      .sort({ version: -1 })
      .lean();
    return {
      ...(await this.receipt(submission, submission.latestVersion)),
      versions: versions.map((v) => ({
        version: v.version,
        isLatest: v.version === submission.latestVersion,
        fullName: v.fullName,
        email: v.email ?? null,
        note: v.note,
        submittedAt: v.submittedAt,
        late: v.late,
        files: v.files.map((f) => ({
          originalName: f.originalName,
          bytes: f.bytes,
          format: f.format,
        })),
      })),
    };
  }
  async list(
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
      latestVersion: { $gt: 0 },
      ...(q.assignmentId ? { assignmentId: q.assignmentId } : {}),
      ...(q.courseSectionId ? { courseSectionId: q.courseSectionId } : {}),
      ...(q.pathId ? { pathId: q.pathId } : {}),
      ...(q.search
        ? {
            $or: [
              { studentCodeNormalized: new RegExp(escapeRegex(q.search), 'i') },
              {
                searchName: new RegExp(
                  escapeRegex(normalizeSearch(q.search)),
                  'i',
                ),
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.submissions
        .find(filter)
        .sort({ submittedAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.db.submissions.countDocuments(filter),
    ]);
    const versions = await this.db.versions
      .find({ submissionId: { $in: items.map((s) => s._id) } })
      .select('submissionId version files')
      .lean();
    return {
      items: items.map((s) => ({
        ...s,
        files:
          versions
            .find(
              (v) =>
                v.submissionId.equals(s._id) && v.version === s.latestVersion,
            )
            ?.files.map((f, fileIndex) => ({
              originalName: f.originalName,
              bytes: f.bytes,
              format: f.format,
              downloadPath: `/api/lecturer/submissions/${s._id}/file?version=${s.latestVersion}&fileIndex=${fileIndex}`,
            })) ?? [],
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }
  async receiptFile(dto: ReceiptFileDto, res: Response) {
    const submission = await this.db.submissions
      .findOne({
        receiptCode: dto.receiptCode,
        latestVersion: { $gt: 0 },
        category: { $ne: 'specialized' },
      })
      .select('+secretHash')
      .lean();
    if (!submission || !verifySecret(dto.secret, submission.secretHash))
      throw new UnauthorizedException(
        'Mã biên nhận hoặc mã bí mật không chính xác.',
      );
    return this.file(
      submission.lecturerId.toString(),
      submission._id.toString(),
      dto.version,
      dto.fileIndex,
      res,
    );
  }
  async studentSubmission(
    assignmentId: string,
    student: StudentRequest['student'],
  ) {
    await this.academic.studentAssignment(assignmentId, student);
    const submission = await this.db.submissions
      .findOne({
        assignmentId,
        studentId: student.id,
        category: 'specialized',
        latestVersion: { $gt: 0 },
      })
      .lean();
    if (!submission) return null;
    const detail = await this.detail(
      student.lecturerId,
      submission._id.toString(),
    );
    return {
      ...detail,
      versions: detail.versions.map((v) => ({
        ...v,
        files: v.files.map((file, index) => ({
          ...file,
          downloadPath: `/api/student/submissions/${submission._id}/file?version=${v.version}&fileIndex=${index}`,
        })),
      })),
    };
  }
  async studentFile(
    id: string,
    student: StudentRequest['student'],
    version: number,
    fileIndex: number,
    res: Response,
  ) {
    const submission = await this.db.submissions
      .findOne({
        _id: id,
        studentId: student.id,
        lecturerId: student.lecturerId,
        category: 'specialized',
        latestVersion: { $gt: 0 },
      })
      .lean();
    if (!submission)
      throw new NotFoundException('Không tìm thấy bài nộp của bạn.');
    await this.academic.studentAssignment(
      submission.assignmentId.toString(),
      student,
    );
    return this.file(student.lecturerId, id, version, fileIndex, res);
  }
  async detail(lecturerId: string, id: string) {
    const submission = await this.db.submissions
      .findOne({ _id: id, lecturerId, latestVersion: { $gt: 0 } })
      .lean();
    if (!submission) throw new NotFoundException('Không tìm thấy bài nộp.');
    const versions = await this.db.versions
      .find({ submissionId: id, lecturerId })
      .sort({ version: -1 })
      .lean();
    return {
      ...submission,
      versions: versions.map((v) => ({
        ...v,
        isLatest: v.version === submission.latestVersion,
        files: v.files.map((f, fileIndex) => ({
          originalName: f.originalName,
          bytes: f.bytes,
          format: f.format,
          uploadedAt: f.uploadedAt,
          downloadPath: `/api/lecturer/submissions/${id}/file?version=${v.version}&fileIndex=${fileIndex}`,
        })),
      })),
    };
  }
  async file(
    lecturerId: string,
    id: string,
    version: number,
    fileIndex: number,
    res: Response,
  ) {
    const saved = await this.db.versions
      .findOne({ submissionId: id, lecturerId, version })
      .lean();
    const file = saved?.files[fileIndex];
    if (!file) throw new NotFoundException('Không tìm thấy file.');
    const stream = await this.storage.download(file);
    res.attachment(file.originalName).type('application/octet-stream');
    res.setHeader('Content-Length', file.bytes);
    await pipeline(stream, res);
  }
  async zip(lecturerId: string, assignmentId: string, res: Response) {
    await this.academic.ownedAssignment(assignmentId, lecturerId);
    const submissions = this.db.submissions
      .find({ lecturerId, assignmentId, latestVersion: { $gt: 0 } })
      .sort({ studentCodeNormalized: 1 })
      .lean()
      .cursor();
    const archive = new ZipArchive({ zlib: { level: 1 } });
    res.attachment(`bai-nop-${assignmentId}.zip`).type('application/zip');
    const completion = pipeline(archive, res);
    // Attach a handler immediately so a client disconnect never causes an unhandled rejection.
    void completion.catch(() => archive.abort());
    const streams = new Set<import('node:stream').Readable>();
    const onClose = () => {
      archive.abort();
      for (const stream of streams) stream.destroy();
      void submissions.close();
    };
    res.once('close', onClose);
    try {
      for await (const submission of submissions) {
        if (res.destroyed) break;
        const latest = await this.db.versions
          .findOne({
            submissionId: submission._id,
            version: submission.latestVersion,
          })
          .lean();
        if (!latest) continue;
        for (const [index, file] of latest.files.entries()) {
          const stream = await this.storage.download(file);
          streams.add(stream);
          stream.once('close', () => streams.delete(stream));
          const consumed = new Promise<void>((resolve, reject) => {
            stream.once('end', resolve);
            stream.once('error', reject);
            stream.once('close', resolve);
          });
          archive.append(stream, {
            name: `${safeFilename(submission.studentCodeNormalized)}/v${latest.version}/${index + 1}-${safeFilename(file.originalName)}`,
          });
          await consumed;
        }
      }
      await archive.finalize();
      await completion;
    } catch (error) {
      archive.abort();
      for (const stream of streams) stream.destroy();
      res.destroy();
      throw error;
    } finally {
      res.off('close', onClose);
      await submissions.close();
    }
  }
  async excel(lecturerId: string, assignmentId: string, res: Response) {
    const assignment = await this.academic.ownedAssignment(
      assignmentId,
      lecturerId,
    );
    res
      .attachment(`danh-sach-${assignmentId}.xlsx`)
      .type(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
    const sheet = workbook.addWorksheet('Bài đã nộp');
    sheet.columns = [
      { header: 'Mã biên nhận', key: 'receipt', width: 38 },
      { header: 'Mã sinh viên', key: 'code', width: 20 },
      { header: 'Họ và tên', key: 'name', width: 30 },
      { header: 'Email', key: 'email', width: 35 },
      { header: 'Bài tập', key: 'title', width: 35 },
      { header: 'Thời gian (Việt Nam)', key: 'time', width: 25 },
      { header: 'Trạng thái', key: 'status', width: 18 },
      { header: 'Phiên bản', key: 'version', width: 12 },
      { header: 'File', key: 'files', width: 60 },
      { header: 'Ghi chú', key: 'note', width: 35 },
    ];
    const cursor = this.db.submissions
      .find({ lecturerId, assignmentId, latestVersion: { $gt: 0 } })
      .sort({ studentCodeNormalized: 1 })
      .lean()
      .cursor();
    try {
      for await (const submission of cursor) {
        if (res.destroyed) break;
        const latest = await this.db.versions
          .findOne({
            submissionId: submission._id,
            version: submission.latestVersion,
          })
          .lean();
        sheet
          .addRow({
            receipt: submission.receiptCode,
            code: submission.studentCodeNormalized,
            name: submission.fullName,
            email: submission.email ?? '',
            title: assignment.title,
            time: submission.submittedAt
              ? new Intl.DateTimeFormat('vi-VN', {
                  timeZone: 'Asia/Ho_Chi_Minh',
                  dateStyle: 'short',
                  timeStyle: 'medium',
                }).format(submission.submittedAt)
              : '',
            status: submission.late ? 'Trễ hạn' : 'Đúng hạn',
            version: submission.latestVersion,
            files: latest?.files.map((f) => f.originalName).join('\n') ?? '',
            note: submission.note,
          })
          .commit();
      }
      sheet.commit();
      await workbook.commit();
    } finally {
      await cursor.close();
    }
  }
  async runCleanup() {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      const now = new Date();
      await this.db.batches.updateMany(
        { state: 'processing', expiresAt: { $lt: now } },
        { $set: { state: 'cleanup', retryAt: now } },
      );
      const pending = await this.db.batches
        .find({ state: 'cleanup', retryAt: { $lte: now } })
        .limit(20)
        .lean();
      for (const batch of pending) await this.cleanupOne(batch._id.toString());
    } finally {
      this.cleaning = false;
    }
  }
  private async cleanupOne(id: string) {
    const now = new Date();
    const batch = await this.db.batches
      .findOneAndUpdate(
        { _id: id, state: 'cleanup', retryAt: { $lte: now } },
        {
          $set: { retryAt: new Date(now.getTime() + UPLOAD_LEASE_MS) },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean();
    if (!batch) return;
    // Defensive check: versions always win over cleanup, even after an ambiguous transaction result.
    const committed = await this.db.versions
      .findOne({ requestKey: batch.requestKey })
      .select('version')
      .lean();
    if (committed) {
      await this.db.batches.updateOne(
        { _id: id },
        { $set: { state: 'completed', version: committed.version } },
      );
      return;
    }
    const results = await Promise.allSettled(
      batch.plannedFiles.map((publicId) => this.storage.destroy(publicId)),
    );
    if (results.every((r) => r.status === 'fulfilled')) {
      // An upload with a lost response can finish remotely after an initial "not found" delete.
      // Verify deletion again after the upload lease before retiring the durable cleanup record.
      if (batch.expiresAt > now)
        await this.db.batches.updateOne(
          { _id: id, state: 'cleanup' },
          { $set: { retryAt: batch.expiresAt } },
        );
      else
        await this.db.batches.updateOne(
          { _id: id, state: 'cleanup' },
          { $set: { state: 'cleaned', plannedFiles: [] } },
        );
    } else {
      await this.db.batches.updateOne(
        { _id: id, state: 'cleanup' },
        {
          $set: {
            retryAt: new Date(
              Date.now() +
                Math.min(3600000, 30000 * 2 ** Math.min(batch.attempts, 7)),
            ),
          },
        },
      );
      this.logger.warn('Dọn file chưa hoàn tất; đã lên lịch thử lại.');
    }
  }
}
