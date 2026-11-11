import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AssignmentAttachmentsDto,
  ListQuery,
} from '../academic/academic.dto.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const optional = () =>
  ValidateIf((_object: unknown, value: unknown) => value !== undefined);
export class CreateStudentDto {
  @ApiProperty()
  @Transform(lower)
  @Matches(/^[a-z0-9][a-z0-9._-]{2,79}$/)
  username: string;
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.normalize('NFKC').trim().toUpperCase()
      : value,
  )
  @Matches(/^[A-Z0-9_-]{2,40}$/)
  studentCode: string;
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName: string;
  @ApiProperty() @Transform(lower) @IsEmail() @MaxLength(254) email: string;
}
export class UpdateStudentDto {
  @ApiPropertyOptional()
  @optional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName?: string;
  @ApiPropertyOptional()
  @optional()
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  email?: string;
  @ApiPropertyOptional() @optional() @IsBoolean() active?: boolean;
}
export class StudentLoginDto {
  @ApiProperty()
  @Transform(lower)
  @Matches(/^[a-z0-9][a-z0-9._-]{2,79}$/)
  username: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(72) password: string;
}
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  currentPassword: string;
  @ApiProperty() @IsString() @MinLength(12) @MaxLength(72) newPassword: string;
}
export class LearningPathDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;
  @ApiProperty()
  @Transform(lower)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(100)
  slug: string;
  @ApiPropertyOptional()
  @optional()
  @IsString()
  @MaxLength(1000)
  summary?: string;
  @ApiPropertyOptional()
  @optional()
  @IsString()
  @MaxLength(30000)
  description?: string;
  @ApiPropertyOptional({ type: [String] })
  @optional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(500, { each: true })
  objectives?: string[];
  @ApiPropertyOptional()
  @optional()
  @IsString()
  @MaxLength(5000)
  prerequisites?: string;
  @ApiPropertyOptional({ enum: ['beginner', 'intermediate', 'advanced'] })
  @optional()
  @IsIn(['beginner', 'intermediate', 'advanced'])
  level?: 'beginner' | 'intermediate' | 'advanced';
  @ApiPropertyOptional()
  @optional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  coverUrl?: string;
  @ApiPropertyOptional() @optional() @IsBoolean() published?: boolean;
}
export class UpdateLearningPathDto extends PartialType(LearningPathDto, {
  skipNullProperties: false,
}) {}
export class LearningModuleDto extends AssignmentAttachmentsDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;
  @ApiPropertyOptional()
  @optional()
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ApiPropertyOptional()
  @optional()
  @IsInt()
  @Min(0)
  @Max(100000)
  order?: number;
  @ApiPropertyOptional() @optional() @IsBoolean() published?: boolean;
}
export class UpdateLearningModuleDto extends PartialType(LearningModuleDto, {
  skipNullProperties: false,
}) {}
export class ResourceDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;
  @ApiProperty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  url: string;
  @ApiProperty({ enum: ['document', 'source_code', 'link'] })
  @IsIn(['document', 'source_code', 'link'])
  kind: 'document' | 'source_code' | 'link';
}
export class LessonDto extends AssignmentAttachmentsDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;
  @ApiPropertyOptional()
  @optional()
  @IsString()
  @MaxLength(1000)
  summary?: string;
  @ApiPropertyOptional()
  @optional()
  @IsString()
  @MaxLength(100000)
  content?: string;
  @ApiPropertyOptional()
  @optional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  videoUrl?: string;
  @ApiPropertyOptional({ description: 'Xóa video hiện tại khi cập nhật.' })
  @optional()
  @IsBoolean()
  removeVideo?: boolean;
  @ApiPropertyOptional()
  @optional()
  @IsInt()
  @Min(0)
  @Max(86400)
  durationSeconds?: number;
  @ApiPropertyOptional({ type: [ResourceDto] })
  @optional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ResourceDto)
  resources?: ResourceDto[];
  @ApiPropertyOptional() @optional() @IsBoolean() isPreview?: boolean;
  @ApiPropertyOptional()
  @optional()
  @IsInt()
  @Min(0)
  @Max(100000)
  order?: number;
  @ApiPropertyOptional() @optional() @IsBoolean() published?: boolean;
}
export class UpdateLessonDto extends PartialType(LessonDto, {
  skipNullProperties: false,
}) {}
export class EnrollmentDto {
  @ApiProperty() @IsMongoId() studentId: string;
  @ApiPropertyOptional({ default: true })
  @optional()
  @IsBoolean()
  active?: boolean;
}
export class ProgressDto {
  @ApiProperty() @IsBoolean() completed: boolean;
}
export class LearningQuery extends ListQuery {
  @ApiPropertyOptional()
  @optional()
  @IsIn(['true', 'false'])
  published?: string;
  @ApiPropertyOptional() @optional() @IsIn(['true', 'false']) active?: string;
  @ApiPropertyOptional() @optional() @IsMongoId() studentId?: string;
}
