import type { Prisma } from '@prisma/client';

// The single Prisma `include` shape behind every alert the map renders —
// shared by the /map server page (initial fetch), AlertsMapView (its prop
// type) and the /alerty/[alertId] detail page, so the three can never drift apart.
//
// author/gmina use an explicit `select`, never `include: true`/`gmina: true`:
// `include` returns every scalar on the related row, and for User that means
// passwordHash, email, phone, failedAttempts, lockedUntil, deactivationReason.
// This whole payload is passed straight into a 'use client' component, i.e.
// serialized into the RSC response of /map for every signed-in user, VOLUNTEER
// included — so only the fields the cards/markers actually render (author
// name + organization name, gmina name + coordinates) may appear here.
// lib/alertInclude.test.ts pins this shape so a future `author: true` can't
// slip back in unnoticed.
//
// Plain object with a type-only import, deliberately no 'use client' and no
// runtime dependency on prisma/next-auth — it has to be importable from both
// a server component and the client bundle.
export const alertInclude = {
  gmina: { select: { id: true, name: true, latitude: true, longitude: true } },
  author: {
    select: {
      id: true,
      name: true,
      organization: { select: { id: true, name: true } },
    },
  },
  needs: {
    include: {
      allocations: {
        include: {
          donorOrg: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      },
    },
  },
  // Total journal entries + replies (Крок 58) — feeds the "Forum" icon badge
  // on each card.
  _count: { select: { messages: true } },
} satisfies Prisma.AlertInclude;

export type AlertWithRelations = Prisma.AlertGetPayload<{ include: typeof alertInclude }>;
