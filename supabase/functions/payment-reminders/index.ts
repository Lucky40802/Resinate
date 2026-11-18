// Emails customers a reminder to pay for their Resinate order.
// Runs daily (pg_cron) and whenever a maker presses "Email payment reminder" on the dashboard
// (a trigger calls it when resinate_orders.remind_requested_at is set). See supabase/setup.sql.
// It only emails orders that really owe money, decided from the database, so calling it again is safe.
// Sends from the project Gmail through Gmail SMTP: needs the Edge Function secret GMAIL_APP_PASSWORD.
import postgres from "npm:postgres@3.4.5";
import nodemailer from "npm:nodemailer@6.9.16";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "resinatedesigns.bhhs@gmail.com";
const SITE = "https://lucky40802.github.io/Resinate/";
const DEFAULTS = { auto: true, afterDays: 2, everyDays: 3, max: 3 };

const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
const money = (c: number) => "$" + (c / 100).toFixed(2);
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || "");

Deno.serve(async () => {
  const pass = Deno.env.get("GMAIL_APP_PASSWORD");
  const settings = await sql`select id, data from public.resinate_settings where id in ('reminders', 'payment')`;
  const r = { ...DEFAULTS, ...(settings.find((s) => s.id === "reminders")?.data || {}) };
  const pay = settings.find((s) => s.id === "payment")?.data || {};

  // orders that owe money and are due a reminder: asked for from the dashboard, or due on the automatic schedule
  const due = await sql`
    select o.ref from public.resinate_orders o
    where o.status not in ('Cancelled', 'Collected') and o.price is not null
      and o.price > coalesce((select sum((p ->> 'amount')::int) from jsonb_array_elements(o.payments) p), 0)
      and ((o.remind_requested_at is not null and (o.last_reminded_at is null or o.remind_requested_at > o.last_reminded_at))
        or (${r.auto}::boolean and o.reminders_sent < ${r.max}::int
            and o.created_at < now() - make_interval(days => ${r.afterDays}::int)
            and (o.last_reminded_at is null or o.last_reminded_at < now() - make_interval(days => ${r.everyDays}::int))))
    order by o.created_at limit 25`;
  if (!pass) return json({ sent: 0, due: due.length, note: "GMAIL_APP_PASSWORD is not set" });
  if (!due.length) return json({ sent: 0 });

  const mail = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL_USER, pass } });
  let sent = 0, skipped = 0;
  for (const { ref } of due) {
    // claim the order so two runs never email it twice
    const [o] = await sql`
      update public.resinate_orders o set last_reminded_at = now(), reminders_sent = o.reminders_sent + 1, remind_requested_at = null
      from (select ref, last_reminded_at as prev from public.resinate_orders where ref = ${ref} for update skip locked) c
      where o.ref = c.ref
      returning o.ref, o.name, o.contact, o.price, o.payments, o.items, o.customer_id, c.prev`;
    if (!o) continue;
    let to = isEmail(o.contact) ? o.contact.trim() : "";
    if (!to && o.customer_id) {
      const [u] = await sql`select email from auth.users where id = ${o.customer_id}`;
      if (u && isEmail(u.email)) to = u.email;
    }
    if (!to) { skipped++; await undo(o); continue; } // no email to send to: phone or Instagram only
    const paid = (o.payments || []).reduce((a: number, p: { amount?: number }) => a + (p.amount || 0), 0);
    const owed = o.price - paid;
    const first = String(o.name || "").split(" ")[0] || "there";
    const how = [
      pay.payid ? `PayID: ${pay.payid}` : "",
      pay.name ? `Account name: ${pay.name}` : "",
      pay.bsb ? `BSB: ${pay.bsb}` : "",
      pay.acct ? `Account number: ${pay.acct}` : "",
    ].filter(Boolean);
    const text = [
      `Hi ${first},`,
      ``,
      `Just a friendly reminder that your Resinate order ${o.ref} has ${money(owed)} left to pay${paid ? ` (of ${money(o.price)})` : ""}.`,
      ``,
      ...(how.length ? [`You can pay by bank transfer:`, ...how, `Please use ${o.ref} as the payment reference.`] : [`Reply to this email and we'll send you how to pay.`]),
      pay.note ? `\n${pay.note}` : ``,
      ``,
      `Check your order any time: ${SITE}#track`,
      `Already paid? Thank you, and please ignore this email. If you have any questions, just reply.`,
      ``,
      `All profit from Resinate goes to charity.`,
      `The Resinate team`,
    ].join("\n").replace(/\n{3,}/g, "\n\n");
    try {
      await mail.sendMail({ from: `Resinate <${GMAIL_USER}>`, to, replyTo: GMAIL_USER, subject: `Payment reminder for your Resinate order ${o.ref}`, text });
      sent++;
    } catch (err) {
      console.error("Gmail refused the reminder for", o.ref, String(err));
      await undo(o);
    }
  }
  return json({ sent, skipped });
});

// put the order back as it was, so a failed send doesn't count as a reminder
async function undo(o: { ref: string; prev: string | null }) {
  await sql`update public.resinate_orders set last_reminded_at = ${o.prev}, reminders_sent = greatest(reminders_sent - 1, 0) where ref = ${o.ref}`;
}
