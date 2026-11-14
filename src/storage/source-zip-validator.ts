import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { fromBuffer } from 'yauzl';
import CRC32 from 'crc-32';
import { safeFilename, SYSTEM_MAX_FILE_BYTES } from '../config.js';
import type { ValidatedSubmissionFile } from './validated-file.js';

const source =
  /\.(?:html?|css|scss|sass|less|[cm]?js|jsx|tsx?|vue|svelte|php|py|java|cs|go|rs|sql|c|cpp|h|hpp|rb|kt|swift|dart|ipynb)$/i;
export async function validateSourceZip(
  files: Express.Multer.File[] | undefined,
): Promise<ValidatedSubmissionFile[]> {
  if (files?.length !== 1)
    throw new BadRequestException(
      'Vui lòng nộp đúng một file ZIP chứa mã nguồn.',
    );
  const file = files[0];
  if (
    !file.buffer ||
    file.buffer.length < 4 ||
    extname(file.originalname).toLowerCase() !== '.zip'
  )
    throw new BadRequestException(
      'Bài Chuyên ngành yêu cầu file ZIP chứa mã nguồn.',
    );
  if (file.buffer.length > SYSTEM_MAX_FILE_BYTES)
    throw new PayloadTooLargeException('File ZIP tối đa 10 MB.');
  if (file.buffer.readUInt32LE(0) !== 0x04034b50)
    throw new BadRequestException(
      'File ZIP không hợp lệ hoặc không có mã nguồn.',
    );
  await new Promise<void>((resolve, reject) => {
    fromBuffer(
      file.buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new BadRequestException('Không đọc được file ZIP.'));
          return;
        }
        let ended = false,
          count = 0,
          total = 0,
          hasSource = false;
        const names = new Set<string>();
        const fail = (message: string) => {
          if (!ended) {
            ended = true;
            zip.close();
            reject(new BadRequestException(message));
          }
        };
        zip.on('error', () =>
          fail('File ZIP bị hỏng hoặc chứa đường dẫn không hợp lệ.'),
        );
        zip.on('end', () => {
          if (ended) return;
          ended = true;
          if (hasSource) resolve();
          else
            reject(
              new BadRequestException(
                'ZIP cần chứa ít nhất một file mã nguồn như HTML, CSS, JS, TS hoặc PHP.',
              ),
            );
        });
        zip.on('entry', (entry) => {
          if (ended) return;
          const name = entry.fileName.normalize('NFKC');
          const normalized = name.toLowerCase();
          if (
            ++count > 5000 ||
            names.has(normalized) ||
            name.includes(String.fromCharCode(0)) ||
            /(^\/|^[a-z]:|(?:^|\/)\.\.(?:\/|$))/i.test(name)
          ) {
            fail(
              'ZIP có quá nhiều file, file trùng hoặc đường dẫn không hợp lệ.',
            );
            return;
          }
          names.add(normalized);
          if (/(?:^|\/)(?:node_modules|\.git)(?:\/|$)/i.test(name)) {
            fail('Bỏ thư mục node_modules và .git trước khi nén mã nguồn.');
            return;
          }
          if (
            entry.generalPurposeBitFlag & 1 ||
            ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
          ) {
            fail('ZIP không được đặt mật khẩu hoặc chứa liên kết tượng trưng.');
            return;
          }
          total += entry.uncompressedSize;
          if (
            total > 100 * 1024 * 1024 ||
            entry.uncompressedSize > 20 * 1024 * 1024 ||
            entry.uncompressedSize >
              Math.max(1048576, entry.compressedSize * 200)
          ) {
            fail('Nội dung giải nén vượt giới hạn cho phép.');
            return;
          }
          if (name.endsWith('/')) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail('Không đọc được nội dung ZIP.');
              return;
            }
            let bytes = 0,
              crc = 0;
            stream.on('error', () => fail('Nội dung ZIP bị hỏng.'));
            stream.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > entry.uncompressedSize || bytes > 20 * 1024 * 1024) {
                stream.destroy();
                fail('Nội dung ZIP vượt giới hạn.');
                return;
              }
              crc = CRC32.buf(chunk, crc);
            });
            stream.on('end', () => {
              if (ended) return;
              if (
                bytes !== entry.uncompressedSize ||
                crc >>> 0 !== entry.crc32 >>> 0
              ) {
                fail('ZIP không đầy đủ hoặc sai mã kiểm tra dữ liệu.');
                return;
              }
              if (bytes > 0 && source.test(name)) hasSource = true;
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
  return [
    {
      buffer: file.buffer,
      originalName: safeFilename(file.originalname),
      format: 'zip',
      bytes: file.buffer.length,
      digest: createHash('sha256').update(file.buffer).digest('hex'),
    },
  ];
}
