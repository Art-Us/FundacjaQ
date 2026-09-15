'use client';

import { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}

// Toggling `visible` only swaps the input's `type` between "password" and
// "text" — that changes how the browser renders the field, nothing else. The
// value was already a plain string sitting in React state and gets submitted
// as plain text either way, so showing it changes nothing about what leaves
// the browser or how the account is secured.
export function PasswordInput({ id, value, onChange, autoComplete, required, minLength }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl bg-slate-50 border border-slate-200 py-3 pl-10 pr-10 text-slate-900 placeholder-slate-400 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 text-sm transition"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Ukryj hasło' : 'Pokaż hasło'}
        aria-pressed={visible}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
