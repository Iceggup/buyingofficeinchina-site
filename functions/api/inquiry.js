/**
 * POST /api/inquiry
 * Cloudflare Pages Function — receives an inquiry, stores it in D1,
 * and emails a notification if a mail provider is configured.
 *
 * Bindings / variables expected (Cloudflare Pages → Settings):
 *   DB                  D1 database binding (required to store the lead)
 *   NOTIFY_TO           destination address for the notification email
 *   RESEND_API_KEY      optional; if absent, email is skipped and the lead is only stored
 *   RESEND_FROM         e.g. "Inquiries <inquiries@yourdomain.com>"
 *
 * Deliberately dependency-free so it runs on the Pages runtime as-is.
 */

const MAX = {
  company: 160,
  name: 120,
  email: 200,
  whatsapp: 60,
  country: 80,
  category: 60,
  specification: 4000,
  quantity: 300,
  destination_port: 160,
  delivery_window: 160,
  order_frequency: 60,
  inspection_needed: 40,
  notes: 4000
};

const REQUIRED = ["company", "name", "email", "country", "category", "specification", "quantity", "destination_port"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const RATE_LIMIT_PER_HOUR = 5;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function onRequestPost({ request, env }) {
  // ---------- parse ----------
  let raw;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  // ---------- honeypot: pretend success, store nothing ----------
  if (String(raw.company_website || "").trim() !== "") {
    return json({ ok: true });
  }

  // ---------- clean + validate ----------
  const data = {};
  for (const key of Object.keys(MAX)) {
    data[key] = String(raw[key] == null ? "" : raw[key]).trim().slice(0, MAX[key]);
  }

  const missing = REQUIRED.filter((k) => !data[k]);
  if (missing.length) {
    return json({ ok: false, error: "Please complete the required fields: " + missing.join(", ") + "." }, 422);
  }
  if (!EMAIL_RE.test(data.email)) {
    return json({ ok: false, error: "That email address does not look valid." }, 422);
  }
  if (String(raw.consent || "") !== "yes") {
    return json({ ok: false, error: "Please tick the confirmation box before sending." }, 422);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const country = request.headers.get("CF-IPCountry") || "";
  const ua = (request.headers.get("User-Agent") || "").slice(0, 300);

  // ---------- store ----------
  if (env.DB) {
    try {
      // simple anti-abuse: same email or IP, more than N submissions in the last hour
      const recent = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM inquiries
          WHERE created_at > datetime('now', '-1 hour')
            AND (email = ?1 OR (ip <> '' AND ip = ?2))`
      ).bind(data.email, ip).first();

      if (recent && recent.n >= RATE_LIMIT_PER_HOUR) {
        return json({ ok: false, error: "Too many submissions from this address. Please message me on WhatsApp instead." }, 429);
      }

      await env.DB.prepare(
        `INSERT INTO inquiries
          (company, name, email, whatsapp, country, category, specification, quantity,
           destination_port, delivery_window, order_frequency, inspection_needed, notes,
           ip, ip_country, user_agent)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)`
      ).bind(
        data.company, data.name, data.email, data.whatsapp, data.country, data.category,
        data.specification, data.quantity, data.destination_port, data.delivery_window,
        data.order_frequency, data.inspection_needed, data.notes, ip, country, ua
      ).run();
    } catch (err) {
      return json({ ok: false, error: "Could not save your inquiry. Please try again, or message me on WhatsApp." }, 500);
    }
  }

  // ---------- notify ----------
  if (env.RESEND_API_KEY && env.NOTIFY_TO) {
    const rows = [
      ["Company", data.company],
      ["Name", data.name],
      ["Email", data.email],
      ["WhatsApp", data.whatsapp || "—"],
      ["Country", data.country],
      ["Category", data.category],
      ["Quantity", data.quantity],
      ["Destination port", data.destination_port],
      ["Delivery window", data.delivery_window || "—"],
      ["Order frequency", data.order_frequency || "—"],
      ["Inspection needed", data.inspection_needed || "—"]
    ];

    const html =
      "<h2>New inquiry</h2><table cellpadding='6' style='border-collapse:collapse'>" +
      rows.map(([k, v]) =>
        `<tr><td style="border-bottom:1px solid #eee"><strong>${esc(k)}</strong></td><td style="border-bottom:1px solid #eee">${esc(v)}</td></tr>`
      ).join("") +
      "</table><h3>Specification</h3><pre style='white-space:pre-wrap;font-family:inherit'>" +
      esc(data.specification) + "</pre>" +
      (data.notes ? "<h3>Notes</h3><pre style='white-space:pre-wrap;font-family:inherit'>" + esc(data.notes) + "</pre>" : "") +
      `<p style="color:#777;font-size:12px">From ${esc(ip)} (${esc(country)})</p>`;

    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.RESEND_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: env.RESEND_FROM || "Inquiries <onboarding@resend.dev>",
          to: [env.NOTIFY_TO],
          reply_to: data.email,
          subject: `Inquiry — ${data.company} (${data.country}) — ${data.category}`,
          html
        })
      });
    } catch {
      // the lead is already stored; a failed notification must not fail the request
    }
  }

  return json({ ok: true });
}

export async function onRequestGet() {
  return json({ ok: false, error: "Method not allowed." }, 405);
}
