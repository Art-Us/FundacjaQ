import { ForgotPasswordForm } from './ForgotPasswordForm';

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-100 mb-2">Reset hasła</h1>
      <p className="text-sm text-slate-400 mb-6 text-center max-w-sm">
        Podaj adres email powiązany z Twoim kontem.
      </p>
      <ForgotPasswordForm />
    </main>
  );
}
