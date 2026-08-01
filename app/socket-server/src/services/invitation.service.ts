import { FRONTEND_URL } from "../config/index.js";
import { getAuthForUser } from "@services/OAuth.service.js";
import { sendEmailWithGmailAuth } from "./email.service.js";

export async function invite(from: string, to: string, subject: string) {
  // Point invitees at the real frontend URL (env-driven) rather than the old
  // hard-coded placeholder IP, which produced a dead link in the email.
  const message = `<p>You have been invited to join a project on Clarity. Open <a href="${FRONTEND_URL}">${FRONTEND_URL}</a> to accept the invitation.</p>`;
  await sendEmailWithGmailAuth(await getAuthForUser(from), to, subject, message);
}
