import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, MongooseModule } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { setServers } from 'node:dns';
import * as S from './schemas.js';
import * as L from '../learning/learning.schemas.js';

@Injectable()
export class Database implements OnModuleInit {
  readonly lecturers: Model<S.Lecturer>;
  readonly semesters: Model<S.CatalogEntity>;
  readonly subjects: Model<S.CatalogEntity>;
  readonly classes: Model<S.CatalogEntity>;
  readonly courseSections: Model<S.CourseSection>;
  readonly assignments: Model<S.Assignment>;
  readonly submissions: Model<S.Submission>;
  readonly versions: Model<S.SubmissionVersion>;
  readonly batches: Model<S.UploadBatch>;
  readonly students: Model<L.Student>;
  readonly learningPaths: Model<L.LearningPath>;
  readonly learningModules: Model<L.LearningModule>;
  readonly lessons: Model<L.Lesson>;
  readonly enrollments: Model<L.Enrollment>;
  readonly lessonProgress: Model<L.LessonProgress>;
  readonly lessonFileCleanup: Model<L.LessonFileCleanup>;

  constructor(@InjectConnection() readonly connection: Connection) {
    this.lecturers = connection.model<S.Lecturer>('Lecturer', S.LecturerSchema);
    this.semesters = connection.model<S.CatalogEntity>(
      'Semester',
      S.SemesterSchema,
    );
    this.subjects = connection.model<S.CatalogEntity>(
      'Subject',
      S.SubjectSchema,
    );
    this.classes = connection.model<S.CatalogEntity>('Class', S.ClassSchema);
    this.courseSections = connection.model<S.CourseSection>(
      'CourseSection',
      S.CourseSectionSchema,
    );
    this.assignments = connection.model<S.Assignment>(
      'Assignment',
      S.AssignmentSchema,
    );
    this.submissions = connection.model<S.Submission>(
      'Submission',
      S.SubmissionSchema,
    );
    this.versions = connection.model<S.SubmissionVersion>(
      'SubmissionVersion',
      S.SubmissionVersionSchema,
    );
    this.batches = connection.model<S.UploadBatch>(
      'UploadBatch',
      S.UploadBatchSchema,
    );
    this.students = connection.model<L.Student>('Student', L.StudentSchema);
    this.learningPaths = connection.model<L.LearningPath>(
      'LearningPath',
      L.LearningPathSchema,
    );
    this.learningModules = connection.model<L.LearningModule>(
      'LearningModule',
      L.LearningModuleSchema,
    );
    this.lessons = connection.model<L.Lesson>('Lesson', L.LessonSchema);
    this.lessonFileCleanup = connection.model<L.LessonFileCleanup>(
      'LessonFileCleanup',
      L.LessonFileCleanupSchema,
    );
    this.enrollments = connection.model<L.Enrollment>(
      'Enrollment',
      L.EnrollmentSchema,
    );
    this.lessonProgress = connection.model<L.LessonProgress>(
      'LessonProgress',
      L.LessonProgressSchema,
    );
  }

  async onModuleInit() {
    // Unique indexes must exist before accepting concurrent uploads.
    await Promise.all(
      [
        this.lecturers,
        this.semesters,
        this.subjects,
        this.classes,
        this.courseSections,
        this.assignments,
        this.submissions,
        this.versions,
        this.batches,
        this.students,
        this.learningPaths,
        this.learningModules,
        this.lessons,
        this.lessonFileCleanup,
        this.enrollments,
        this.lessonProgress,
      ].map((model) => model.init()),
    );
  }
}

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dnsServers = config.get<string>('DNS_SERVERS');
        // Apply before the MongoDB driver starts its SRV/TXT lookups.
        // This affects this Node.js process, without changing the OS DNS settings.
        if (dnsServers) setServers(dnsServers.split(','));
        return {
          uri: config.getOrThrow<string>('MONGODB_URI'),
          serverSelectionTimeoutMS: 10000,
          connectTimeoutMS: 10000,
          retryAttempts: 2,
          retryDelay: 1000,
          autoIndex: true,
        };
      },
    }),
  ],
  providers: [Database],
  exports: [Database],
})
export class DatabaseModule {}
