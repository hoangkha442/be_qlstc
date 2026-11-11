import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'node:stream';
import type { StoredFile } from '../database/schemas.js';
import type { ValidatedOfficeFile } from './office-validator.js';

export class StorageUploadError extends ServiceUnavailableException {
  readonly definitiveRejection: boolean;
  readonly failureCode: string;

  constructor(error: unknown) {
    const provider = error as
      { http_code?: number; message?: string } | undefined;
    const status = Number(provider?.http_code);
    const configurationError =
      status === 401 ||
      /cloud_name mismatch|invalid api key|invalid signature|must supply (?:api_key|api_secret|cloud_name)/i.test(
        provider?.message ?? '',
      );
    const failureCode = configurationError
      ? 'STORAGE_CONFIGURATION_ERROR'
      : 'STORAGE_UPLOAD_FAILED';
    const message = configurationError
      ? 'Dịch vụ lưu trữ chưa được cấu hình đúng. Vui lòng báo giảng viên kiểm tra kết nối Cloudinary trước khi thử lại.'
      : status === 403
        ? 'Cloudinary từ chối upload. Vui lòng báo giảng viên kiểm tra quyền upload tài liệu và cấu hình dịch vụ lưu trữ.'
        : 'Không thể tải file lên dịch vụ lưu trữ. Vui lòng thử lại với cùng Idempotency-Key.';
    super({ statusCode: 503, code: failureCode, message });
    this.failureCode = failureCode;
    // A provider 4xx response rejects the current file before creating an asset.
    // Timeouts, network failures, 409 conflicts and provider 5xx remain uncertain.
    this.definitiveRejection =
      [400, 401, 403, 404, 413, 415, 422].includes(status) &&
      !/already exists|duplicate/i.test(provider?.message ?? '');
  }
}

@Injectable()
export class CloudinaryService {
  constructor(config: ConfigService) {
    cloudinary.config({
      cloud_name: config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME').trim(),
      api_key: config.getOrThrow<string>('CLOUDINARY_API_KEY').trim(),
      api_secret: config.getOrThrow<string>('CLOUDINARY_API_SECRET').trim(),
      secure: true,
      timeout: 60000,
    });
  }
  async upload(
    file: ValidatedOfficeFile,
    publicId: string,
  ): Promise<StoredFile> {
    try {
      const result = await new Promise<{
        public_id: string;
        secure_url: string;
        bytes: number;
      }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            public_id: publicId,
            resource_type: 'raw',
            type: 'private',
            overwrite: false,
            timeout: 60000,
          },
          (error, response) => {
            if (error || !response) reject(error ?? new Error('Upload failed'));
            else resolve(response);
          },
        );
        stream.on('error', reject);
        stream.end(file.buffer);
      });
      return {
        originalName: file.originalName,
        publicId: result.public_id,
        resourceType: 'raw',
        deliveryType: 'private',
        secureUrl: result.secure_url,
        format: file.format,
        bytes: result.bytes,
        uploadedAt: new Date(),
      };
    } catch (error) {
      throw new StorageUploadError(error);
    }
  }
  async destroy(publicId: string) {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'raw',
      type: 'private',
      invalidate: true,
    });
    if (!['ok', 'not found'].includes(result.result))
      throw new Error('Cleanup failed');
  }
  async download(file: StoredFile) {
    // For raw assets the publicId already includes the extension; do not append format again.
    const url = cloudinary.utils.private_download_url(file.publicId, '', {
      resource_type: 'raw',
      type: 'private',
      expires_at: Math.floor(Date.now() / 1000) + 60,
      attachment: true,
    });
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(60000),
        redirect: 'error',
      });
      if (!response.ok || !response.body) throw new Error('Download failed');
      return Readable.fromWeb(
        response.body as Parameters<typeof Readable.fromWeb>[0],
      );
    } catch {
      throw new ServiceUnavailableException(
        'Dịch vụ lưu trữ tạm thời chưa phản hồi. Vui lòng tải lại sau.',
      );
    }
  }
}
