export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

class ConsoleEmailSender implements EmailSender {
  async send(to: string, subject: string, body: string): Promise<void> {
    console.log(`\n[email:stub] To: ${to}\nSubject: ${subject}\n\n${body}\n`);
  }
}

// Swap this for a real provider (Resend/SMTP) once credentials are available;
// nothing else in the codebase needs to change.
const emailSender: EmailSender = new ConsoleEmailSender();

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
