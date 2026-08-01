/**
 * Seed data for the chat screenshot pass (NO cleanup — leaves data for the UI).
 *
 * Registers two collaborators, a shared project owned by the "browser" user,
 * and a few seeded messages (a project-channel message + a DM), then prints a
 * single JSON line with the browser user's token/username for Playwright.
 *
 *   npx tsx --tsconfig socket-server/tsconfig.json socket-server/scripts/chat-seed.ts
 */
import "../src/loadenv.js";
import { sql } from "../src/infrastructure/db.js";

const BASE = "http://localhost:3000";
const suffix = Date.now().toString(36);
const PW = "pw123456";

async function register(username: string): Promise<{ id: string; username: string; token: string }> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, email: `${username}@t.local`, password: PW }),
  });
  if (!res.ok) throw new Error(`register ${username} failed: ${res.status} ${await res.text()}`);
  const { token, user } = await res.json();
  return { id: user.id, username: user.username, token };
}

async function main(): Promise<void> {
  const me = await register(`maya_${suffix}`);   // the browser user (project owner)
  const peer = await register(`leo_${suffix}`);  // a collaborator

  const projectName = `Website Redesign ${suffix}`;
  const projectType = "hosted";
  const [proj] = await sql<Array<{ id: string }>>`
    insert into projects (name, owner_id, project_type)
    values (${projectName}, ${me.id}, ${projectType})
    returning id
  `;
  await sql`
    insert into project_collaborators (project_id, user_id, role)
    values (${proj!.id}, ${peer.id}, 'editor')
  `;

  const ago = (min: number) => new Date(Date.now() - min * 60_000);

  // A few project-channel messages (so the channel isn't empty in screenshots).
  const projectMsgs: Array<[string, string, Date]> = [
    [peer.username, "Kicking off the redesign 🎨 who is around?", ago(6)],
    [me.username, "Here! I pushed the new hero section.", ago(4)],
    [peer.username, `Nice. Let's hop on a call — @${me.username}`, ago(2)],
  ];
  for (const [author, body, at] of projectMsgs) {
    await sql`
      insert into messages (scope, project_id, author, body, created_at)
      values ('project', ${proj!.id}, ${author}, ${body}, ${at})
    `;
  }

  // A DM thread between the two.
  const dmKey = [me.username, peer.username].sort().join("|");
  const dmMsgs: Array<[string, string, Date]> = [
    [peer.username, "hey, got a sec to review the nav?", ago(3)],
    [me.username, "sure, sending notes now", ago(1)],
  ];
  for (const [author, body, at] of dmMsgs) {
    await sql`
      insert into messages (scope, dm_key, author, body, created_at)
      values ('dm', ${dmKey}, ${author}, ${body}, ${at})
    `;
  }

  console.log("SEED_JSON " + JSON.stringify({
    token: me.token,
    username: me.username,
    peer: peer.username,
    projectName,
  }));
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("seed failed:", err);
  try { await sql.end(); } catch {}
  process.exit(1);
});
