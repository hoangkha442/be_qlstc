import { existsSync } from 'node:fs';
import { v2 as cloudinary } from 'cloudinary';
import { serverEnvPath } from './config.js';

async function checkStorage() {
  if (existsSync(serverEnvPath)) process.loadEnvFile(serverEnvPath);
  const required = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ] as const;
  for (const key of required) {
    if (!process.env[key]?.trim())
      throw new Error(`Thiếu ${key} trong server/.env.`);
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME!.trim(),
    api_key: process.env.CLOUDINARY_API_KEY!.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET!.trim(),
    secure: true,
    timeout: 10000,
  });
  try {
    await cloudinary.api.ping();
    console.info('Kết nối Cloudinary thành công. Không upload hoặc xóa file.');
  } catch (error) {
    const provider = error as {
      http_code?: number;
      message?: string;
      error?: { http_code?: number; message?: string };
    };
    const status = provider.http_code ?? provider.error?.http_code;
    const message = provider.message ?? provider.error?.message ?? '';
    if (/cloud_name mismatch/i.test(message))
      throw new Error(
        'Cloud Name không khớp API Key. Lấy lại Cloud Name, API Key và API Secret từ cùng một Product Environment.',
      );
    if (status === 401)
      throw new Error(
        'Cloudinary từ chối xác thực (401). Kiểm tra Cloud Name, API Key và API Secret cùng một cặp khóa đang hoạt động.',
      );
    if (status === 403)
      throw new Error(
        'Cloudinary từ chối truy cập (403). Kiểm tra quyền của API Key.',
      );
    throw new Error(
      'Chưa kết nối được Cloudinary. Kiểm tra kết nối mạng và cấu hình, rồi chạy lại.',
    );
  }
}

await checkStorage().catch((error: unknown) => {
  // Print only our own fixed diagnostics, never raw provider errors or credentials.
  console.error(
    error instanceof Error ? error.message : 'Kiểm tra Cloudinary thất bại.',
  );
  process.exitCode = 1;
});
