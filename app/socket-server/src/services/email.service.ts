/**
 * EmailService — the single email boundary for the app.
 *
 * Consolidates the two byte-for-byte copies that previously lived in
 * `notification.service.ts` and `invitation.service.ts`:
 *   - an app-password SMTP transport (task-due reminder emails), and
 *   - a Gmail-API sender that sends AS a user via their OAuth client (invites).
 *
 * The transport is created lazily so `GOOGLE_APP_*` only needs to be present by
 * the time the first email is sent (after env is loaded), not at import time.
 */
import { google } from "googleapis";
import nodemailer from "nodemailer";
import { env } from "process";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: env.GOOGLE_APP_USER,
        pass: env.GOOGLE_APP_PASSWORD, // app password (not the real password)
      },
    });
  }
  return transporter;
}

/** Send a simple HTML email from the Clarity app account (SMTP app password). */
export async function sendAppEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  await getTransporter().sendMail({
    from: `Clarity <${env.GOOGLE_APP_USER}>`,
    to,
    subject,
    html,
  });
}

/**
 * Send an HTML email AS a user through the Gmail API, using an already-resolved
 * OAuth2 client (`auth`). Used for project invites where the "from" is the
 * inviting user, not the app account.
 */
export async function sendEmailWithGmailAuth(
  auth: any,
  to: string,
  subject: string,
  message: string
): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth });

  const email = [
    `To: ${to}`,
    "Subject: " + subject,
    "Content-Type: text/html; charset=UTF-8",
    "",
    message,
  ].join("\n");

  const encodedMessage = Buffer.from(email)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedMessage,
    },
  });
}
