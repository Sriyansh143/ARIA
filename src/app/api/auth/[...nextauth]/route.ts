// /api/auth/[...nextauth] — NextAuth v4 handler.
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
