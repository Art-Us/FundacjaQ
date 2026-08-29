import { getServerSession } from 'next-auth';
import { authOptions } from './auth';

export interface AuthorizedUser {
  id: string;
  role: string;
  gminaId: string | null;
}

/** Returns the current session user if they're ADMIN or COORDINATOR, otherwise null. */
export async function requireAdminOrCoordinator(): Promise<AuthorizedUser | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'COORDINATOR')) {
    return null;
  }
  return user;
}