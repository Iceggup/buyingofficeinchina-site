/**
 * Buying Office in China — Worker entry point
 * ------------------------------------------------------------------
 * This site runs as a Cloudflare Worker with Static Assets (not Pages).
 * One script therefore handles both jobs:
 *
 *   1. /api/inquiry  POST  — receive an inquiry, store it in D1, email a copy
 *   2. /api/leads    GET   — export all inquiries as CSV (key-protected)
 *   3. everything else     — serve the static site through the ASSETS binding,
 *                            adding the security / cache headers that used to
 *                            live in the Pages-only _headers file.
 *
 * Bindings (declared in wrangler.jsonc):
 *   DB               D1 database binding  (required to store leads)
 *   ASSETS           static assets binding (auto-created)
 *
 * Environment variables (Worker settings, not in this file):
 *   NOTIFY_TO        where the email notification goes
 *   RESEND_API_KEY   optional — without it, leads are stored but no email is sent
 *   RESEND_FROM      optional — e.g. "Inquiries <inquiries@buyingofficeinchina.com>"
 *   LEAD_EXPORT_KEY  shared secret for /api/leads; without it the endpoint is 404
 *
 * Dependency-free on purpose: no build step, no npm packages.
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

const REQUIRED = [
  "company", "name", "email", "country",
  "category", "specification", "quantity", "destination_port"
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RATE_LIMIT_PER_HOUR = 5;

/* ------------------------------ helpers ------------------------------ */

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

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Security + cache headers, replacing the old Pages `_headers` file. */
function polish(response, pathname) {
  const h = new Headers(response.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  if (pathname.startsWith("/assets/")) {
    h.set("Cache-Control", "public, max-age=3600");
  } else if (pathname.endsWith(".html") || !pathname.split("/").pop().includes(".")) {
    h.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: h
  });
}

/* ------------------------------ endpoints ------------------------------ */

async function handleInquiry(request, env) {
  let raw;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  // honeypot: bots fill every field — accept silently, store nothing
  if (String(raw.company_website || "").trim() !== "") {
    return json({ ok: true });
  }

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
  const ipCountry = request.headers.get("CF-IPCountry") || "";
  const ua = (request.headers.get("User-Agent") || "").slice(0, 300);

  if (!env.DB) {
    return json({ ok: false, error: "Could not save your inquiry. Please message me on WhatsApp instead." }, 500);
  }

  try {
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
      data.order_frequency, data.inspection_needed, data.notes, ip, ipCountry, ua
    ).run();
  } catch {
    return json({ ok: false, error: "Could not save your inquiry. Please try again, or message me on WhatsApp." }, 500);
  }

  // ---------- email notification (optional) ----------
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
      `<p style="color:#777;font-size:12px">From ${esc(ip)} (${esc(ipCountry)})</p>`;

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

async function handleLeads(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  if (!env.LEAD_EXPORT_KEY || key !== env.LEAD_EXPORT_KEY) {
    return new Response("Not found", { status: 404 });
  }
  if (!env.DB) {
    return new Response("D1 binding DB is not configured", { status: 500 });
  }

  const status = url.searchParams.get("status");
  const stmt = status
    ? env.DB.prepare("SELECT * FROM inquiries WHERE status = ?1 ORDER BY created_at DESC").bind(status)
    : env.DB.prepare("SELECT * FROM inquiries ORDER BY created_at DESC");

  const { results } = await stmt.all();
  if (!results) return new Response("No data", { status: 500 });

  const cols = results.length
    ? Object.keys(results[0])
    : ["id", "created_at", "status", "company", "name", "email", "whatsapp", "country",
       "category", "specification", "quantity", "destination_port", "delivery_window",
       "order_frequency", "inspection_needed", "notes", "ip", "ip_country", "user_agent"];

  const csv = [cols.join(",")]
    .concat(results.map((r) => cols.map((c) => csvCell(r[c])).join(",")))
    .join("\r\n");

  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="inquiries.csv"',
      "Cache-Control": "no-store"
    }
  });
}

/* ------------------------------ router ------------------------------ */

const APEX_HOST = "buyingofficeinchina.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Any sub-domain (www.…) redirects permanently to the apex host, so the
    // site is reachable at one canonical address only — no duplicate content,
    // no split links. Path and query string are preserved.
    if (url.hostname !== APEX_HOST && url.hostname.endsWith("." + APEX_HOST)) {
      const target = new URL(url.toString());
      target.hostname = APEX_HOST;
      target.protocol = "https:";
      target.port = "";
      return Response.redirect(target.toString(), 301);
    }

    if (path === "/api/inquiry") {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
      return handleInquiry(request, env);
    }

    if (path === "/api/leads") {
      if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
      return handleLeads(request, env);
    }

    if (path.startsWith("/api/")) {
      return json({ ok: false, error: "Not found." }, 404);
    }

    // static site
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed.", { status: 405 });
    }

    const asset = await env.ASSETS.fetch(request);
    return polish(asset, path);
  }
};
