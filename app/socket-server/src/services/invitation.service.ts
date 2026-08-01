import { SHARED_SERVER, SERVER_PORT } from "../config/index.js";
import { getAuthForUser } from "@services/OAuth.service.js";
import { sendEmailWithGmailAuth } from "./email.service.js";

export async function invite(from: string, to: string, subject: string) {
  const message = `<p>You have been invited to join the project. Enter ${SHARED_SERVER}:${SERVER_PORT} to accept the invitation.</p>`;
  await sendEmailWithGmailAuth(await getAuthForUser(from), to, subject, message);
}
