import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  PipeTransform,
  BadRequestException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { Request, Response } from 'express';

@Injectable()
export class ObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!/^[a-f\d]{24}$/i.test(value) || !Types.ObjectId.isValid(value))
      throw new BadRequestException('ID không hợp lệ.');
    return value;
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const err = error as {
      code?: number | string;
      name?: string;
      type?: string;
    };
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string | undefined;
    let retryAfterSeconds: number | undefined;
    let message: string | string[] = 'Có lỗi xảy ra. Vui lòng thử lại sau.';
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      if (typeof body === 'object') {
        const metadata = body as {
          code?: unknown;
          retryAfterSeconds?: unknown;
        };
        if (typeof metadata.code === 'string') code = metadata.code;
        if (
          typeof metadata.retryAfterSeconds === 'number' &&
          Number.isFinite(metadata.retryAfterSeconds) &&
          metadata.retryAfterSeconds > 0
        )
          retryAfterSeconds = Math.min(
            3600,
            Math.ceil(metadata.retryAfterSeconds),
          );
      }
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ??
            error.message);
    } else if (err.code === 11000) {
      status = HttpStatus.CONFLICT;
      message = 'Dữ liệu đã tồn tại hoặc yêu cầu đang được xử lý.';
    } else if (err.name === 'ValidationError' || err.name === 'CastError') {
      status = HttpStatus.BAD_REQUEST;
      message = 'Dữ liệu không hợp lệ.';
    } else if (err.type === 'entity.too.large') {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'Yêu cầu vượt quá dung lượng cho phép.';
    } else if (
      /Mongo.*(?:Network|Selection|Timeout)|MongooseServerSelection/.test(
        err.name ?? '',
      )
    ) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Cơ sở dữ liệu tạm thời chưa phản hồi. Vui lòng thử lại.';
    }
    // Deliberately do not log request bodies, credentials, signed URLs or provider errors.
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (retryAfterSeconds)
      res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(status).json({
      statusCode: status,
      message,
      ...(code ? { code } : {}),
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
      path: req.path,
      timestamp: new Date().toISOString(),
    });
  }
}
