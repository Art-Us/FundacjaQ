import { ResetPasswordForm } from './ResetPasswordForm';

export default function ResetPasswordPage({ params }: { params: { token: string } }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-100 mb-6">Ustaw nowe hasło</h1>
      <ResetPasswordForm token={params.token} />
    </main>
  );
}
