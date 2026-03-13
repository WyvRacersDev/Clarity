import { google } from "googleapis";
import { getAuthForUser } from "@services/OAuth.service.js";

/**
 * Create a Google Calendar event for a scheduled task
 * @param userEmail User's email (used to get OAuth tokens)
 * @param taskName Name of the task (used as event summary)
 * @param taskTime ISO timestamp string for the task
 * @returns Promise with event ID or error
 */
export async function createCalendarEvent(
  userEmail: string,
  taskName: string,
  taskTime: string
): Promise<{ success: boolean; eventId?: string; message: string }> {
  try {
    console.log(`[CalendarService] Creating calendar event for ${userEmail}: "${taskName}" at ${taskTime}`);

  //   // Load credentials
  //   if (!fs.existsSync(CREDENTIALS_PATH)) {
  //     return {
  //       success: false,
  //       message: "Google credentials not found"
  //     };
  //   }

  //   const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  //   const { client_secret, client_id, redirect_uris } = credentials.web;

  //   // Load tokens
  //   if (!fs.existsSync(TOKEN_PATH)) {
  //     return {
  //       success: false,
  //       message: "OAuth tokens not found. User needs to authenticate."
  //     };
  //   }

  //   const allTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  //   const tokens = allTokens.entries[userEmail];
  //  if (!tokens) {
  //     return {
  //       success: false,
  //       message: `No OAuth tokens found for user: ${userEmail}`
  //     };
  //   }

  //   // Create OAuth client
  //   const oAuth2Client = new google.auth.OAuth2(
  //     client_id,
  //     client_secret,
  //     redirect_uris[0]
  //   );
  //   oAuth2Client.setCredentials(tokens);
    const authResult = await getAuthForUser(userEmail);
    if (!(authResult instanceof google.auth.OAuth2)) {
      return {
        success: false,
        message: "Failed to get OAuth client: " + authResult.message
      };
    }
    // Create Calendar API client
    const calendar = google.calendar({ version: "v3", auth: authResult });

    // Parse task time
    const taskDate = new Date(taskTime);
    if (isNaN(taskDate.getTime())) {
      return {
        success: false,
        message: `Invalid task time: ${taskTime}`
      };
    }
   // Create event with 1 hour duration (default)
    const eventStartTime = taskDate.toISOString();
    const eventEndTime = new Date(taskDate.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour later

    const event = {
      summary: taskName,
      description: `Task from Clarity: ${taskName}`,
      start: {
        dateTime: eventStartTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      },
      end: {
        dateTime: eventEndTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 30 },
          { method: "popup", minutes: 15 },
        ],
      },
    };

    console.log(`[CalendarService] Creating event:`, event);
 const response = await calendar.events.insert({
      calendarId: "primary",
      requestBody: event,
    });

    const eventId = response.data.id;
    console.log(`[CalendarService] ✓ Calendar event created successfully. Event ID: ${eventId}`);
    if(!eventId) {
      return {
        success: false,
        message: "Failed to retrieve event ID after creation"
      };
    }
    return {
      success: true,
      eventId: eventId,
      message: `Calendar event created successfully`
    };

  } catch (error: any) {
    console.error(`[CalendarService] Error creating calendar event:`, error);
    return {
      success: false,
      message: `Failed to create calendar event: ${error.message}`
    };
  }
}
/**
 * Delete a Google Calendar event
 * @param userEmail User's email
 * @param eventId Calendar event ID
 */
export async function deleteCalendarEvent(
  userEmail: string,
  eventId: string
): Promise<{ success: boolean; message: string }> {
  try {
    console.log(`[CalendarService] Deleting calendar event ${eventId} for ${userEmail}`);

    const authResult = await getAuthForUser(userEmail);
    if (!(authResult instanceof google.auth.OAuth2)) {
      return {
        success: false,
        message: "Failed to get OAuth client: " + authResult.message
      };
    }

    const calendar = google.calendar({ version: "v3", auth: authResult });
    console.log("Deleting event with ID:", eventId);

    await calendar.events.delete({
      calendarId: "primary",
      eventId: eventId,
    });
  console.log(`[CalendarService] ✓ Calendar event deleted successfully: ${eventId}`);
    return {
      success: true,
      message: "Calendar event deleted successfully"
    };

  } catch (error: any) {
    console.error(`[CalendarService] Error deleting calendar event:`, error);
    return {
      success: false,
      message: `Failed to delete calendar event: ${error.message}`
    };
  }
}