/**
 * Add a HOSTED project (backend-listed, so it shows in the UI) for two existing
 * users, with seeded channel messages. Reuses users already registered by
 * chat-seed.ts — avoids the auth register rate limiter.
 *
 *   OWNER=maya_x PEER=leo_x npx tsx --tsconfig socket-server/tsconfig.json \
 *     socket-server/scripts/chat-seed-project.ts
 */
import "../src/loadenv.js";
import { sql } from "../src/infrastructure/db.js";
import { resolveUser } from "../src/repositories/identity.repository.js";

async function main(): Promise<void> {
  const ownerName = process.env.OWNER!;
  const peerName = process.env.PEER!;
  const owner = await resolveUser(ownerName);
  const peer = await resolveUser(peerName);
  if (!owner || !peer) throw new Error(`users not found: ${ownerName}/${peerName}`);

  const suffix = Date.now().toString(36);
  const projectName = `Website Redesign ${suffix}`;
  const [proj] = await sql<Array<{ id: string }>>`
    insert into projects (name, owner_id, project_type)
    values (${projectName}, ${owner.id}, 'hosted')
    returning id
  `;
  await sql`
    insert into project_collaborators (project_id, user_id, role)
    values (${proj!.id}, ${peer.id}, 'editor')
  `;

  const ago = (m: number) => new Date(Date.now() - m * 60_000);
  const msgs: Array<[string, string, Date]> = [
    [peer.username, "Kicking off the redesign 🎨 who is around?", ago(6)],
    [owner.username, "Here! I pushed the new hero section.", ago(4)],
    [peer.username, `Nice. Let's hop on a call — @${owner.username}`, ago(2)],
  ];
  for (const [author, body, at] of msgs) {
    await sql`
      insert into messages (scope, project_id, author, body, created_at)
      values ('project', ${proj!.id}, ${author}, ${body}, ${at})
    `;
  }

  console.log("PROJECT_JSON " + JSON.stringify({ projectName }));
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("seed-project failed:", err);
  try { await sql.end(); } catch {}
  process.exit(1);
});
