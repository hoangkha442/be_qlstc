import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Types } from 'mongoose';
import type { PipelineStage } from 'mongoose';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { LecturerGuard } from '../auth/auth.module.js';
import type { LecturerRequest } from '../auth/auth.module.js';
import { Database } from '../database/database.module.js';
import { escapeRegex } from '../academic/academic.service.js';
import { assignmentStatus } from '../academic/assignment-policy.js';
import { normalizeSearch, normalizeStudentCode } from '../config.js';
import {
  SubmissionSummaryQuery,
  SubmissionSummaryScope,
} from './submission-summary.dto.js';

interface SummaryRow {
  studentCode: string;
  fullName: string;
  email: string | null;
  lastSubmittedAt: Date;
  submittedAssignments: number;
  totalAssignments: number;
  missingAssignments: number;
  overdueAssignments: number;
  completionRate: number | null;
}
const coverageNotice =
  'Danh sách gồm MSSV đã từng nộp bài trong phạm vi được chọn. Chưa có danh sách lớp để xác định sinh viên chưa nộp lần nào.';

@Injectable()
export class SubmissionSummaryService {
  constructor(private readonly db: Database) {}
  private async scope(lecturerId: string, q: SubmissionSummaryScope) {
    const classroom = await this.db.classes
      .findOne({ _id: q.classId, lecturerId })
      .select('name code archived')
      .lean();
    if (!classroom)
      throw new NotFoundException('Không tìm thấy lớp thuộc quyền quản lý.');
    const semester = q.semesterId
      ? await this.db.semesters
          .findOne({ _id: q.semesterId, lecturerId })
          .select('name academicYear archived')
          .lean()
      : null;
    if (q.semesterId && !semester)
      throw new NotFoundException('Không tìm thấy học kỳ thuộc quyền quản lý.');
    const sections = await this.db.courseSections
      .find({
        lecturerId,
        classId: q.classId,
        ...(q.semesterId ? { semesterId: q.semesterId } : {}),
        ...(q.courseSectionId ? { _id: q.courseSectionId } : {}),
      })
      .select('name code archived semesterId')
      .sort({ code: 1, _id: 1 })
      .lean();
    if (q.courseSectionId && !sections.length)
      throw new BadRequestException(
        'Học phần không thuộc lớp hoặc học kỳ đã chọn.',
      );
    const assignments = await this.db.assignments
      .find({
        lecturerId,
        category: { $ne: 'specialized' },
        courseSectionId: { $in: sections.map((section) => section._id) },
        ...(q.includeArchived === 'true' ? {} : { archived: false }),
      })
      .select(
        'title courseSectionId opensAt dueAt archived manuallyClosed allowLate',
      )
      .sort({ dueAt: 1, _id: 1 })
      .lean();
    const now = new Date();
    return {
      classroom,
      semester,
      sections,
      assignments,
      now,
      lecturerId,
      includeArchived: q.includeArchived === 'true',
    };
  }
  private view(scope: Awaited<ReturnType<SubmissionSummaryService['scope']>>) {
    return {
      classroom: scope.classroom,
      semester: scope.semester,
      courseSections: scope.sections,
      totalAssignments: scope.assignments.length,
      scheduledAssignments: scope.assignments.filter(
        (assignment) => assignment.opensAt > scope.now,
      ).length,
      includeArchived: scope.includeArchived,
      generatedAt: scope.now,
      coverageNotice,
    };
  }
  private rows(
    scope: Awaited<ReturnType<SubmissionSummaryService['scope']>>,
    studentCode?: string,
  ): PipelineStage[] {
    const ids = scope.assignments.map((assignment) => assignment._id);
    const overdue = scope.assignments
      .filter((assignment) => assignment.dueAt < scope.now)
      .map((assignment) => assignment._id);
    const total = ids.length;
    return [
      {
        $match: {
          lecturerId: new Types.ObjectId(scope.lecturerId),
          category: { $ne: 'specialized' },
          courseSectionId: {
            $in: scope.sections.map((section) => section._id),
          },
          latestVersion: { $gt: 0 },
          ...(studentCode ? { studentCodeNormalized: studentCode } : {}),
        },
      },
      { $sort: { submittedAt: -1, _id: -1 } },
      {
        $group: {
          _id: '$studentCodeNormalized',
          fullName: { $first: '$fullName' },
          email: { $first: { $ifNull: ['$email', null] } },
          searchName: { $first: '$searchName' },
          lastSubmittedAt: { $first: '$submittedAt' },
          assignmentIds: { $addToSet: '$assignmentId' },
        },
      },
      {
        $set: {
          studentCode: '$_id',
          totalAssignments: { $literal: total },
          submittedAssignments: {
            $size: { $setIntersection: ['$assignmentIds', ids] },
          },
          overdueAssignments: {
            $size: { $setDifference: [overdue, '$assignmentIds'] },
          },
        },
      },
      {
        $set: {
          missingAssignments: { $subtract: [total, '$submittedAssignments'] },
          completionRate: total
            ? { $divide: ['$submittedAssignments', total] }
            : null,
        },
      },
      { $project: { _id: 0, assignmentIds: 0 } },
    ];
  }
  private filters(q: SubmissionSummaryQuery): PipelineStage.Match[] {
    const clauses: Record<string, unknown>[] = [];
    if (q.search) {
      const literal = new RegExp(escapeRegex(q.search), 'i');
      clauses.push({
        $or: [
          { studentCode: literal },
          { fullName: literal },
          { email: literal },
          {
            searchName: new RegExp(escapeRegex(normalizeSearch(q.search)), 'i'),
          },
        ],
      });
    }
    if (q.status === 'complete')
      clauses.push({ totalAssignments: { $gt: 0 }, missingAssignments: 0 });
    if (q.status === 'incomplete')
      clauses.push({ missingAssignments: { $gt: 0 } });
    return clauses.length ? [{ $match: { $and: clauses } }] : [];
  }
  async list(lecturerId: string, q: SubmissionSummaryQuery) {
    const scope = await this.scope(lecturerId, q),
      filters = this.filters(q);
    const [result] = await this.db.submissions
      .aggregate<{
        items: SummaryRow[];
        total: { count: number }[];
        overview: {
          observedStudents: number;
          completedStudents: number;
          incompleteStudents: number;
          submittedAssignments: number;
        }[];
      }>([
        ...this.rows(scope),
        {
          $facet: {
            items: [
              ...filters,
              { $sort: { studentCode: 1 } },
              { $skip: (q.page - 1) * q.limit },
              { $limit: q.limit },
              { $project: { searchName: 0 } },
            ],
            total: [...filters, { $count: 'count' }],
            overview: [
              {
                $group: {
                  _id: null,
                  observedStudents: { $sum: 1 },
                  completedStudents: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gt: ['$totalAssignments', 0] },
                            { $eq: ['$missingAssignments', 0] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  incompleteStudents: {
                    $sum: {
                      $cond: [{ $gt: ['$missingAssignments', 0] }, 1, 0],
                    },
                  },
                  submittedAssignments: { $sum: '$submittedAssignments' },
                },
              },
              { $project: { _id: 0 } },
            ],
          },
        },
      ])
      .option({ maxTimeMS: 30000, allowDiskUse: true });
    return {
      ...this.view(scope),
      items: result?.items ?? [],
      total: result?.total[0]?.count ?? 0,
      page: q.page,
      limit: q.limit,
      overview: result?.overview[0] ?? {
        observedStudents: 0,
        completedStudents: 0,
        incompleteStudents: 0,
        submittedAssignments: 0,
      },
    };
  }
  async student(lecturerId: string, code: string, q: SubmissionSummaryScope) {
    const studentCode = normalizeStudentCode(code),
      scope = await this.scope(lecturerId, q);
    const [student] = await this.db.submissions
      .aggregate<SummaryRow>([
        ...this.rows(scope, studentCode),
        { $project: { searchName: 0 } },
      ])
      .option({ maxTimeMS: 30000 });
    if (!student)
      throw new NotFoundException(
        'MSSV chưa có bài nộp trong phạm vi được chọn.',
      );
    const submissions = await this.db.submissions
      .find({
        lecturerId,
        category: { $ne: 'specialized' },
        studentCodeNormalized: studentCode,
        assignmentId: {
          $in: scope.assignments.map((assignment) => assignment._id),
        },
        latestVersion: { $gt: 0 },
      })
      .select('_id assignmentId submittedAt latestVersion late')
      .lean();
    const byAssignment = new Map(
      submissions.map((submission) => [
        submission.assignmentId.toString(),
        submission,
      ]),
    );
    return {
      ...this.view(scope),
      student,
      assignments: scope.assignments.map((assignment) => {
        const submission = byAssignment.get(assignment._id.toString());
        return {
          id: assignment._id,
          title: assignment.title,
          courseSectionId: assignment.courseSectionId,
          courseSectionCode:
            scope.sections.find((section) =>
              section._id.equals(assignment.courseSectionId),
            )?.code ?? '',
          opensAt: assignment.opensAt,
          dueAt: assignment.dueAt,
          archived: assignment.archived,
          status: assignmentStatus(assignment, scope.now),
          overdue: !submission && assignment.dueAt < scope.now,
          submission: submission
            ? {
                id: submission._id,
                version: submission.latestVersion,
                submittedAt: submission.submittedAt,
                late: submission.late,
              }
            : null,
        };
      }),
    };
  }
  async excel(lecturerId: string, q: SubmissionSummaryQuery, res: Response) {
    const scope = await this.scope(lecturerId, q);
    const cursor = this.db.submissions
      .aggregate<SummaryRow>([
        ...this.rows(scope),
        ...this.filters(q),
        { $sort: { studentCode: 1 } },
        { $project: { searchName: 0 } },
      ])
      .option({ maxTimeMS: 60000, allowDiskUse: true })
      .cursor({ batchSize: 100 });
    res
      .attachment(`tong-hop-${q.classId}.xlsx`)
      .type(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: true,
    });
    const context = workbook.addWorksheet('Phạm vi');
    context.columns = [{ width: 30 }, { width: 100 }];
    for (const row of [
      ['Lớp', `${scope.classroom.code} · ${scope.classroom.name}`],
      [
        'Học kỳ',
        scope.semester
          ? `${scope.semester.name} · ${scope.semester.academicYear}`
          : 'Tất cả học kỳ',
      ],
      ['Học phần', scope.sections.map((section) => section.code).join(', ')],
      ['Tổng bài tập', scope.assignments.length],
      ['Gồm bài tập lưu trữ', scope.includeArchived ? 'Có' : 'Không'],
      [
        'Lọc sinh viên',
        q.status === 'complete'
          ? 'Đã nộp đủ'
          : q.status === 'incomplete'
            ? 'Còn thiếu bài'
            : 'Tất cả',
      ],
      ['Tìm kiếm', q.search ?? ''],
      ['Ghi chú', coverageNotice],
      [
        'Cách tính',
        'Mỗi bài tập tính một lần, gồm bài chưa mở. Nộp lại không tăng số bài đã nộp.',
      ],
      [
        'Thời điểm tổng hợp',
        scope.now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      ],
    ])
      context.addRow(row).commit();
    context.commit();
    const sheet = workbook.addWorksheet('Tổng hợp sinh viên', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = [
      { header: 'MSSV', key: 'studentCode', width: 22 },
      { header: 'Họ tên', key: 'fullName', width: 35 },
      { header: 'Email', key: 'email', width: 38 },
      { header: 'Bài đã nộp', key: 'submittedAssignments', width: 16 },
      { header: 'Tổng bài tập', key: 'totalAssignments', width: 16 },
      { header: 'Chưa nộp', key: 'missingAssignments', width: 16 },
      { header: 'Quá hạn chưa nộp', key: 'overdueAssignments', width: 23 },
      {
        header: 'Tỷ lệ nộp',
        key: 'completionRate',
        width: 16,
        style: { numFmt: '0.0%' },
      },
      { header: 'Lần nộp cuối (VN)', key: 'lastSubmittedAt', width: 28 },
    ];
    try {
      for await (const row of cursor) {
        if (res.destroyed) break;
        sheet
          .addRow({
            ...row,
            email: row.email ?? '',
            completionRate: row.completionRate ?? '',
            lastSubmittedAt:
              row.lastSubmittedAt?.toLocaleString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
              }) ?? '',
          })
          .commit();
      }
      sheet.commit();
      await workbook.commit();
    } finally {
      await cursor.close();
    }
  }
}

@ApiTags('Tổng hợp nộp bài theo lớp')
@ApiBearerAuth()
@UseGuards(LecturerGuard)
@Controller('lecturer/submission-summary')
export class SubmissionSummaryController {
  constructor(private readonly service: SubmissionSummaryService) {}
  @Get() list(
    @Req() req: LecturerRequest,
    @Query() query: SubmissionSummaryQuery,
  ) {
    return this.service.list(req.lecturer.id, query);
  }
  @Get('export.xlsx')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  excel(
    @Req() req: LecturerRequest,
    @Query() query: SubmissionSummaryQuery,
    @Res() res: Response,
  ) {
    return this.service.excel(req.lecturer.id, query, res);
  }
  @Get('students/:studentCode')
  student(
    @Req() req: LecturerRequest,
    @Param('studentCode') code: string,
    @Query() query: SubmissionSummaryScope,
  ) {
    return this.service.student(req.lecturer.id, code, query);
  }
}
