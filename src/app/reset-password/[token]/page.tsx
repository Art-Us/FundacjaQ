import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { hashToken } from '@/lib/tokens';
import { ResetPasswordForm } from './ResetPasswordForm';

export default async function ResetPasswordPage({ params }: { params: { token: string } }) {
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(params.token) },
  });

  // Only checked once, at load time — if the token dies later while this
  // page is already open, the existing submit-time check in the API route
  // handles that (same as before), so this doesn't need to re-poll.
  const isValid = resetToken && !resetToken.usedAt && resetToken.expiresAt.getTime() > Date.now();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-100 mb-6">Ustaw nowe hasło</h1>
      {isValid ? (
        <ResetPasswordForm token={params.token} />
      ) : (
        <div className="text-center max-w-sm">
          <p className="text-sm text-rose-500 mb-4">
            Sesja zmiany hasła wygasła lub link jest nieprawidłowy. Poproś o nowy link resetujący.
          </p>
          <Link href="/forgot-password" className="text-sm text-slate-400 hover:text-white underline">
            Wyślij nowy link resetujący
          </Link>
        </div>
      )}
    </main>
  );
}