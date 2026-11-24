import { Schema, Types } from 'mongoose';
import { storedFileFields } from '../database/schemas.js';
import type { BaseEntity, StoredFile } from '../database/schemas.js';
import { SYSTEM_MAX_FILES } from '../config.js';

export interface Student extends BaseEntity {
  lecturerId: Types.ObjectId;
  username: string;
  studentCode: string;
  fullName: string;
  email: string;
  passwordHash: string;
  active: boolean;
  mustChangePassword: boolean;
  tokenVersion: number;
}
export interface LearningPath extends BaseEntity {
  lecturerId: Types.ObjectId;
  category: 'specialized';
  title: string;
  slug: string;
  summary: string;
  description: string;
  objectives: string[];
  prerequisites: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  coverUrl?: string;
  published: boolean;
  archived: boolean;
}
export interface LearningModule extends BaseEntity {
  lecturerId: Types.ObjectId;
  pathId: Types.ObjectId;
  title: string;
  description: string;
  order: number;
  published: boolean;
  archived: boolean;
}
export interface LearningResource {
  title: string;
  url: string;
  kind: 'document' | 'source_code' | 'link';
}
export interface Lesson extends BaseEntity {
  lecturerId: Types.ObjectId;
  pathId: Types.ObjectId;
  moduleId: Types.ObjectId;
  title: string;
  summary: string;
  content: string;
  videoUrl?: string;
  durationSeconds: number;
  resources: LearningResource[];
  files: LessonFile[];
  isPreview: boolean;
  order: number;
  published: boolean;
  archived: boolean;
}
export interface LessonFile extends StoredFile {
  id: string;
}
export interface LessonFileCleanup extends BaseEntity {
  publicId: string;
  fileId: string;
  retryAt: Date;
}
export interface Enrollment extends BaseEntity {
  lecturerId: Types.ObjectId;
  pathId: Types.ObjectId;
  studentId: Types.ObjectId;
  active: boolean;
}
export interface LessonProgress extends BaseEntity {
  studentId: Types.ObjectId;
  pathId: Types.ObjectId;
  lessonId: Types.ObjectId;
  completed: boolean;
}

const options = { timestamps: true, versionKey: false } as const;
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  index: true,
});
const title = { type: String, required: true, trim: true, maxlength: 200 };
const owned = {
  lecturerId: ref('Lecturer'),
  archived: { type: Boolean, default: false },
};
export const StudentSchema = new Schema<Student>(
  {
    lecturerId: ref('Lecturer'),
    username: { ...title, lowercase: true, unique: true, maxlength: 80 },
    studentCode: { ...title, maxlength: 40 },
    fullName: title,
    email: { ...title, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0, select: false },
  },
  { ...options, collection: 'students' },
);
StudentSchema.index({ lecturerId: 1, studentCode: 1 }, { unique: true });
export const LearningPathSchema = new Schema<LearningPath>(
  {
    ...owned,
    category: { type: String, enum: ['specialized'], default: 'specialized' },
    title,
    slug: { ...title, maxlength: 100 },
    summary: { type: String, default: '', maxlength: 1000 },
    description: { type: String, default: '', maxlength: 30000 },
    objectives: { type: [String], default: [] },
    prerequisites: { type: String, default: '', maxlength: 5000 },
    level: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'beginner',
    },
    coverUrl: { type: String, maxlength: 2048 },
    published: { type: Boolean, default: false },
  },
  { ...options, collection: 'learningPaths' },
);
LearningPathSchema.index({ lecturerId: 1, slug: 1 }, { unique: true });
LearningPathSchema.index({ lecturerId: 1, archived: 1, published: 1 });
export const LearningModuleSchema = new Schema<LearningModule>(
  {
    ...owned,
    pathId: ref('LearningPath'),
    title,
    description: { type: String, default: '', maxlength: 10000 },
    order: { type: Number, default: 0, min: 0 },
    published: { type: Boolean, default: false },
  },
  { ...options, collection: 'learningModules' },
);
LearningModuleSchema.index({ pathId: 1, archived: 1, order: 1 });
const ResourceSchema = new Schema<LearningResource>(
  {
    title,
    url: { type: String, required: true, maxlength: 2048 },
    kind: {
      type: String,
      enum: ['document', 'source_code', 'link'],
      required: true,
    },
  },
  { _id: false },
);
export const LessonSchema = new Schema<Lesson>(
  {
    ...owned,
    pathId: ref('LearningPath'),
    moduleId: ref('LearningModule'),
    title,
    summary: { type: String, default: '', maxlength: 1000 },
    content: { type: String, default: '', maxlength: 100000 },
    videoUrl: { type: String, maxlength: 2048 },
    durationSeconds: { type: Number, default: 0, min: 0 },
    resources: { type: [ResourceSchema], default: [] },
    files: {
      type: [
        new Schema<LessonFile>(
          { ...storedFileFields, id: { type: String, required: true } },
          { _id: false },
        ),
      ],
      default: [],
      validate: (files: LessonFile[]) => files.length <= SYSTEM_MAX_FILES,
    },
    isPreview: { type: Boolean, default: false },
    order: { type: Number, default: 0, min: 0 },
    published: { type: Boolean, default: false },
  },
  { ...options, collection: 'lessons' },
);
LessonSchema.index({ pathId: 1, moduleId: 1, archived: 1, order: 1 });
export const LessonFileCleanupSchema = new Schema<LessonFileCleanup>(
  {
    publicId: { type: String, required: true, unique: true },
    fileId: { type: String, required: true },
    retryAt: { type: Date, required: true, index: true },
  },
  { ...options, collection: 'lessonFileCleanup' },
);
export const EnrollmentSchema = new Schema<Enrollment>(
  {
    lecturerId: ref('Lecturer'),
    pathId: ref('LearningPath'),
    studentId: ref('Student'),
    active: { type: Boolean, default: true },
  },
  { ...options, collection: 'enrollments' },
);
EnrollmentSchema.index({ pathId: 1, studentId: 1 }, { unique: true });
export const LessonProgressSchema = new Schema<LessonProgress>(
  {
    studentId: ref('Student'),
    pathId: ref('LearningPath'),
    lessonId: ref('Lesson'),
    completed: { type: Boolean, default: false },
  },
  { ...options, collection: 'lessonProgress' },
);
LessonProgressSchema.index({ studentId: 1, lessonId: 1 }, { unique: true });
