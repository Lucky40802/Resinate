// Emails the Resinate team about new "Message us" messages.
// A trigger on public.resinate_messages calls this after each new message (see supabase/setup.sql).
// It claims unsent messages from the last day, emails each one through Resend, and marks it sent,
// so calling it again (by anyone) never sends a message twice or sends anything that isn't real.
// Needs the Edge Function secret RESEND_API_KEY; until it's set, this does nothing.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const TO = Deno.env.get("NOTIFY_TO") || "resinatedesigns.bhhs@gmail.com";
const FROM = Deno.env.get("NOTIFY_FROM") || "Resinate <onboarding@resend.dev>";
const DASHBOARD = "https://lucky40802.github.io/Resinate/#dashboard";

const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
const oneLine = (s: string, n: number) => s.replace(/[\r\n]+/g, " ").slice(0, n);

Deno.serve(async () => {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    const [{ n }] = await sql`select count(*)::int as n from public.resinate_messages where notified_at is null and created_at > now() - interval '1 day'`;
    return json({ sent: 0, waiting: n, note: "RESEND_API_KEY is not set" });
  }

  const rows = await sql`
    update public.resinate_messages set notified_at = now()
    where id in (select id from public.resinate_messages
                 where notified_at is null and created_at > now() - interval '1 day'
                 order by created_at limit 10 for update skip locked)
    returning id, name, contact, order_ref, body, created_at`;

  let sent = 0;
  for (const m of rows) {
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.contact) ? m.contact : undefined;
    const text = [
      `New message from the Resinate website`,
      ``,
      `From: ${m.name}`,
      `Contact: ${m.contact}`,
      m.order_ref ? `Order: ${m.order_ref}` : ``,
      ``,
      m.body,
      ``,
      email ? `Reply to this email to answer ${m.name} directly.` : `Reply to ${m.name} using the contact above.`,
      `Open the dashboard: ${DASHBOARD}`,
    ].filter((l, i, a) => l !== `` || a[i - 1] !== ``).join("\n");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        subject: `New Resinate message from ${oneLine(m.name, 60)}${m.order_ref ? ` (${m.order_ref})` : ""}`,
        text,
        ...(email ? { reply_to: email } : {}),
      }),
    });
    if (res.ok) sent++;
    else {
      // put it back so the next message's call tries again
      await sql`update public.resinate_messages set notified_at = null where id = ${m.id}`;
      console.error("Resend refused the email", res.status, await res.text());
    }
  }
  return json({ sent });
});
