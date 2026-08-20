// /api/auth/signup — POST: create a new user account (multi-tenant mode).
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body?.email ?? '').toLowerCase().trim();
    const password = String(body?.password ?? '');
    const name = body?.name ? String(body.name).slice(0, 128) : null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: 'Invalid email' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ ok: false, error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ ok: false, error: 'Email already registered' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.create({
      data: {
        email,
        name: name ?? email.split('@')[0],
        passwordHash,
        role: 'owner', // First self-signup user becomes owner of their own tenancy
        emailVerified: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
