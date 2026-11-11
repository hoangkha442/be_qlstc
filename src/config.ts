import { BadRequestException } from '@nestjs/common';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { isEmail } from 'class-validator';

// Both src/config.ts and dist/config.js live one directory below server/.env.
// Resolve from this module so startup does not depend on the terminal's cwd.
export const serverEnvPath = fileURLToPath(new URL('../.env', import.meta.url));

export const OFFICE_EXTENSIONS = ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'];
export const SYSTEM_MAX_FILES = 5;
export const SYSTEM_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const SYSTEM_MAX_REQUEST_BYTES =
  SYSTEM_MAX_FILES * SYSTEM_MAX_FILE_BYTES + 64 * 1024;
export const UPLOAD_LEASE_MS = 15 * 60 * 1000;

export function validateEnvironment(env: Record<string, unknown>) {
  const required = [
    'MONGODB_URI',
    'JWT_SECRET',
    'RECEIPT_SECRET',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'FRONTEND_URL',
  ];
  for (const key of required) {
    if (typeof env[key] !== 'string' || !String(env[key]).trim())
      throw new Error(
        `Thiếu biến môi trường ${key}. Điền giá trị trong ${serverEnvPath} hoặc cấu hình biến môi trường hệ thống.`,
      );
  }
  for (const key of ['JWT_SECRET', 'RECEIPT_SECRET']) {
    if (String(env[key]).length < 32)
      throw new Error(`${key} phải có ít nhất 32 ký tự.`);
  }
  if (env.JWT_SECRET === env.RECEIPT_SECRET)
    throw new Error('JWT_SECRET và RECEIPT_SECRET phải khác nhau.');
  if (!/^mongodb(?:\+srv)?:\/\//.test(String(env.MONGODB_URI)))
    throw new Error('MONGODB_URI không hợp lệ.');
  if (
    /DB_USER|DB_PASSWORD|@CLUSTER\.mongodb\.net|<[^>]+>/.test(
      String(env.MONGODB_URI),
    )
  )
    throw new Error(
      'MONGODB_URI vẫn chứa thông tin mẫu. Hãy thay bằng chuỗi kết nối thật từ MongoDB Atlas trong server/.env.',
    );
  const dnsServers = String(env.DNS_SERVERS ?? '')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  if (dnsServers.some((server) => !isIP(server)))
    throw new Error(
      'DNS_SERVERS phải gồm các địa chỉ IP DNS hợp lệ, ngăn cách bằng dấu phẩy.',
    );
  const origins = String(env.FRONTEND_URL)
    .split(',')
    .map((s) => s.trim());
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
      throw new Error(
        'FRONTEND_URL phải gồm các origin HTTP/HTTPS, ngăn cách bằng dấu phẩy.',
      );
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT không hợp lệ.');
  const mailKeys = ['GMAIL_USER', 'GMAIL_APP_PASSWORD'];
  const hasMailConfig = mailKeys.some(
    (key) => typeof env[key] === 'string' && String(env[key]).trim(),
  );
  if (hasMailConfig || env.NODE_ENV === 'production') {
    for (const key of mailKeys) {
      if (typeof env[key] !== 'string' || !String(env[key]).trim())
        throw new Error(
          `Thiếu ${key}. Điền Gmail gửi và mật khẩu ứng dụng trong server/.env.`,
        );
    }
    if (!isEmail(String(env.GMAIL_USER).trim()))
      throw new Error('GMAIL_USER phải là địa chỉ email hợp lệ.');
    if (String(env.GMAIL_APP_PASSWORD).replace(/\s/g, '').length !== 16)
      throw new Error(
        'GMAIL_APP_PASSWORD phải là mật khẩu ứng dụng Google gồm 16 ký tự.',
      );
  }
  return {
    ...env,
    DNS_SERVERS: dnsServers.join(','),
    PORT: port,
    GMAIL_USER: String(env.GMAIL_USER ?? '')
      .trim()
      .toLowerCase(),
    GMAIL_APP_PASSWORD: String(env.GMAIL_APP_PASSWORD ?? '').replace(/\s/g, ''),
    FRONTEND_URL: origins.join(','),
  };
}

export function normalizeStudentCode(value: string) {
  const code = value.normalize('NFKC').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(code))
    throw new BadRequestException(
      'Mã sinh viên chỉ gồm 2–40 chữ cái, số, dấu gạch ngang hoặc gạch dưới.',
    );
  return code;
}

export function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function safeFilename(value: string) {
  // Browsers send UTF-8 filenames, while multipart parsers commonly decode headers as Latin-1.
  if ([...value].every((char) => char.charCodeAt(0) <= 255)) {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) value = decoded;
  }
  return (
    value
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}._ -]/gu, '_')
      .replace(/^\.+/, '')
      .slice(-180) || 'file'
  );
}
