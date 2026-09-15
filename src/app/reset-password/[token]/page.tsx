import Link from 'next/link';
import { KeyRound, AlertCircle } from 'lucide-react';
import { BackToLoginButton } from '@/components/ui/BackToLoginButton';
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
      <div className="relative w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm border border-slate-200/80">
        <BackToLoginButton />
        <div className="text-center mb-6">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mb-4 shadow-xs">
            <KeyRound className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Ustaw nowe hasło</h1>
        </div>
        {isValid ? (
          <ResetPasswordForm token={params.token} />
        ) : (
          <div className="text-center space-y-4">
            <div className="flex items-start gap-2 rounded-2xl bg-red-50 p-3 border border-red-200 text-red-700 text-xs font-medium text-left">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>Sesja zmiany hasła wygasła lub link jest nieprawidłowy. Poproś o nowy link resetujący.</span>
            </div>
            <Link href="/forgot-password" className="text-xs text-slate-500 hover:text-indigo-600 underline transition-colors">
              Wyślij nowy link resetujący
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}