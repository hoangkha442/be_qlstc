import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Global,
  Injectable,
  Module,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { compare } from 'bcryptjs';
import type { Request } from 'express';
import { Database } from '../database/database.module.js';

export type LecturerRequest = Request & {
  lecturer: { id: string; email: string; fullName: string };
};
export class LoginDto {
  @ApiProperty({ example: 'giangvien@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(200)
  email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(72) password: string;
}

@Injectable()
export class LecturerGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: Database,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<LecturerRequest>();
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException(
        'Vui lòng đăng nhập tài khoản giảng viên.',
      );
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: string }>(
        authorization.slice(7),
        {
          algorithms: ['HS256'],
          issuer: 'assignment-server',
          audience: 'lecturer',
        },
      );
      if (payload.role !== 'lecturer' || !/^[a-f\d]{24}$/i.test(payload.sub))
        throw new Error();
      const lecturer = await this.db.lecturers
        .findOne({ _id: payload.sub, active: true })
        .lean();
      if (!lecturer) throw new Error();
      req.lecturer = {
        id: lecturer._id.toString(),
        email: lecturer.email,
        fullName: lecturer.fullName,
      };
      return true;
    } catch {
      throw new UnauthorizedException(
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
      );
    }
  }
}

@ApiTags('Đăng nhập giảng viên')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() dto: LoginDto) {
    const lecturer = await this.db.lecturers
      .findOne({ email: dto.email, active: true })
      .select('+passwordHash');
    // Run a password comparison even for unknown accounts to reduce timing differences.
    const valid = await compare(
      dto.password,
      lecturer?.passwordHash ??
        '$2b$12$RgBkV8U5mXan2vHtQax.oexZhkwvXSXoPNePaD2rHBlIY9VCWhpAu',
    );
    if (!lecturer || !valid)
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác.');
    return {
      accessToken: await this.jwt.signAsync({
        sub: lecturer._id.toString(),
        role: 'lecturer',
      }),
      tokenType: 'Bearer',
      expiresIn: 28800,
      lecturer: {
        id: lecturer._id,
        email: lecturer.email,
        fullName: lecturer.fullName,
      },
    };
  }
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(LecturerGuard)
  me(@Req() req: LecturerRequest) {
    return req.lecturer;
  }
}

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '8h',
          algorithm: 'HS256',
          issuer: 'assignment-server',
          audience: 'lecturer',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [LecturerGuard],
  exports: [LecturerGuard, JwtModule],
})
export class AuthModule {}
