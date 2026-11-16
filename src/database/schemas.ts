import { Schema, Types } from 'mongoose';
import {
  SYSTEM_MAX_FILES,
  MAX_SUBMISSION_EXTENSIONS,
  SUBMISSION_EXTENSION_PATTERN,
  normalizeSubmissionExtensions,
} from '../config.js';

export interface BaseEntity {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
export interface Lecturer extends BaseEntity {
  email: string;
  fullName: string;
  passwordHash: string;
  active: boolean;
}
export interface CatalogEntity extends BaseEntity {
  lecturerId: Types.ObjectId;
  name: string;
  code?: string;
  academicYear?: string;
  archived: boolean;
}
export interface CourseSection extends CatalogEntity {
  semesterId: Types.ObjectId;
  subjectId: Types.ObjectId;
  classId: Types.ObjectId;
}
export interface Assignment extends BaseEntity {
  lecturerId: Types.ObjectId;
  category: 'general' | 'specialized';
  courseSectionId?: Types.ObjectId;
  pathId?: Types.ObjectId;
  moduleId?: Types.ObjectId;
  lessonId?: Types.ObjectId;
  title: string;
  instructions: string;
  opensAt: Date;
  dueAt: Date;
  manuallyClosed: boolean;
  allowLate: boolean;
  allowResubmit: boolean;
  allowedExtensions: string[];
  maxFiles: number;
  maxFileBytes: number;
  archived: boolean;
}
export interface StoredFile {
  originalName: string;
  publicId: string;
  resourceType: 'raw';
  deliveryType: 'private';
  secureUrl: string;
  format: string;
  bytes: number;
  uploadedAt: Date;
}
export interface Submission extends BaseEntity {
  assignmentId: Types.ObjectId;
  category: 'general' | 'specialized';
  courseSectionId?: Types.ObjectId;
  pathId?: Types.ObjectId;
  studentId?: Types.ObjectId;
  lecturerId: Types.ObjectId;
  studentCodeNormalized: string;
  fullName: string;
  email?: string;
  searchName: string;
  note: string;
  receiptCode: string;
  secretHash: string;
  latestVersion: number;
  submittedAt?: Date;
  late: boolean;
  lockToken?: string | null;
  lockUntil?: Date | null;
}
export interface SubmissionGrade {
  score: number;
  feedback: string;
  gradedAt: Date;
  gradedBy: Types.ObjectId;
  revision: number;
}
export interface SubmissionVersion extends BaseEntity {
  category: 'general' | 'specialized';
  submissionId: Types.ObjectId;
  assignmentId: Types.ObjectId;
  lecturerId: Types.ObjectId;
  version: number;
  fullName: string;
  email?: string;
  note: string;
  submittedAt: Date;
  late: boolean;
  files: StoredFile[];
  requestKey: string;
  grade?: SubmissionGrade;
}
export interface UploadBatch extends BaseEntity {
  requestKey: string;
  fingerprint: string;
  submissionId: Types.ObjectId;
  state: 'processing' | 'completed' | 'cleanup' | 'cleaned';
  token: string;
  plannedFiles: string[];
  version?: number;
  expiresAt: Date;
  retryAt: Date;
  attempts: number;
  failureCode?: string;
  failureMessage?: string;
}

const options = { timestamps: true, versionKey: false } as const;
const objectId = (ref: string) => ({
  type: Schema.Types.ObjectId,
  ref,
  required: true,
  index: true,
});
const text = { type: String, required: true, trim: true, maxlength: 200 };
const owned = {
  lecturerId: objectId('Lecturer'),
  archived: { type: Boolean, default: false, index: true },
};
export const LecturerSchema = new Schema<Lecturer>(
  {
    email: { ...text, lowercase: true, unique: true },
    fullName: text,
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
  },
  { ...options, collection: 'lecturers' },
);
export const SemesterSchema = new Schema<CatalogEntity>(
  {
    ...owned,
    name: text,
    academicYear: { ...text, match: /^\d{4}-\d{4}$/ },
  },
  { ...options, collection: 'semesters' },
);
SemesterSchema.index(
  { lecturerId: 1, name: 1, academicYear: 1 },
  { unique: true },
);
export const SubjectSchema = new Schema<CatalogEntity>(
  { ...owned, name: text, code: { ...text, uppercase: true, maxlength: 80 } },
  { ...options, collection: 'subjects' },
);
SubjectSchema.index({ lecturerId: 1, code: 1 }, { unique: true });
export const ClassSchema = new Schema<CatalogEntity>(
  { ...owned, name: text, code: { ...text, uppercase: true, maxlength: 80 } },
  { ...options, collection: 'classes' },
);
ClassSchema.index({ lecturerId: 1, code: 1 }, { unique: true });
export const CourseSectionSchema = new Schema<CourseSection>(
  {
    ...owned,
    name: text,
    code: { ...text, uppercase: true, maxlength: 80 },
    semesterId: objectId('Semester'),
    subjectId: objectId('Subject'),
    classId: objectId('Class'),
  },
  { ...options, collection: 'courseSections' },
);
CourseSectionSchema.index({ lecturerId: 1, code: 1 }, { unique: true });
CourseSectionSchema.index({ semesterId: 1, classId: 1, archived: 1 });
export const AssignmentSchema: Schema<Assignment> = new Schema<Assignment>(
  {
    ...owned,
    category: {
      type: String,
      enum: ['general', 'specialized'],
      default: 'general',
      immutable: true,
    },
    courseSectionId: {
      ...objectId('CourseSection'),
      required: function (this: Assignment) {
        return this.category !== 'specialized';
      },
    },
    pathId: {
      ...objectId('LearningPath'),
      required: function (this: Assignment) {
        return this.category === 'specialized';
      },
      immutable: true,
    },
    title: text,
    instructions: { type: String, default: '', maxlength: 20000 },
    moduleId: { ...objectId('LearningModule'), required: false },
    lessonId: { ...objectId('Lesson'), required: false },
    opensAt: { type: Date, required: true },
    dueAt: { type: Date, required: true },
    manuallyClosed: { type: Boolean, default: false },
    allowLate: { type: Boolean, default: false },
    allowResubmit: { type: Boolean, default: false },
    allowedExtensions: {
      type: [String],
      required: true,
      default: undefined,
      set: normalizeSubmissionExtensions,
      validate: {
        validator: (v: string[]) =>
          v.length > 0 &&
          v.length <= MAX_SUBMISSION_EXTENSIONS &&
          new Set(v).size === v.length &&
          v.every((s) => SUBMISSION_EXTENSION_PATTERN.test(s)),
      },
    },
    maxFiles: {
      type: Number,
      default: SYSTEM_MAX_FILES,
      min: 1,
      max: SYSTEM_MAX_FILES,
    },
    maxFileBytes: { type: Number, default: 10485760, min: 1, max: 10485760 },
  },
  { ...options, collection: 'assignments' },
);
AssignmentSchema.index({ lecturerId: 1, courseSectionId: 1, archived: 1 });
AssignmentSchema.index({ lecturerId: 1, pathId: 1, archived: 1 });
AssignmentSchema.index({
  lecturerId: 1,
  pathId: 1,
  moduleId: 1,
  lessonId: 1,
  archived: 1,
});
const FileSchema = new Schema<StoredFile>(
  {
    originalName: { ...text, maxlength: 255 },
    publicId: { type: String, required: true },
    resourceType: { type: String, enum: ['raw'], required: true },
    deliveryType: { type: String, enum: ['private'], required: true },
    secureUrl: { type: String, required: true },
    format: { type: String, required: true },
    bytes: { type: Number, required: true, min: 1 },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);
export const SubmissionSchema = new Schema<Submission>(
  {
    assignmentId: objectId('Assignment'),
    category: {
      type: String,
      enum: ['general', 'specialized'],
      default: 'general',
    },
    courseSectionId: { ...objectId('CourseSection'), required: false },
    pathId: { ...objectId('LearningPath'), required: false },
    studentId: { ...objectId('Student'), required: false },
    lecturerId: objectId('Lecturer'),
    studentCodeNormalized: { ...text, maxlength: 40 },
    fullName: text,
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    searchName: { type: String, index: true },
    note: { type: String, default: '', maxlength: 2000 },
    receiptCode: { type: String, required: true, unique: true },
    secretHash: { type: String, required: true, select: false },
    latestVersion: { type: Number, default: 0 },
    submittedAt: Date,
    late: { type: Boolean, default: false },
    lockToken: { type: String, select: false },
    lockUntil: { type: Date, select: false },
  },
  { ...options, collection: 'submissions' },
);
SubmissionSchema.index(
  { assignmentId: 1, studentCodeNormalized: 1 },
  { unique: true },
);
SubmissionSchema.index({ lecturerId: 1, assignmentId: 1, submittedAt: -1 });
SubmissionSchema.index(
  { assignmentId: 1, studentId: 1 },
  {
    unique: true,
    partialFilterExpression: { studentId: { $type: 'objectId' } },
  },
);
const SubmissionGradeSchema = new Schema<SubmissionGrade>(
  {
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 10,
      validate: (value: number) =>
        Number.isFinite(value) &&
        Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
    },
    feedback: { type: String, default: '', maxlength: 5000 },
    gradedAt: { type: Date, required: true },
    gradedBy: { type: Schema.Types.ObjectId, ref: 'Lecturer', required: true },
    revision: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);
export const SubmissionVersionSchema = new Schema<SubmissionVersion>(
  {
    category: {
      type: String,
      enum: ['general', 'specialized'],
      default: 'general',
    },
    submissionId: objectId('Submission'),
    assignmentId: objectId('Assignment'),
    lecturerId: objectId('Lecturer'),
    version: { type: Number, required: true, min: 1 },
    fullName: text,
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    note: { type: String, default: '', maxlength: 2000 },
    submittedAt: { type: Date, required: true },
    late: { type: Boolean, required: true },
    files: {
      type: [FileSchema],
      required: true,
      validate: (v: StoredFile[]) =>
        v.length >= 1 && v.length <= SYSTEM_MAX_FILES,
    },
    requestKey: { type: String, required: true, unique: true, select: false },
    grade: { type: SubmissionGradeSchema, required: false },
  },
  { ...options, collection: 'submissionVersions' },
);
SubmissionVersionSchema.index(
  { submissionId: 1, version: 1 },
  { unique: true },
);
export const UploadBatchSchema = new Schema<UploadBatch>(
  {
    requestKey: { type: String, required: true, unique: true },
    fingerprint: { type: String, required: true },
    submissionId: objectId('Submission'),
    state: {
      type: String,
      enum: ['processing', 'completed', 'cleanup', 'cleaned'],
      required: true,
      index: true,
    },
    token: { type: String, required: true },
    plannedFiles: [String],
    version: Number,
    expiresAt: { type: Date, required: true },
    retryAt: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
    failureCode: { type: String, maxlength: 80 },
    failureMessage: { type: String, maxlength: 500 },
  },
  { ...options, collection: 'uploadBatches' },
);
