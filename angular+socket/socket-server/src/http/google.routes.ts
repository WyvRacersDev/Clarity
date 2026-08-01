/**
 * Google / OAuth / Gmail HTTP routes (Phase 6a).
 *
 * Behavior-preserving extraction from `src/index.ts` of:
 *   GET  /auth                    → generate Google consent URL (calendar-connect)
 *   GET  /oauth2callback          → shared OAuth callback (calendar-connect + login)
 *   GET  /auth/google/callback    → alias of the same callback
 *   GET  /gmail/user-info         → token lookup by id
 *   GET  /profile                 → list saved token emails
 *   GET  /test                    → calendar token smoke test
 *   GET  /contacts                → Google People contacts fetch
 *
 * Routes are mounted at the app root (no prefix) in index.ts, so paths are
 * unchanged. The `state=login` vs calendar-connect branching is preserved.
 */
import { Router } from "express";
import { google, calendar_v3 } from "googleapis";
import { FRONTEND_URL } from "../config/index.js";
import {
  getAuthForUser,
  getGlobalOAuthClient,
  loadTokenStore,
  saveUserTokens,
} from "@services/OAuth.service.js";
import { findOrCreateUserFromGoogle, issueJwt } from "@services/auth.service.js";

export const googleRouter: Router = Router();

// === Generate auth URL ===
googleRouter.get("/auth", async (_req: any, res: any) => {
  const authUrl = (await getGlobalOAuthClient()).generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // ensures refresh token is returned
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/drive.metadata.readonly", // add any scopes you want
      "https://www.googleapis.com/auth/contacts.readonly", // Google Contacts read access
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
  });
  res.redirect(authUrl);
});

// === Handle OAuth callback ===
// Shared by two flows, distinguished by the `state` query param:
//   - state absent / not "login"  → calendar-connect (existing behavior;
//     redirects to /dashboard/settings?oauth=success&id=<tokenId>).
//   - state === "login"           → Google LOGIN: find/create the user, link the
//     Google identity, still save API tokens, issue our JWT, and hand it to the
//     frontend as a query param.
async function handleOAuthCallback(req: any, res: any) {
  const code = req.query.code;
  const state = req.query.state;
  try {
    const client = await getGlobalOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // === Get user info ===
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const userInfo = await oauth2.userinfo.get();

    const email = userInfo.data.email;
    if (!email) throw new Error("User email is missing"); //ye hamza iqbal ko kisi din mei poochon ga

    // Persist Google API tokens (calendar/contacts) for BOTH flows.
    const entry = await saveUserTokens(email, tokens);
    console.log("Saved tokens for:", email);

    if (state === "login") {
      // Google LOGIN flow: establish app identity + issue our JWT.
      const sub = userInfo.data.id || email; // Google 'sub'
      const user = await findOrCreateUserFromGoogle({
        sub,
        email,
      });
      // Carry the Google profile photo into the JWT for avatar display.
      const picture = userInfo.data.picture || undefined;
      const token = issueJwt(user, picture);
      console.log("Google login for:", email, "→ user", user.id);
      return res.redirect(
        `${FRONTEND_URL}/auth/callback?token=${encodeURIComponent(token)}`
      );
    }

    // Default: calendar-connect flow (unchanged).
    return res.redirect(`${FRONTEND_URL}/dashboard/settings?oauth=success&&id=${entry.id}`);
  } catch (err) {
    console.error("Error during OAuth callback:", err);
    res.status(500).send("Error retrieving access token");
  }
}

googleRouter.get("/oauth2callback", handleOAuthCallback);
// Convenience alias so a Google client configured with /auth/google/callback works too.
googleRouter.get("/auth/google/callback", handleOAuthCallback);

googleRouter.get("/gmail/user-info", async (req, res) => {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: "Missing id" });

  const tokenStore = await loadTokenStore();

  if (!tokenStore.entries) return res.status(404).json({ error: "No tokens found" });

  // Find email that matches the ID
  const email = Object.keys(tokenStore.entries).find(
    (key) => tokenStore.entries?.[key]?.id === id
  );
  console.log("Lookup for id:", id, "found email:", email);
  if (!email) return res.status(404).json({ error: "User not found for given id" });
  console.log("Returning tokens for email:", email);
  return res.json({
    email,
    tokens: tokenStore.entries[email],
  });
});

// === Example protected route ===
googleRouter.get("/profile", async (_req: any, res: any) => {
  const tokenStore = await loadTokenStore();
  const emails = Object.keys(tokenStore.entries);
  res.json({ savedUsers: emails });
});

googleRouter.get("/test", async (_req: any, res: any) => {
  try {
    const tokenStore = await loadTokenStore();

    // pick one user to test
    const userEmails = Object.keys(tokenStore.entries);
    if (userEmails.length === 0) {
      return res.status(400).send("❌ No saved tokens found. Please log in first.");
    }

    const testEmail = userEmails[0]!;
    const authClient = await getAuthForUser(testEmail);
    if (!(authClient instanceof google.auth.OAuth2)) {
      return res.status(401).send("❌ Auth failed: " + authClient.message);
    }

    // call Google Calendar API
    const calendar = google.calendar({ version: "v3", auth: authClient });
    const events = await calendar.events.list({
      calendarId: "primary",
      maxResults: 5,
      singleEvents: true,
      orderBy: "startTime",
    });

    const upcoming: calendar_v3.Schema$Event[] = events.data.items || [];
    if (upcoming.length === 0) {
      res.send(`✅ Successfully reused tokens for ${testEmail}, but no upcoming events found.`);
    } else {
      res.send({
        message: `✅ Successfully reused tokens for ${testEmail}`,
        events: upcoming.map((e) => e.summary || "No Title"),
      });
    }
  } catch (error: any) {
    console.error("Error reusing tokens:", error);
    res.status(500).send("❌ Failed to reuse tokens. Check console for details.");
  }
});

// === Fetch Google Contacts for a user ===
googleRouter.get("/contacts", async (req: any, res: any) => {
  const userEmail = req.query.email;

  if (!userEmail) {
    return res.status(400).json({ success: false, message: "Email parameter required" });
  }

  console.log(`[Server] Fetching Google Contacts for: ${userEmail}`);

  try {
    const authResult = await getAuthForUser(userEmail);
    if (!(authResult instanceof google.auth.OAuth2)) {
      return res.status(401).json({ success: false, message: authResult.message });
    }

    // Use People API to fetch contacts
    const people = google.people({ version: "v1", auth: authResult });

    const response = await people.people.connections.list({
      resourceName: "people/me",
      pageSize: 1000, // Max contacts to fetch
      personFields: "names,emailAddresses,phoneNumbers",
    });

    const connections = response.data.connections || [];
    console.log(`[Server] Found ${connections.length} contacts for ${userEmail}`);
    // Extract email addresses from contacts
    const contacts = connections
      .filter((person: any) => person.emailAddresses && person.emailAddresses.length > 0)
      .map((person: any) => ({
        name: person.names?.[0]?.displayName || "Unknown",
        email: person.emailAddresses?.[0]?.value || "",
        phone: person.phoneNumbers?.[0]?.value || "",
      }))
      .filter((contact: any) => contact.email); // Only contacts with valid emails

    console.log(`[Server] Extracted ${contacts.length} contacts with emails`);

    res.json({
      success: true,
      contacts,
      message: `Found ${contacts.length} contacts with email addresses`,
    });
  } catch (error: any) {
    console.error("[Server] Error fetching Google Contacts:", error);
    res.status(500).json({
      success: false,
      message: `Failed to fetch contacts: ${error.message}`,
    });
  }
});
