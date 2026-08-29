import nodemailer from 'nodemailer';

export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

class ConsoleEmailSender implements EmailSender {
  async send(to: string, subject: string, body: string): Promise<void> {
    console.log(`\n[email:stub] To: ${to}\nSubject: ${subject}\n\n${body}\n`);
  }
}

class SmtpEmailSender implements EmailSender {
  private transporter: ReturnType<typeof nodemailer.createTransport>;
  private from: string;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
    this.from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'no-reply@localhost';
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    // Never let a broken mail server turn into a 500 for the caller — invite
    // creation still returns the link for the admin to copy manually, and
    // forgot-password must keep returning its generic response either way
    // (a thrown error here would otherwise leak which requests hit a real,
    // active account).
    try {
      const info = await this.transporter.sendMail({ from: this.from, to, subject, text: body });
      console.log(`[email] accepted by SMTP server for ${to} (messageId: ${info.messageId}): ${info.response}`);
      if (info.rejected.length > 0) {
        console.error(`[email] SMTP server rejected some recipients: ${info.rejected.join(', ')}`);
      }
    } catch (err) {
      console.error('[email] failed to send via SMTP:', err);
    }
  }
}

// Swap-free by design: SMTP is used once SMTP_HOST is configured, otherwise
// falls back to logging to the console (dev default, nothing to set up).
export const isEmailConfigured = Boolean(process.env.SMTP_HOST);
const emailSender: EmailSender = isEmailConfigured ? new SmtpEmailSender() : new ConsoleEmailSender();

export async function sendInviteEmail(to: string, inviteUrl: string): Promise<void> {
  await emailSender.send(
    to,
    'Zaproszenie do QFundation',
    `Zostałeś zaproszony do systemu QFundation. Ustaw hasło pod adresem:\n${inviteUrl}\n\nLink jest jednorazowy i wygasa po 48 godzinach.`
  );
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await emailSender.send(
    to,
    'Reset hasła QFundation',
    `Otrzymaliśmy prośbę o reset hasła. Jeśli to Ty, kliknij:\n${resetUrl}\n\nLink jest jednorazowy i wygasa po 30 minutach. Jeśli to nie Ty, zignoruj tę wiadomość.`
  );
}