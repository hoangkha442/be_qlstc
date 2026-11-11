import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Database } from './database/database.module.js';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly db: Database) {}

  @Get()
  info() {
    return {
      name: 'API cổng học tập',
      version: '2.0.0',
      docs: '/api/docs',
      health: '/api/health',
    };
  }
  @Get('health')
  @SkipThrottle()
  async health() {
    if (this.db.connection.readyState !== 1)
      throw new ServiceUnavailableException('Cơ sở dữ liệu chưa sẵn sàng.');
    await this.db.connection.db!.admin().ping({ timeoutMS: 3000 });
    return {
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    };
  }
}
