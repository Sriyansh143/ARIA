/**
 * src/lib/business-hours.ts — v61 Phase 2 (Owner Rule: Strict Business Hours)
 *
 * Owner + customer interactions (outreach emails, calls, non-critical
 * notifications) must ONLY occur between 9:00 AM and 6:00 PM according to
 * their respective time zones. Critical system alerts bypass this check.
 *
 * Uses Intl.DateTimeFormat with timeZone option to compute the current
 * hour in the target timezone — no external deps, works in Node 18+.
 */

import "server-only";

export interface BusinessHoursConfig {
  timezone: string;
  hourStart?: number; // default 9 (9 AM)
  hourEnd?: number; // default 18 (6 PM)
}

/**
 * Returns true if "now" is within business hours in the given timezone.
 *
 * Business hours are inclusive of hourStart, exclusive of hourEnd:
 *   hourStart=9, hourEnd=18 → 9:00 AM until 5:59 PM (i.e. 9 ≤ hour < 18)
 *
 * If the timezone is invalid, returns true (fail-open so a typo doesn't
 * silently block all outreach — the error is logged by the caller).
 */
export function isWithinBusinessHours(
  timezone: string,
  hourStart: number = 9,
  hourEnd: number = 18,
): boolean {
  // Normalize timezone — default to UTC if empty/invalid.
  const tz = (timezone ?? "UTC").trim() || "UTC";
  try {
    // Intl.DateTimeFormat returns the hour in the target timezone.
    // formatToParts returns an array like [{type:'hour', value:'14'}, ...]
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === "hour");
    if (!hourPart) return true; // fail-open
    const hour = parseInt(hourPart.value, 10);
    // hour12:false can return "24" for midnight in some runtimes — normalize.
    const normalizedHour = hour === 24 ? 0 : hour;
    return normalizedHour >= hourStart && normalizedHour < hourEnd;
  } catch {
    // Invalid timezone string — fail-open so outreach isn't silently blocked.
    return true;
  }
}

/**
 * Returns the current hour (0-23) in the given timezone, or -1 on error.
 */
export function currentHourInTimezone(timezone: string): number {
  const tz = (timezone ?? "UTC").trim() || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === "hour");
    if (!hourPart) return -1;
    const hour = parseInt(hourPart.value, 10);
    return hour === 24 ? 0 : hour;
  } catch {
    return -1;
  }
}

/**
 * Returns the owner's timezone from env, defaulting to Asia/Kolkata
 * (the owner's configured timezone per the session metadata).
 */
export function getOwnerTimezone(): string {
  return (process.env.OWNER_TIMEZONE ?? "Asia/Kolkata").trim() || "Asia/Kolkata";
}

/**
 * Returns true if the owner is currently within business hours.
 */
export function isWithinOwnerBusinessHours(): boolean {
  return isWithinBusinessHours(getOwnerTimezone());
}

/**
 * Returns a human-readable status string for the daily plan / dashboard.
 * Example: "Within business hours (14:30 IST, 9 AM - 6 PM)"
 *          "Outside business hours (21:15 IST, resumes at 9:00 AM)"
 */
export function businessHoursStatus(timezone?: string): string {
  const tz = timezone ?? getOwnerTimezone();
  const within = isWithinBusinessHours(tz);
  const hour = currentHourInTimezone(tz);
  const tzLabel = tz.split("/").pop()?.replace("_", " ") ?? tz;
  if (within) {
    return `Within business hours (${hour}:00 ${tzLabel}, 9 AM - 6 PM)`;
  }
  // Compute hours until 9 AM tomorrow.
  const hoursUntilOpen = hour < 9 ? 9 - hour : 24 - hour + 9;
  return `Outside business hours (${hour}:00 ${tzLabel}, resumes in ${hoursUntilOpen}h at 9:00 AM)`;
}
