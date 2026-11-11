import { BadRequestException } from '@nestjs/common';
import type { Assignment } from '../database/schemas.js';

export function assignmentStatus(
  assignment: Pick<
    Assignment,
    'archived' | 'manuallyClosed' | 'opensAt' | 'dueAt' | 'allowLate'
  >,
  now = new Date(),
) {
  if (assignment.archived || assignment.manuallyClosed)
    return { code: 'closed', label: 'Đã đóng', accepting: false };
  if (now < assignment.opensAt)
    return { code: 'scheduled', label: 'Chưa mở', accepting: false };
  if (now > assignment.dueAt)
    return {
      code: 'expired',
      label: 'Đã hết hạn',
      accepting: assignment.allowLate,
    };
  return { code: 'open', label: 'Đang nhận bài', accepting: true };
}

export function assertAccepting(assignment: Assignment, now = new Date()) {
  const status = assignmentStatus(assignment, now);
  if (!status.accepting)
    throw new BadRequestException(`Bài tập ${status.label.toLowerCase()}.`);
}
