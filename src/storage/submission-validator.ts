import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Assignment } from '../database/schemas.js';
import {
  IMAGE_EXTENSIONS,
  OFFICE_EXTENSIONS,
  submissionFileExtension,
  safeFilename,
  SYSTEM_MAX_FILE_BYTES,
  SYSTEM_MAX_FILES,
} from '../config.js';
import { validateImageContent } from './image-validator.js';
import { validateOfficeContent } from './office-validator.js';
import { validateDocumentContent } from './document-validator.js';
import type { ValidatedSubmissionFile } from './validated-file.js';

const MIMES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  zip: ['application/zip', 'application/x-zip-compressed'],
  rar: [
    'application/vnd.rar',
    'application/x-rar-compressed',
    'application/x-rar',
  ],
  '7z': ['application/x-7z-compressed'],
  gz: ['application/gzip', 'application/x-gzip'],
  'tar.gz': ['application/gzip', 'application/x-gzip'],
  doc: ['application/msword'],
  xls: ['application/vnd.ms-excel'],
  ppt: ['application/vnd.ms-powerpoint'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  pptx: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  jpg: ['image/jpeg', 'image/pjpeg'],
  jpeg: ['image/jpeg', 'image/pjpeg'],
  png: ['image/png', 'image/x-png'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  avif: ['image/avif'],
  tif: ['image/tiff', 'image/x-tiff'],
  tiff: ['image/tiff', 'image/x-tiff'],
};

export async function validateSubmissionFiles(
  files: Express.Multer.File[] | undefined,
  assignment: Pick<
    Assignment,
    'allowedExtensions' | 'maxFiles' | 'maxFileBytes'
  >,
): Promise<ValidatedSubmissionFile[]> {
  if (!files?.length)
    throw new BadRequestException('Vui lòng chọn ít nhất một file.');
  if (files.length > Math.min(assignment.maxFiles, SYSTEM_MAX_FILES))
    throw new BadRequestException(
      `Chỉ được nộp tối đa ${assignment.maxFiles} file.`,
    );
  const validated: ValidatedSubmissionFile[] = [];
  for (const file of files) {
    const originalName = safeFilename(file.originalname);
    const format = submissionFileExtension(
      originalName,
      assignment.allowedExtensions,
    );
    if (!format)
      throw new BadRequestException(
        `File ${originalName}: định dạng không được chấp nhận.`,
      );
    if (file.size !== file.buffer.length || file.size < 1)
      throw new BadRequestException(
        `File ${originalName}: rỗng hoặc dung lượng không hợp lệ.`,
      );
    if (file.size > Math.min(assignment.maxFileBytes, SYSTEM_MAX_FILE_BYTES))
      throw new PayloadTooLargeException(
        `File ${originalName}: vượt quá ${assignment.maxFileBytes} byte.`,
      );
    const image = IMAGE_EXTENSIONS.includes(format);
    const office = OFFICE_EXTENSIONS.includes(format);
    const mime = file.mimetype.toLowerCase();
    // Some browsers do not identify AVIF/TIFF MIME types. Byte validation below
    // remains mandatory for images with an absent or generic MIME type.
    const acceptedMimes = Object.hasOwn(MIMES, format)
      ? MIMES[format]
      : undefined;
    if (
      acceptedMimes &&
      !acceptedMimes.includes(mime) &&
      !(!office && ['', 'application/octet-stream'].includes(mime))
    )
      throw new BadRequestException(
        `File ${originalName}: MIME type không phù hợp định dạng ${format}.`,
      );
    try {
      if (image) await validateImageContent(file.buffer, format);
      else if (office) await validateOfficeContent(file.buffer, format);
      else await validateDocumentContent(file.buffer, format);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        image
          ? `File ${originalName}: ảnh không hợp lệ, bị hỏng, sai định dạng hoặc vượt giới hạn 40 triệu điểm ảnh/250 khung hình.`
          : office
            ? `File ${originalName}: cấu trúc Office không hợp lệ, chứa macro, bị mã hóa hoặc có nội dung nhúng không được hỗ trợ.`
            : `File ${originalName}: nội dung không hợp lệ hoặc không đúng định dạng ${format}.`,
      );
    }
    validated.push({
      buffer: file.buffer,
      originalName,
      format,
      bytes: file.size,
      digest: createHash('sha256').update(file.buffer).digest('hex'),
    });
  }
  return validated;
}
