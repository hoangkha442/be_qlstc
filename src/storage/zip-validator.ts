import { BadRequestException } from '@nestjs/common';
import { fromBuffer } from 'yauzl';
import CRC32 from 'crc-32';

export async function validateZipContent(buffer: Buffer) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50)
    throw new BadRequestException(
      'File ZIP không hợp lệ hoặc không có nội dung.',
    );
  await new Promise<void>((resolve, reject) => {
    fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new BadRequestException('Không đọc được file ZIP.'));
          return;
        }
        let ended = false,
          count = 0,
          total = 0,
          hasContent = false;
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
          if (hasContent) resolve();
          else
            reject(
              new BadRequestException(
                'ZIP cần chứa ít nhất một file có nội dung.',
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
            fail('Bỏ node_modules và .git trước khi nén thư mục.');
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
              if (bytes > 0) hasContent = true;
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
