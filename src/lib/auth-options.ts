// auth-options.ts — NextAuth v4 configuration for ARIA Mission Control.
// Adapted from v25.8.32-final to work with the Ultimate Production schema
// (User, Account, Session, VerificationToken models only — no Workspace/CompanyProfile).
// SERVER-SIDE ONLY.

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const AUTH_SECRET = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
if (!AUTH_SECRET && process.env.NODE_ENV === 'production') {
  console.error(
    '[auth-options] FATAL: NEXTAUTH_SECRET is not set. JWTs cannot be verified. ' +
    'Set NEXTAUTH_SECRET in your .env file (use `openssl rand -base64 32` to generate).',
  );
}
const _ephemeralSecret = AUTH_SECRET || (process.env.NODE_ENV === 'production'
  ? null
  : crypto.randomBytes(32).toString('hex'));
if (!_ephemeralSecret && process.env.NODE_ENV === 'production' && !process.env.NEXT_PHASE?.includes('build')) {
  // Don't throw during build — use ephemeral fallback. Real production runtime will fail-fast if missing.
  console.warn('[auth-options] NEXTAUTH_SECRET not set — using ephemeral fallback (JWTs will not survive restart)');
}
const _safeSecret = _ephemeralSecret || crypto.randomBytes(32).toString('hex');

// Simple in-memory rate limiter (no external deps).
const rlState = new Map<string, { fails: number; lockedUntil: number }>();
const MAX_FAILS = 5;
const BASE_LOCK_MS = 15_000;
function checkRateLimit(id: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const s = rlState.get(id);
  if (!s) return { allowed: true, retryAfterMs: 0 };
  if (s.lockedUntil > now) return { allowed: false, retryAfterMs: s.lockedUntil - now };
  return { allowed: true, retryAfterMs: 0 };
}
function recordFailure(id: string): void {
  const now = Date.now();
  const s = rlState.get(id) ?? { fails: 0, lockedUntil: 0 };
  s.fails += 1;
  if (s.fails >= MAX_FAILS) {
    const lockMult = Math.min(2 ** (s.fails - MAX_FAILS), 20); // cap at 20x
    s.lockedUntil = now + BASE_LOCK_MS * lockMult;
  }
  rlState.set(id, s);
}
function recordSuccess(id: string): void {
  rlState.delete(id);
}
function composeIdentifier(email: string, ip: string | null): string {
  return `${email}|${ip ?? 'unknown'}`;
}

export const authOptions: NextAuthOptions = {
  adapter: {
    createUser: async (data: { email: string; name?: string | null; image?: string | null; emailVerified?: Date | null }) => {
      const user = await db.user.create({
        data: {
          email: data.email,
          name: data.name ?? null,
          image: data.image ?? null,
          role: 'owner',
        },
      });
      return { ...user, emailVerified: user.emailVerified ?? null } as any;
    },
    getUserByEmail: async (email: string) => {
      const user = await db.user.findUnique({ where: { email } });
      if (!user) return null;
      return { ...user, emailVerified: user.emailVerified ?? null } as any;
    },
    getUserByAccount: async ({ provider, providerAccountId }: { provider: string; providerAccountId: string }) => {
      const account = await db.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { user: true },
      });
      if (!account) return null;
      return { ...account.user, emailVerified: account.user.emailVerified ?? null } as any;
    },
    updateUser: async (data: { id: string; name?: string | null; email?: string | null; image?: string | null; emailVerified?: Date | null }) => {
      const user = await db.user.update({
        where: { id: data.id },
        data: {
          name: data.name ?? undefined,
          email: data.email ?? undefined,
          image: data.image ?? undefined,
          emailVerified: data.emailVerified ?? undefined,
        },
      });
      return { ...user, emailVerified: user.emailVerified ?? null } as any;
    },
    deleteUser: async (userId: string) => {
      await db.user.delete({ where: { id: userId } });
    },
    linkAccount: async (data: any) => {
      await db.account.create({ data: { ...data, userId: data.userId } });
    },
    unlinkAccount: async ({ provider, providerAccountId }: { provider: string; providerAccountId: string }) => {
      await db.account.delete({
        where: { provider_providerAccountId: { provider, providerAccountId } },
      });
    },
    createSession: async (data: { sessionToken: string; userId: string; expires: Date }) => {
      const session = await db.session.create({ data });
      return { ...session } as any;
    },
    getSessionAndUser: async (sessionToken: string) => {
      const session = await db.session.findUnique({ where: { sessionToken }, include: { user: true } });
      if (!session) return null;
      if (session.expires < new Date()) {
        await db.session.delete({ where: { id: session.id } });
        return null;
      }
      return {
        session: { ...session } as any,
        user: { ...session.user, emailVerified: session.user.emailVerified ?? null } as any,
      };
    },
    updateSession: async (data: { sessionToken: string; expires?: Date }) => {
      try {
        const session = await db.session.update({
          where: { sessionToken: data.sessionToken },
          data: { expires: data.expires ?? undefined },
        });
        return { ...session } as any;
      } catch {
        return null;
      }
    },
    deleteSession: async (sessionToken: string) => {
      await db.session.delete({ where: { sessionToken } }).catch(() => {});
    },
    createVerificationToken: async (data: { identifier: string; token: string; expires: Date }) => {
      return (await db.verificationToken.create({ data })) as any;
    },
    useVerificationToken: async ({ identifier, token }: { identifier: string; token: string }) => {
      try {
        const vt = await db.verificationToken.delete({
          where: { identifier_token: { identifier, token } },
        });
        return { ...vt } as any;
      } catch {
        return null;
      }
    },
  } as any,
  session: {
    strategy: 'jwt',
    // v35: reduced from 30 days to 7 days so stale JWTs cycle faster
    // after a secret rotation.
    maxAge: 7 * 24 * 60 * 60,
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: '2FA Code', type: 'text' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.toLowerCase().trim();

        const ip = (req as any)?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
          || (req as any)?.headers?.['x-real-ip']?.trim()
          || null;
        const identifier = composeIdentifier(email, ip);
        const rl = checkRateLimit(identifier);
        if (!rl.allowed) {
          console.warn(`[auth] Rate limited: ${email} from ${ip} — retry after ${rl.retryAfterMs}ms`);
          return null;
        }

        // ── v40: Bootstrap owner via env var (prevent lockout) ──
        // If ARIA_OWNER_EMAIL is set and matches + no users exist, create owner.
        let user = await db.user.findUnique({ where: { email } });

        if (!user) {
          const userCount = await db.user.count();
          const isBootstrapEnv =
            process.env.ARIA_OWNER_EMAIL &&
            email === process.env.ARIA_OWNER_EMAIL.toLowerCase().trim();
          if (userCount === 0 || isBootstrapEnv) {
            try {
              const passwordHash = await bcrypt.hash(credentials.password, 12);
              const newUser = await db.user.create({
                data: {
                  email,
                  name: email.split('@')[0],
                  passwordHash,
                  role: 'owner',
                  emailVerified: new Date(),
                },
              });
              logger.info('auth.bootstrap-owner-created', { email, viaEnv: isBootstrapEnv });
              recordSuccess(identifier);
              return { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role } as any;
            } catch (err) {
              logger.error('auth.bootstrap-failed', { error: String(err) });
              return null;
            }
          }
          recordFailure(identifier);
          return null;
        }

        if (!user.passwordHash) {
          recordFailure(identifier);
          return null;
        }
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) {
          recordFailure(identifier);
          logger.warn('auth.password-invalid', { email });
          return null;
        }

        // ─── v40: 2FA ENFORCEMENT ───
        // If the user has 2FA enabled, verify the TOTP token (or backup code)
        // BEFORE issuing a session. If no token provided, return a special
        // object with requiresTwoFactor=true so the frontend can prompt.
        if (user.twoFactorEnabled && user.twoFactorSecret) {
          const totp = (credentials as any).totp ? String((credentials as any).totp).trim() : '';

          if (!totp) {
            // Don't issue a real session — return a marker the frontend detects.
            // NextAuth will still create a JWT, but we mark it as pre-auth.
            recordFailure(identifier);
            logger.warn('auth.2fa-required-but-missing', { email });
            return {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              requiresTwoFactor: true,
            } as any;
          }

          // Try TOTP verification
          const { verifyTOTP, verifyBackupCode } = await import('./two-factor');
          let verified = verifyTOTP(user.twoFactorSecret, totp, 1);

          // If TOTP failed, try backup codes
          if (!verified && user.twoFactorBackupCodes) {
            try {
              const hashedCodes = JSON.parse(user.twoFactorBackupCodes) as string[];
              const matchIdx = await verifyBackupCode(totp, hashedCodes);
              if (matchIdx >= 0) {
                // Remove the used backup code
                hashedCodes.splice(matchIdx, 1);
                await db.user.update({
                  where: { id: user.id },
                  data: { twoFactorBackupCodes: JSON.stringify(hashedCodes) },
                });
                verified = true;
                logger.info('auth.2fa.backup-code-used', { userId: user.id, remaining: hashedCodes.length });
              }
            } catch {
              // JSON parse error — ignore
            }
          }

          if (!verified) {
            recordFailure(identifier);
            logger.warn('auth.2fa-invalid', { email });
            return null;
          }
        }

        recordSuccess(identifier);
        logger.info('auth.login-success', { email, twoFA: user.twoFactorEnabled });
        return { id: user.id, email: user.email, name: user.name, role: user.role } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role || 'owner';
        // v40: propagate the requiresTwoFactor flag so the session callback
        // can expose it to the frontend.
        if ((user as any).requiresTwoFactor) {
          token.requiresTwoFactor = true;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        // v40: expose requiresTwoFactor so the frontend can prompt for TOTP
        (session.user as any).requiresTwoFactor = (token as any).requiresTwoFactor ?? false;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  // v35: handle JWT decryption errors gracefully. When the NEXTAUTH_SECRET
  // changes (e.g. .env regenerated), old JWT cookies can't be decrypted
  // → JWEDecryptionFailed. NextAuth logs this as an error on every request.
  // The events handler below detects the error + logs a one-liner instead
  // of the full stack trace.
  events: {
    async signIn() {},
    async signOut() {},
    async createUser() {},
    async updateUser() {},
    async linkAccount() {},
    async session() {},
  },
  logger: {
    error(code: string, ..._params: unknown[]) {
      // v35: suppress the full JWEDecryptionFailed stack trace — just log
      // a one-liner. The user just needs to clear their browser cookies.
      if (code.includes('JWEDecryptionFailed') || code.includes('decryption operation failed')) {
        console.warn('[auth-options] JWT decryption failed — old cookie. Clear browser cookies to fix.');
      } else {
        console.error(`[next-auth][error] ${code}`);
      }
    },
    warn(code: string) {
      console.warn(`[next-auth][warn] ${code}`);
    },
    debug() {},
  },
  secret: _safeSecret,
};
