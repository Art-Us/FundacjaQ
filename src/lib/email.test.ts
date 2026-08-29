import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

const ORIGINAL_ENV = { ...process.env };

describe('email sending', () => {
  beforeEach(() => {
    vi.resetModules();
    sendMailMock.mockReset().mockResolvedValue({ messageId: '<test@example.com>', response: '250 OK', accepted: ['to@example.com'], rejected: [] });
    createTransportMock.mockClear();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SMTP_HOST;
  });

  it('falls back to logging to the console when SMTP_HOST is not configured', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { sendInviteEmail } = await import('./email');
    await sendInviteEmail('user@example.com', 'https://example.com/invite/abc');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('user@example.com'));
    expect(sendMailMock).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('sends the invite email via SMTP once SMTP_HOST is configured', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASSWORD = 'secret';
    process.env.SMTP_FROM = 'QFundation <no-reply@example.com>';

    const { sendInviteEmail } = await import('./email');
    await sendInviteEmail('volunteer@example.com', 'https://example.com/invite/abc');

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        auth: { user: 'user@example.com', pass: 'secret' },
      })
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'QFundation <no-reply@example.com>',
        to: 'volunteer@example.com',
        subject: expect.stringContaining('Zaproszenie'),
        text: expect.stringContaining('https://example.com/invite/abc'),
      })
    );
  });

  it('sends the password reset email via SMTP with the right subject', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';

    const { sendPasswordResetEmail } = await import('./email');
    await sendPasswordResetEmail('user@example.com', 'https://example.com/reset/abc');

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('Reset hasła') })
    );
  });

  it('does not throw when the SMTP send fails (logs instead)', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    sendMailMock.mockRejectedValue(new Error('connection refused'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { sendPasswordResetEmail } = await import('./email');

    await expect(sendPasswordResetEmail('user@example.com', 'https://example.com/reset/abc')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('logs a warning when the SMTP server accepts the connection but rejects the recipient', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    sendMailMock.mockResolvedValue({
      messageId: '<test@example.com>',
      response: '250 OK',
      accepted: [],
      rejected: ['nobody@example.com'],
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { sendInviteEmail } = await import('./email');
    await sendInviteEmail('nobody@example.com', 'https://example.com/invite/abc');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('nobody@example.com'));
    errorSpy.mockRestore();
  });

  it('falls back to SMTP_USER as the from address when SMTP_FROM is not set', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user@example.com';

    const { sendInviteEmail } = await import('./email');
    await sendInviteEmail('volunteer@example.com', 'https://example.com/invite/abc');

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'user@example.com' }));
  });
});