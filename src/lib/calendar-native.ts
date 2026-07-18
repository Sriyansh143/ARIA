// =====================================================================
// calendar-native.ts — Calendar event management (Google Calendar + iCal).
// =====================================================================
// Provides:
//   1. createCalendarEvent  — push an event to Google Calendar via the
//      REST API (requires GOOGLE_ACCESS_TOKEN env var).
//   2. createICalEvent      — generate a standalone .ics string for any
//      calendar system (no external service required). Useful as a
//      fallback when Google isn't configured.
//
// Env vars:
//   GOOGLE_ACCESS_TOKEN   (optional) OAuth bearer for Google Calendar
// =====================================================================

export interface CalendarEventInput {
  title: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  description?: string;
  location?: string;
  attendees?: string[];
}

export interface CalendarEventResult {
  success: boolean;
  eventId?: string;
  htmlLink?: string;
  iCal?: string;
  error?: string;
}

// ─── Create an event on Google Calendar ──────────────────────────────
export async function createCalendarEvent(
  title: string,
  start: string,
  end: string,
  description?: string,
): Promise<{ success: boolean; error?: string }> {
  const full = await createGoogleCalendarEvent({ title, start, end, description });
  if (full.success) return { success: true };
  return { success: false, error: full.error };
}

// ─── Full Google Calendar REST call ──────────────────────────────────
export async function createGoogleCalendarEvent(
  input: CalendarEventInput,
): Promise<CalendarEventResult> {
  const token = process.env.GOOGLE_ACCESS_TOKEN;
  if (!token) {
    return { success: false, error: 'GOOGLE_ACCESS_TOKEN not set' };
  }
  try {
    const body: Record<string, unknown> = {
      summary: input.title,
      description: input.description || '',
      start: { dateTime: input.start },
      end: { dateTime: input.end },
    };
    if (input.location) body.location = input.location;
    if (Array.isArray(input.attendees) && input.attendees.length > 0) {
      body.attendees = input.attendees.map((email) => ({ email }));
    }
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { success: false, error: `Google Calendar API ${res.status}: ${txt.slice(0, 200)}` };
    }
    const d = (await res.json()) as { id?: string; htmlLink?: string };
    return { success: true, eventId: d.id, htmlLink: d.htmlLink };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── Generate a standalone .ics (iCalendar) event string ─────────────
// Useful when Google Calendar isn't configured. The .ics file can be
// imported by any calendar client (Apple Calendar, Outlook, etc.).
export function createICalEvent(input: CalendarEventInput): string {
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const dtStart = new Date(input.start).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const dtEnd = new Date(input.end).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const escapeText = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//JARVIS//Mission Control//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${dtStamp}-${Math.random().toString(36).slice(2)}@jarvis.local`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeText(input.title)}`,
  ];
  if (input.description) lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeText(input.location)}`);
  if (Array.isArray(input.attendees) && input.attendees.length > 0) {
    for (const email of input.attendees) {
      lines.push(`ATTENDEE:mailto:${email}`);
    }
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

// ─── List Google Calendar events (upcoming) ──────────────────────────
export async function listGoogleCalendarEvents(opts?: {
  maxResults?: number;
  timeMin?: string; // ISO 8601
}): Promise<{ success: boolean; events?: any[]; error?: string }> {
  const token = process.env.GOOGLE_ACCESS_TOKEN;
  if (!token) return { success: false, error: 'GOOGLE_ACCESS_TOKEN not set' };
  try {
    const max = Math.min(opts?.maxResults ?? 25, 250);
    const timeMin = encodeURIComponent(opts?.timeMin || new Date().toISOString());
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${max}&timeMin=${timeMin}&orderBy=startTime&singleEvents=true`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { success: false, error: `Google Calendar API ${res.status}` };
    const d = (await res.json()) as { items?: any[] };
    return { success: true, events: d.items || [] };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
