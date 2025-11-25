// import { google } from "googleapis";
// import fs from "fs";
// import path from "path/win32";


// export class OAuth {
//     private CREDENTIALS_PATH: string;
//     private TOKEN_PATH: string;

//     constructor() {
//         this.CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
//         this.TOKEN_PATH = path.join(__dirname, "tokens.json");

//         // === Load credentials ===
//         const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
//         const { client_secret, client_id, redirect_uris } = credentials.web;

//         const oAuth2Client = new google.auth.OAuth2(
//             client_id,
//             client_secret,
//             redirect_uris[0]
//         );
//     }
//     //=== Store frontend URL ===

// // === Generate auth URL ===
// app.get("/auth", (req: any, res: any) => {
//     const authUrl = oAuth2Client.generateAuthUrl({
//         access_type: "offline",
//         prompt: "consent", // ensures refresh token is returned
//         scope: ["https://www.googleapis.com/auth/calendar",
//             "https://www.googleapis.com/auth/userinfo.profile",
//             "https://www.googleapis.com/auth/userinfo.email",
//             "https://www.googleapis.com/auth/drive.metadata.readonly", // add any scopes you want
//         ],
//     });
//     res.redirect(authUrl);
// });

// interface TokenStore {  //used to avoid TS from throwing a fit
//     [email: string]: any; // or a more specific type for tokens
// }

// // === Handle OAuth callback ===
// app.get("/oauth2callback", async (req: any, res: any) => {
//     const code = req.query.code;

//     try {
//         const { tokens } = await oAuth2Client.getToken(code);
//         oAuth2Client.setCredentials(tokens);

//         // === Get user info ===
//         const oauth2 = google.oauth2({ version: "v2", auth: oAuth2Client });
//         const userInfo = await oauth2.userinfo.get();

//         // === Read existing tokens ===
//         let tokenStore: TokenStore = {};

//         if (fs.existsSync(TOKEN_PATH)) {
//             tokenStore = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
//         }

//         // === Save credentials for this user ===
//         const email = userInfo.data.email;

//         if (!email)   //ye hamza iqbal ko kisi din mei poochon ga
//         {
//             throw new Error("User email is missing");
//         }
//         tokenStore[email] = tokens;

//         fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenStore, null, 2));
//         return res.redirect(`${FRONTEND_URL}/settings?oauth=success`);
//     } catch (err) {
//         console.error("Error during OAuth callback:", err);
//         res.status(500).send("Error retrieving access token");
//     }
// });
// }