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
      <h1 className="text-2xl font-bold text-slate-100 mb-2">Dołącz do QFundation</h1>
      {isValid ? (
        <>
          <p className="text-sm text-slate-400 mb-6 text-center max-w-sm">
            Zapraszamy, {invite!.email}. Ustaw hasło, aby aktywować konto.
          </p>
          <AcceptInviteForm token={params.token} />
        </>
      ) : (
        <p className="text-sm text-rose-500">Link zaproszenia jest nieprawidłowy, wygasł lub został unieważniony. Skontaktuj się z administratorem.</p>
      )}
    </main>
  );
}
