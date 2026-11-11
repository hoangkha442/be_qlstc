import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Post,
  Req,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { compare, hash } from 'bcryptjs';
import type { Request } from 'express';
import { Database } from '../database/database.module.js';
import { ChangePasswordDto, StudentLoginDto } from './learning.dto.js';

export type StudentRequest = Request & {
  student: {
    id: string;
    lecturerId: string;
    username: string;
    studentCode: string;
    fullName: string;
    email: string;
    mustChangePassword: boolean;
    tokenVersion: number;
  };
};
const INITIAL_PASSWORD_ACCESS = 'student:initial-password-access';
const InitialPasswordAccess = () => SetMetadata(INITIAL_PASSWORD_ACCESS, true);

@Injectable()
export class StudentGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: Database,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<StudentRequest>();
    let student: StudentRequest['student'];
    try {
      const authorization = req.headers.authorization;
      if (!authorization?.startsWith('Bearer ')) throw new Error();
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        role: string;
        tokenVersion: number;
      }>(authorization.slice(7), {
        algorithms: ['HS256'],
        issuer: 'assignment-server',
        audience: 'student',
      });
      if (payload.role !== 'student' || !/^[a-f\d]{24}$/i.test(payload.sub))
        throw new Error();
      const found = await this.db.students
        .findOne({ _id: payload.sub, active: true })
        .select('+tokenVersion')
        .lean();
      if (
        !found ||
        found.tokenVersion !== payload.tokenVersion ||
        !(await this.db.lecturers.exists({
          _id: found.lecturerId,
          active: true,
        }))
      )
        throw new Error();
      student = {
        id: found._id.toString(),
        lecturerId: found.lecturerId.toString(),
        username: found.username,
        studentCode: found.studentCode,
        fullName: found.fullName,
        email: found.email,
        mustChangePassword: found.mustChangePassword,
        tokenVersion: found.tokenVersion,
      };
    } catch {
      throw new UnauthorizedException(
        'Vui lòng đăng nhập tài khoản sinh viên được giảng viên cấp.',
      );
    }
    req.student = student;
    if (
      student.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(INITIAL_PASSWORD_ACCESS, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Vui lòng đổi mật khẩu được cấp trước khi vào học.',
      });
    }
    return true;
  }
}

@ApiTags('Tài khoản sinh viên')
@Controller('student/auth')
export class StudentAuthController {
  constructor(
    private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}
  private async session(student: StudentRequest['student']) {
    const { tokenVersion, ...profile } = student;
    return {
      accessToken: await this.jwt.signAsync(
        { sub: student.id, role: 'student', tokenVersion },
        { audience: 'student' },
      ),
      tokenType: 'Bearer',
      expiresIn: 28800,
      student: profile,
    };
  }
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() dto: StudentLoginDto) {
    const found = await this.db.students
      .findOne({ username: dto.username, active: true })
      .select('+passwordHash +tokenVersion')
      .lean();
    const valid = await compare(
      dto.password,
      found?.passwordHash ??
        '$2b$12$RgBkV8U5mXan2vHtQax.oexZhkwvXSXoPNePaD2rHBlIY9VCWhpAu',
    );
    if (
      !found ||
      !valid ||
      !(await this.db.lecturers.exists({ _id: found.lecturerId, active: true }))
    ) {
      throw new UnauthorizedException(
        'Tên đăng nhập hoặc mật khẩu không chính xác.',
      );
    }
    return this.session({
      id: found._id.toString(),
      lecturerId: found.lecturerId.toString(),
      username: found.username,
      studentCode: found.studentCode,
      fullName: found.fullName,
      email: found.email,
      mustChangePassword: found.mustChangePassword,
      tokenVersion: found.tokenVersion,
    });
  }
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(StudentGuard)
  @InitialPasswordAccess()
  me(@Req() req: StudentRequest) {
    const { tokenVersion: _tokenVersion, ...profile } = req.student;
    return profile;
  }
  @Post('change-password')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(StudentGuard)
  @InitialPasswordAccess()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async changePassword(
    @Req() req: StudentRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    if (
      Buffer.byteLength(dto.newPassword) > 72 ||
      dto.newPassword === dto.currentPassword
    ) {
      throw new ForbiddenException(
        'Mật khẩu mới phải khác mật khẩu hiện tại, có ít nhất 12 ký tự và tối đa 72 byte.',
      );
    }
    const student = await this.db.students
      .findOne({ _id: req.student.id, active: true })
      .select('+passwordHash +tokenVersion');
    if (
      !student ||
      student.tokenVersion !== req.student.tokenVersion ||
      !(await compare(dto.currentPassword, student.passwordHash))
    ) {
      throw new UnauthorizedException(
        'Mật khẩu hiện tại không chính xác hoặc phiên đã hết hạn.',
      );
    }
    const changed = await this.db.students.updateOne(
      { _id: student._id, tokenVersion: student.tokenVersion, active: true },
      {
        $set: {
          passwordHash: await hash(dto.newPassword, 12),
          mustChangePassword: false,
        },
        $inc: { tokenVersion: 1 },
      },
    );
    if (!changed.modifiedCount)
      throw new UnauthorizedException(
        'Tài khoản đã thay đổi. Vui lòng đăng nhập lại.',
      );
    return this.session({
      ...req.student,
      tokenVersion: student.tokenVersion + 1,
      mustChangePassword: false,
    });
  }
  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(StudentGuard)
  @InitialPasswordAccess()
  async logout(@Req() req: StudentRequest) {
    await this.db.students.updateOne(
      { _id: req.student.id, tokenVersion: req.student.tokenVersion },
      { $inc: { tokenVersion: 1 } },
    );
    return { message: 'Đã đăng xuất các phiên của tài khoản.' };
  }
}
