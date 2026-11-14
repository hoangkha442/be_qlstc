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

interface GradeEmail {
  email: string;
  fullName: string;
  studentCode: string;
  assignmentId: string;
  assignment: string;
  category: 'general' | 'specialized';
  receiptCode: string;
  version: number;
  score: number;
  feedback: string;
  gradedAt: Date;
}

interface OutgoingEmail {
  to: { name: string; address: string };
  subject: string;
  text: string;
  html: string;
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
  private readonly provider: 'gmail' | 'brevo';
  private readonly senderEmail?: string;

  constructor(private readonly config: ConfigService) {
    this.provider = config.get<'gmail' | 'brevo'>('MAIL_PROVIDER') ?? 'gmail';
    const user = config.get<string>('GMAIL_USER');
    const pass = config.get<string>('GMAIL_APP_PASSWORD');
    this.senderEmail =
      this.provider === 'brevo' ? config.get<string>('MAIL_FROM_EMAIL') : user;
    if (this.provider === 'gmail' && user && pass) {
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

  private isConfigured() {
    return this.provider === 'brevo'
      ? Boolean(this.senderEmail && this.config.get<string>('BREVO_API_KEY'))
      : Boolean(this.transport);
  }

  assertConfigured() {
    if (!this.isConfigured())
      throw new ServiceUnavailableException({
        code: 'MAIL_NOT_CONFIGURED',
        message: 'Chưa cấu hình dịch vụ gửi email. Vui lòng báo giảng viên.',
      });
  }

  private async sendMessage(message: OutgoingEmail): Promise<boolean> {
    if (!this.isConfigured()) return false;
    if (this.provider === 'brevo') {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'api-key': this.config.getOrThrow<string>('BREVO_API_KEY'),
        },
        body: JSON.stringify({
          sender: { name: BRAND_NAME, email: this.senderEmail },
          replyTo: { name: BRAND_NAME, email: this.senderEmail },
          to: [{ name: message.to.name, email: message.to.address }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        this.logger.warn(
          `Brevo từ chối yêu cầu gửi email (HTTP ${response.status}).`,
        );
        return false;
      }
      const result: unknown = await response.json();
      return Boolean(
        result &&
        typeof result === 'object' &&
        'messageId' in result &&
        typeof result.messageId === 'string' &&
        result.messageId.trim(),
      );
    }
    const result = await this.transport!.sendMail({
      from: { name: BRAND_NAME, address: this.senderEmail! },
      ...message,
    });
    return Boolean(result.accepted?.length);
  }

  async sendAccount(
    student: { email: string; fullName: string; username: string },
    temporaryPassword: string,
    reset = false,
  ): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const loginUrl = `${this.config.getOrThrow<string>('FRONTEND_URL').split(',')[0]}/specialized/login`;
    const title = reset
      ? `Mật khẩu mới của tài khoản ${BRAND_NAME}`
      : `Tài khoản học tập ${BRAND_NAME} của bạn`;
    try {
      return await this.sendMessage({
        to: { name: student.fullName, address: student.email },
        subject: title,
        text: `${title}\n\nChào ${student.fullName},\n\nGiảng viên đã ${reset ? 'đặt lại mật khẩu' : 'cấp tài khoản'} cho bạn.\nWebsite: ${loginUrl}\nTên đăng nhập: ${student.username}\nMật khẩu tạm: ${temporaryPassword}\n\nHãy đăng nhập và đổi mật khẩu trước khi vào học. Nếu có nhiều email cấp lại mật khẩu, sử dụng email mới nhất. Không chia sẻ email này.`,
        html: `<div style="font:15px/1.7 'Segoe UI',Arial,sans-serif;max-width:620px;margin:auto"><h2>${title}</h2><p>Chào ${escapeHtml(student.fullName)},</p><p>Giảng viên đã ${reset ? 'đặt lại mật khẩu' : 'cấp tài khoản'} cho bạn.</p><p>Website: <a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a></p><p>Tên đăng nhập: <strong>${escapeHtml(student.username)}</strong><br>Mật khẩu tạm: <strong>${escapeHtml(temporaryPassword)}</strong></p><p>Đăng nhập và đổi mật khẩu trước khi vào học. Nếu có nhiều email cấp lại mật khẩu, sử dụng email mới nhất. Không chia sẻ email này.</p></div>`,
      });
    } catch {
      this.logger.warn('Chưa gửi được email tài khoản sinh viên.');
      return false;
    }
  }

  async sendGrade(grade: GradeEmail): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const origin = this.config
        .getOrThrow<string>('FRONTEND_URL')
        .split(',')[0];
      const url = `${origin}${grade.category === 'specialized' ? `/specialized/assignments/${grade.assignmentId}` : '/lookup'}`;
      const time = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(grade.gradedAt);
      const instructions =
        grade.category === 'specialized'
          ? 'Đăng nhập tài khoản sinh viên để xem bài nộp và điểm.'
          : `Mã biên nhận: ${grade.receiptCode}. Dùng mã bí mật đã nhận khi nộp bài để xem lại bài và điểm.`;
      const subject = `${BRAND_NAME} · Kết quả chấm bài · ${grade.assignment.replace(/[\r\n]/g, ' ')}`;
      return await this.sendMessage({
        to: { name: grade.fullName, address: grade.email },
        subject,
        text: `Chào ${grade.fullName},\n\nSinh viên: ${grade.studentCode}\nBài tập: ${grade.assignment}\nPhiên bản: ${grade.version}\nĐiểm: ${grade.score}/10\nNhận xét: ${grade.feedback || 'Không có nhận xét.'}\nChấm lúc (Việt Nam): ${time}\n\nXem kết quả: ${url}\n${instructions}`,
        html: `<div style="font:15px/1.7 Arial,sans-serif;max-width:620px;margin:auto"><p>${BRAND_NAME}</p><h2>Kết quả chấm bài</h2><p>Chào ${escapeHtml(grade.fullName)},</p><p>Sinh viên: ${escapeHtml(grade.studentCode)}<br>Bài tập: <strong>${escapeHtml(grade.assignment)}</strong><br>Phiên bản: ${grade.version}</p><p style="font-size:24px;font-weight:700">${grade.score}/10</p><h3>Nhận xét</h3><p style="white-space:pre-wrap">${escapeHtml(grade.feedback || 'Không có nhận xét.')}</p><p>Chấm lúc (Việt Nam): ${escapeHtml(time)}</p><p><a href="${escapeHtml(url)}">Xem bài nộp và điểm</a></p><p>${escapeHtml(instructions)}</p></div>`,
      });
    } catch {
      this.logger.warn('Chưa gửi được email báo điểm. Điểm đã được lưu.');
      return false;
    }
  }

  async sendReceipt(receipt: ReceiptEmail): Promise<boolean> {
    if (!this.isConfigured()) return false;
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
      return await this.sendMessage({
        to: { name: receipt.fullName, address: receipt.email },
        subject: `${BRAND_NAME} · Đã nhận bài nộp · ${receipt.assignment.replace(/[\r\n]/g, ' ')}`,
        text: `${BRAND_NAME}\nĐÃ NHẬN BÀI NỘP\n\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nFile đã nhận:\n${files.join('\n')}\n\nXem lại bài tại ${lookupUrl}\nNhập mã biên nhận và mã bí mật ở trên. Không cần tài khoản. Giữ kín email này.`,
        html: `<div style="font:15px/1.6 Arial,sans-serif;max-width:720px;margin:auto"><p style="font-weight:700;color:#1e3a5f">${BRAND_NAME}</p><h2>Đã nhận bài nộp</h2><p>Dùng mã bên dưới để xem lại thông tin và tải bài đã nộp.</p><table>${rows.map(([label, value]) => `<tr><th style="text-align:left;vertical-align:top;padding:6px">${escapeHtml(label)}</th><td style="padding:6px;word-break:break-word">${escapeHtml(value)}</td></tr>`).join('')}</table><h3>File đã nhận</h3><ul>${files.map((file) => `<li>${escapeHtml(file)}</li>`).join('')}</ul><p><a href="${escapeHtml(lookupUrl)}">Xem lại bài đã nộp</a> bằng mã biên nhận và mã bí mật ở trên. Không cần tài khoản.</p><p>Giữ kín email này.</p></div>`,
      });
    } catch {
      // Email failure must never roll back a successfully saved submission.
      this.logger.warn(
        'Chưa gửi được mã tra cứu qua email. Bài nộp đã được lưu.',
      );
      return false;
    }
  }
}
