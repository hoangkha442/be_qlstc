import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { hash } from 'bcryptjs';
import { isEmail } from 'class-validator';
import { DatabaseModule, Database } from './database/database.module.js';
import { serverEnvPath, validateEnvironment } from './config.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: serverEnvPath,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
  ],
})
class SeedModule {}

async function seed() {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn'],
  });
  try {
    const config = app.get(ConfigService);
    const db = app.get(Database);
    const email = config
      .getOrThrow<string>('SEED_LECTURER_EMAIL')
      .trim()
      .toLowerCase();
    const fullName = config.getOrThrow<string>('SEED_LECTURER_NAME').trim();
    const password = config.getOrThrow<string>('SEED_LECTURER_PASSWORD');
    if (
      !isEmail(email) ||
      !fullName ||
      fullName.length > 200 ||
      password.length < 12 ||
      Buffer.byteLength(password) > 72
    )
      throw new Error(
        'Kiểm tra SEED_LECTURER_*: email hợp lệ, tên 1–200 ký tự, mật khẩu ít nhất 12 ký tự và tối đa 72 byte.',
      );
    let lecturer = await db.lecturers.findOne({ email });
    if (!lecturer) {
      lecturer = await db.lecturers.create({
        email,
        fullName,
        passwordHash: await hash(password, 12),
      });
      console.info('Đã khởi tạo tài khoản giảng viên.');
    } else console.info('Tài khoản đã tồn tại; giữ nguyên mật khẩu.');
  } finally {
    await app.close();
  }
}
await seed().catch(() => {
  console.error(
    'Khởi tạo thất bại. Kiểm tra kết nối MongoDB và các biến SEED_LECTURER_* trong .env.',
  );
  process.exitCode = 1;
});
