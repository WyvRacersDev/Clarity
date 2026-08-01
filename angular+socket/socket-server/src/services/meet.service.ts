/**
 * Meet service — mint ONE shared call link so everyone in a conversation joins
 * the same room (E5). Two providers, tried in order:
 *
 *   1. Google Meet  — if the initiator has a connected Google account, create a
 *      short Calendar event with a `hangoutsMeet` conference and read back its
 *      `hangoutLink`. This is the real, first-class path (reuses the existing
 *      OAuth/token store + calendar scope).
 *   2. Jitsi        — fallback when there is no Google token (or the API call
 *      fails): a random `meet.jit.si/clarity-…` room needs no auth and is still
 *      a single shared room for everyone. Guarantees the feature always works.
 *
 * Transport-agnostic: callers pass the initiator's email + a human label and get
 * back `{ url, provider }`. Posting the link into chat is the gateway's job.
 */
import { google } from "googleapis";
import { getAuthForUser } from "@services/OAuth.service.js";

export interface SharedCall {
  url: string;
  provider: "meet" | "jitsi";
}

/** A no-auth shared room — used whenever Google Meet can't be minted. */
function jitsiRoom(): SharedCall {
  const slug = `clarity-${Math.random().toString(36).slice(2, 10)}`;
  return { url: `https://meet.jit.si/${slug}`, provider: "jitsi" };
}

/**
 * Create a shared call link for `label`, preferring the initiator's Google Meet
 * and falling back to a Jitsi room. Never throws — a failure degrades to Jitsi.
 */
export async function createSharedCallLink(
  email: string | undefined,
  label: string
): Promise<SharedCall> {
  if (!email) return jitsiRoom();
  try {
    const auth = await getAuthForUser(email);
    if (!(auth instanceof google.auth.OAuth2)) return jitsiRoom();

    const calendar = google.calendar({ version: "v3", auth });
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 60 * 1000); // 30-min placeholder slot
    const requestId = `clarity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const event = await calendar.events.insert({
      calendarId: "primary",
      conferenceDataVersion: 1,
      requestBody: {
        summary: `Clarity call — ${label}`,
        description: "Shared call created from Clarity chat.",
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });

    const url =
      event.data.hangoutLink ||
      event.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
    if (!url) return jitsiRoom();
    return { url, provider: "meet" };
  } catch (err) {
    console.error("[Meet] createSharedCallLink failed, falling back to Jitsi:", err);
    return jitsiRoom();
  }
}
