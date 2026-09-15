import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Postgres's (I)LIKE treats `%` and `_` as wildcards even when the value
// arrives as a bound parameter — that's pattern-matching semantics applied at
// match time, not a SQL-injection concern. Left unescaped, searching for a
// value containing a literal underscore (e.g. an email local-part like
// "jan_kowalski@…") would also match "jan.kowalski@…", "janXkowalski@…", etc.
// Escaping with the backslash Postgres's LIKE/ILIKE already treats as its
// default escape character makes a Prisma `contains` match the literal
// substring the caller typed.
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
