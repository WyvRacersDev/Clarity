import { google } from "googleapis";
import fs from "fs";
import path from "path";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

// Load credentials from JSON file
const credentials = JSON.parse(
  fs.readFileSync(path.join(__dirname, "credentials.json"), "utf8")
);

const { client_secret, client_id, redirect_uris } = credentials.web;

export const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

// Generate the URL for user consent
export function getAuthUrl() {
  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

