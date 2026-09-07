import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

// A real <a> (via next/link), not a <button> with an onClick — this only ever
// navigates, it doesn't perform an action, so it belongs on the semantic
// element browsers/screen readers/crawlers expect for that (works without JS,
// supports open-in-new-tab, gets included in the tab order as a link).
// Points at a fixed, known-public destination rather than router.back() /
// history — the caller's own history could be empty (direct link, opened in
// a new tab) or point somewhere stale (an already-consumed invite/reset
// token), so "back" is not guaranteed to be /login the way this literal href is.
//
// Positioned absolutely within the card, not fixed to the viewport — the
// nearest ancestor with `relative` (the card wrapper on each page that
// renders this) is what it's anchored to.
export function BackToLoginButton() {
  return (
    <Link
      href="/login"
      aria-label="Powrót do logowania"
      title="Powrót do logowania"
      className="absolute top-4 left-4 z-10 flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-slate-50 transition"
    >
      <ArrowLeft className="h-5 w-5" />
    </Link>
  );
}
