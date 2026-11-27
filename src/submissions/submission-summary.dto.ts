import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const optional = () =>
  ValidateIf((_object: unknown, value: unknown) => value !== undefined);
export class SubmissionSummaryScope {
  @ApiProperty() @IsMongoId() classId: string;
  @ApiPropertyOptional() @optional() @IsMongoId() semesterId?: string;
  @ApiPropertyOptional() @optional() @IsMongoId() courseSectionId?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false' })
  @IsIn(['true', 'false'])
  includeArchived: 'true' | 'false' = 'false';
}
export class SubmissionSummaryQuery extends SubmissionSummaryScope {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;
  @ApiPropertyOptional({ default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;
  @ApiPropertyOptional()
  @optional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({
    enum: ['all', 'complete', 'incomplete'],
    default: 'all',
  })
  @IsIn(['all', 'complete', 'incomplete'])
  status: 'all' | 'complete' | 'incomplete' = 'all';
}
