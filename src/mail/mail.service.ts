import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { BRAND_NAME } from '../brand.js';

interface ReceiptEmail {
  email: string;
  fullName: string;
  studentCode: string;
  receiptCode: string;
  secret: string;
  assignment: string;
  semester: string;
  className: string;
  subject: string;
  section: string;
  version: number;
  submittedAt: Date;
  late: boolean;
  files: { originalName: string; bytes: number; format: string }[];
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport?: Transporter;

  constructor(private readonly config: ConfigService) {
    const user = config.get<string>('GMAIL_USER');
    const pass = config.get<string>('GMAIL_APP_PASSWORD');
    if (user && pass) {
      this.transport = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass: pass.replace(/\s/g, '') },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        disableFileAccess: true,
        disableUrlAccess: true,
        logger: false,
        debug: false,
      });
    }
  }

  assertConfigured() {
    if (!this.transport)
      throw new ServiceUnavailableException({
        code: 'MAIL_NOT_CONFIGURED',
        message: 'Chưa cấu hình Gmail gửi email. Vui lòng báo giảng viên.',
      });
  }

  async sendAccount(
    student: { email: string; fullName: string; username: string },
    temporaryPassword: string,
    reset = false,
  ): Promise<boolean> {
    if (!this.transport) return false;
    const loginUrl = `${this.config.getOrThrow<string>('FRONTEND_URL').split(',')[0]}/specialized/login`;
    const title = reset
      ? `Mật khẩu mới của tài khoản ${BRAND_NAME}`
      : `Tài khoản học tập ${BRAND_NAME} của bạn`;
    try {
      const result = await this.transport.sendMail({
        from: {
          name: BRAND_NAME,
          address: this.config.getOrThrow<string>('GMAIL_USER'),
        },
        to: { name: student.fullName, address: student.email },
        subject: title,
        text: `${title}\n\nChào ${student.fullName},\n\nGiảng viên đã ${reset ? 'đặt lại mật khẩu' : 'cấp tài khoản'} cho bạn.\nWebsite: ${loginUrl}\nTên đăng nhập: ${student.username}\nMật khẩu tạm: ${temporaryPassword}\n\nHãy đăng nhập và đổi mật khẩu trước khi vào học. Nếu có nhiều email cấp lại mật khẩu, sử dụng email mới nhất. Không chia sẻ email này.`,
        html: `<div style="font:15px/1.7 'Segoe UI',Arial,sans-serif;max-width:620px;margin:auto"><h2>${title}</h2><p>Chào ${escapeHtml(student.fullName)},</p><p>Giảng viên đã ${reset ? 'đặt lại mật khẩu' : 'cấp tài khoản'} cho bạn.</p><p>Website: <a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a></p><p>Tên đăng nhập: <strong>${escapeHtml(student.username)}</strong><br>Mật khẩu tạm: <strong>${escapeHtml(temporaryPassword)}</strong></p><p>Đăng nhập và đổi mật khẩu trước khi vào học. Nếu có nhiều email cấp lại mật khẩu, sử dụng email mới nhất. Không chia sẻ email này.</p></div>`,
      });
      return Boolean(result.accepted?.length);
    } catch {
      this.logger.warn('Chưa gửi được email tài khoản sinh viên qua Gmail.');
      return false;
    }
  }

  async sendReceipt(receipt: ReceiptEmail): Promise<boolean> {
    if (!this.transport) return false;
    try {
      const lookupUrl = `${this.config.getOrThrow<string>('FRONTEND_URL').split(',')[0]}/lookup`;
      const time = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(receipt.submittedAt);
      const rows = [
        ['Sinh viên', `${receipt.studentCode} · ${receipt.fullName}`],
        ['Học kỳ', receipt.semester],
        ['Lớp', receipt.className],
        ['Môn học', receipt.subject],
        ['Học phần', receipt.section],
        ['Bài tập', receipt.assignment],
        ['Phiên bản', String(receipt.version)],
        ['Thời gian nộp (Việt Nam)', time],
        ['Trạng thái', receipt.late ? 'Trễ hạn' : 'Đúng hạn'],
        ['Mã biên nhận', receipt.receiptCode],
        ['Mã bí mật để tra cứu', receipt.secret],
      ];
      const files = receipt.files.map(
        (file) =>
          `${file.originalName} · ${file.bytes} byte · ${file.format.toUpperCase()}`,
      );
      const result = await this.transport.sendMail({
        from: {
          name: BRAND_NAME,
          address: this.config.getOrThrow<string>('GMAIL_USER'),
        },
        to: { name: receipt.fullName, address: receipt.email },
        subject: `${BRAND_NAME} · Đã nhận bài nộp · ${receipt.assignment.replace(/[\r\n]/g, ' ')}`,
        text: `${BRAND_NAME}\nĐÃ NHẬN BÀI NỘP\n\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nFile đã nhận:\n${files.join('\n')}\n\nXem lại bài tại ${lookupUrl}\nNhập mã biên nhận và mã bí mật ở trên. Không cần tài khoản. Giữ kín email này.`,
        html: `<div style="font:15px/1.6 Arial,sans-serif;max-width:720px;margin:auto"><p style="font-weight:700;color:#1e3a5f">${BRAND_NAME}</p><h2>Đã nhận bài nộp</h2><p>Dùng mã bên dưới để xem lại thông tin và tải bài đã nộp.</p><table>${rows.map(([label, value]) => `<tr><th style="text-align:left;vertical-align:top;padding:6px">${escapeHtml(label)}</th><td style="padding:6px;word-break:break-word">${escapeHtml(value)}</td></tr>`).join('')}</table><h3>File đã nhận</h3><ul>${files.map((file) => `<li>${escapeHtml(file)}</li>`).join('')}</ul><p><a href="${escapeHtml(lookupUrl)}">Xem lại bài đã nộp</a> bằng mã biên nhận và mã bí mật ở trên. Không cần tài khoản.</p><p>Giữ kín email này.</p></div>`,
      });
      if (!result.accepted?.length) throw new Error('Recipient not accepted');
      return true;
    } catch {
      // Email failure must never roll back a successfully saved submission.
      this.logger.warn(
        'Chưa gửi được mã tra cứu qua Gmail. Bài nộp đã được lưu.',
      );
      return false;
    }
  }
}
