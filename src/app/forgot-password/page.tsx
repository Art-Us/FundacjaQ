import { KeyRound } from 'lucide-react';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm border border-slate-200/80">
        <div className="text-center mb-6">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mb-4 shadow-xs">
            <KeyRound className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Reset hasła</h1>
          <p className="text-xs text-slate-500 mt-2">
            Podaj adres email powiązany z Twoim kontem.
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
