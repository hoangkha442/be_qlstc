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

export function resubmissionPolicy(
  assignment: Pick<
    Assignment,
    | 'archived'
    | 'manuallyClosed'
    | 'opensAt'
    | 'dueAt'
    | 'allowLate'
    | 'allowResubmit'
  >,
  now = new Date(),
) {
  const status = assignmentStatus(assignment, now);
  if (!status.accepting)
    return {
      allowed: false,
      reason: `Bài tập ${status.label.toLowerCase()}. Liên hệ giảng viên nếu cần nộp lại.`,
    };
  if (!assignment.allowResubmit)
    return {
      allowed: false,
      reason: 'Giảng viên chưa cho phép nộp lại bài tập này.',
    };
  return { allowed: true, reason: null };
}
