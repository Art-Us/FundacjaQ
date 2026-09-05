import { UserPlus, AlertCircle } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { hashToken } from '@/lib/tokens';
import { AcceptInviteForm } from './AcceptInviteForm';

export default async function InvitePage({ params }: { params: { token: string } }) {
  const invite = await prisma.inviteToken.findUnique({
    where: { tokenHash: hashToken(params.token) },
  });

  const isValid = invite && !invite.usedAt && !invite.revokedAt && invite.expiresAt.getTime() > Date.now();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm border border-slate-200/80">
        <div className="text-center mb-6">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mb-4 shadow-xs">
            <UserPlus className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dołącz do QFundation</h1>
        </div>
        {isValid ? (
          <>
            <p className="text-xs text-slate-500 mb-6 text-center">
              Zapraszamy, {invite!.email}. Ustaw hasło, aby aktywować konto.
            </p>
            <AcceptInviteForm token={params.token} />
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-2xl bg-red-50 p-3 border border-red-200 text-red-700 text-xs font-medium">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <span>Link zaproszenia jest nieprawidłowy, wygasł lub został unieważniony. Skontaktuj się z administratorem.</span>
          </div>
        )}
      </div>
    </main>
  );
}
