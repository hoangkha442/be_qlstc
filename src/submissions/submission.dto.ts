import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsBoolean,
  IsNumber,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  ValidateIf,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class SubmitDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  studentCode: string;
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName: string;
  @ApiProperty({ description: 'Email nhận xác nhận bài nộp.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  note?: string;
  @ApiPropertyOptional({ description: 'Bắt buộc khi nộp lại' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  secret?: string;
}
export class LookupReceiptDto {
  @ApiProperty() @IsString() @Matches(/^BN-[A-F0-9]{32}$/) receiptCode: string;
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(128) secret: string;
}
export class DownloadFileQuery {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) fileIndex: number;
}
export class ReceiptFileDto extends LookupReceiptDto {
  @ApiProperty() @IsInt() @Min(1) version: number;
  @ApiProperty() @IsInt() @Min(0) fileIndex: number;
}
export class GradeSubmissionDto {
  @ApiProperty({ description: 'Phiên bản bài nộp cần chấm.' })
  @IsInt()
  @Min(1)
  version: number;

  @ApiProperty({
    minimum: 0,
    maximum: 10,
    description: 'Điểm thang 10, tối đa 2 chữ số thập phân.',
  })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(10)
  score: number;

  @ApiPropertyOptional({ maxLength: 5000 })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  feedback?: string;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ obj }: { obj: { sendEmail?: unknown } }) => obj.sendEmail)
  @IsBoolean()
  sendEmail?: boolean;

  @ApiProperty({
    minimum: 0,
    description: '0 nếu chưa chấm; dùng grade.revision hiện tại khi sửa điểm.',
  })
  @IsInt()
  @Min(0)
  expectedRevision: number;
}
