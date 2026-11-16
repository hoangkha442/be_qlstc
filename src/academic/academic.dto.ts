import {
  OmitType,
  PartialType,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  ValidateIf,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  GENERAL_SUBMISSION_EXTENSIONS,
  SUBMISSION_EXTENSION_PATTERN,
  MAX_SUBMISSION_EXTENSIONS,
  normalizeSubmissionExtensions,
  SYSTEM_MAX_FILES,
  SYSTEM_MAX_FILE_BYTES,
} from '../config.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const Optional = () =>
  ValidateIf((_object: unknown, value: unknown) => value !== undefined);
export class SemesterDto {
  @ApiProperty({ example: 'Học kỳ 1' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;
  @ApiProperty({ example: '2026-2027' })
  @Matches(/^\d{4}-\d{4}$/)
  academicYear: string;
}
export class UpdateSemesterDto extends PartialType(SemesterDto, {
  skipNullProperties: false,
}) {}
export class CatalogDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9_-]{1,80}$/)
  code: string;
}
export class UpdateCatalogDto extends PartialType(CatalogDto, {
  skipNullProperties: false,
}) {}
export class SectionDto extends CatalogDto {
  @ApiProperty() @IsMongoId() semesterId: string;
  @ApiProperty() @IsMongoId() subjectId: string;
  @ApiProperty() @IsMongoId() classId: string;
}
export class UpdateSectionDto extends PartialType(SectionDto, {
  skipNullProperties: false,
}) {}
export class ArchiveDto {
  @ApiProperty() @IsBoolean() archived: boolean;
}
export class AssignmentDto {
  @ApiProperty() @IsMongoId() courseSectionId: string;
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;
  @ApiPropertyOptional()
  @Optional()
  @IsString()
  @MaxLength(20000)
  instructions?: string;
  @ApiProperty({ example: '2026-11-10T00:00:00+07:00' })
  @IsDateString({ strict: true })
  opensAt: string;
  @ApiProperty({ example: '2026-11-30T23:59:00+07:00' })
  @IsDateString({ strict: true })
  dueAt: string;
  @ApiPropertyOptional({ default: false })
  @Optional()
  @IsBoolean()
  manuallyClosed?: boolean;
  @ApiPropertyOptional({ default: false })
  @Optional()
  @IsBoolean()
  allowLate?: boolean;
  @ApiPropertyOptional({ default: false })
  @Optional()
  @IsBoolean()
  allowResubmit?: boolean;
  @ApiPropertyOptional({
    isArray: true,
    type: String,
    description:
      'Các phần mở rộng được nhận, ví dụ pdf, zip, png, html hoặc tar.gz. Không gồm dấu chấm đầu.',
    default: GENERAL_SUBMISSION_EXTENSIONS,
  })
  @Optional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_SUBMISSION_EXTENSIONS)
  @Transform(({ value }: { value: unknown }) =>
    normalizeSubmissionExtensions(value),
  )
  @ArrayUnique()
  @Matches(SUBMISSION_EXTENSION_PATTERN, { each: true })
  allowedExtensions?: string[];
  @ApiPropertyOptional({ default: 5 })
  @Optional()
  @IsInt()
  @Min(1)
  @Max(SYSTEM_MAX_FILES)
  maxFiles?: number;
  @ApiPropertyOptional({ default: 10485760 })
  @Optional()
  @IsInt()
  @Min(1)
  @Max(SYSTEM_MAX_FILE_BYTES)
  maxFileBytes?: number;
}
export class UpdateAssignmentDto extends PartialType(AssignmentDto, {
  skipNullProperties: false,
}) {}
export class SpecializedAssignmentContentDto extends OmitType(AssignmentDto, [
  'courseSectionId',
] as const) {}
export type AssignmentPlacement = { moduleId?: string; lessonId?: string };
export class SpecializedAssignmentDto extends SpecializedAssignmentContentDto {
  @ApiPropertyOptional() @Optional() @IsMongoId() moduleId?: string;
  @ApiPropertyOptional() @Optional() @IsMongoId() lessonId?: string;
}
export class UpdateSpecializedAssignmentDto extends PartialType(
  SpecializedAssignmentDto,
  { skipNullProperties: false },
) {
  @ApiPropertyOptional({
    description: 'Gỡ liên kết chương/bài học, giữ bài tập ở cấp lộ trình.',
  })
  @Optional()
  @IsBoolean()
  removePlacement?: boolean;
}
export class AssignmentAttachmentsDto {
  @ApiPropertyOptional({
    type: [SpecializedAssignmentContentDto],
    description:
      'Tạo bài tập mới và gắn vào chương/bài học trong cùng giao dịch.',
  })
  @Optional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SpecializedAssignmentContentDto)
  assignments?: SpecializedAssignmentContentDto[];
  @ApiPropertyOptional({
    type: [String],
    description: 'Liên kết các bài tập mã nguồn đã có trong cùng lộ trình.',
  })
  @Optional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsMongoId({ each: true })
  assignmentIds?: string[];
}
export class ListQuery {
  @ApiPropertyOptional({ default: 1 })
  @Optional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;
  @ApiPropertyOptional({ default: 20 })
  @Optional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
  @ApiPropertyOptional()
  @Optional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional()
  @Optional()
  @IsIn(['true', 'false', 'all'])
  archived?: string;
  @ApiPropertyOptional() @Optional() @IsMongoId() semesterId?: string;
  @ApiPropertyOptional() @Optional() @IsMongoId() classId?: string;
  @ApiPropertyOptional() @Optional() @IsMongoId() courseSectionId?: string;
  @ApiPropertyOptional() @Optional() @IsMongoId() assignmentId?: string;
  @ApiPropertyOptional() @Optional() @IsMongoId() pathId?: string;
  @ApiPropertyOptional() @Optional() @IsMongoId() moduleId?: string;
  @ApiPropertyOptional() @Optional() @IsMongoId() lessonId?: string;
}
