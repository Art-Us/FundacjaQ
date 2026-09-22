'use client';

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

interface DynamicClientOnlyOptions {
  loading: () => ReactNode;
}

// A `next/dynamic(loader, { ssr: false })` replacement for modules that touch
// `window`/`document` at import time (Leaflet does) and so can never be
// evaluated on the server — but WITHOUT `next/dynamic`'s `React.lazy` +
// `Suspense` wrapping.
//
// That wrapping is not free: Suspense's own "hide this subtree, then
// re-run its layout effects once the lazy import resolves" bookkeeping
// (`reappearLayoutEffects` in React's source) turned one real react-leaflet
// lifecycle bug (fixed separately — see patches/react-leaflet+*.patch) into a
// cascading crash that corrupted React's own hook accounting and, through
// that, the Next.js router's segment cache — not a plain component-level
// error the nearest error boundary could cleanly contain. Rare in production,
// far more reachable in dev, where Fast Refresh / on-demand route compilation
// can retry a mount while an earlier attempt is still mid-flight.
//
// A plain `useEffect` never runs during SSR, so wrapping the dynamic
// `import()` in one gets the exact same "browser-only" guarantee `ssr: false`
// does, through ordinary state, not Suspense — so that whole failure
// mode is structurally absent here, not just less likely.
export function dynamicClientOnly<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  { loading }: DynamicClientOnlyOptions
) {
  return function DynamicClientOnly(props: P) {
    const [Component, setComponent] = useState<ComponentType<P> | null>(null);

    useEffect(() => {
      let active = true;
      loader().then((mod) => {
        if (active) setComponent(() => mod.default);
      });
      return () => {
        active = false;
      };
      // `loader` is a fresh closure on every render by construction (an
      // inline `() => import('./X')` at the call site) — depending on it
      // would re-trigger the import every render. It never legitimately
      // changes for a given call site, same assumption next/dynamic itself
      // makes about its `loader` argument.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!Component) return <>{loading()}</>;
    return <Component {...props} />;
  };
}
