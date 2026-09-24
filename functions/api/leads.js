/**
 * GET /api/leads?key=YOUR_KEY        → all inquiries as CSV
 * GET /api/leads?key=YOUR_KEY&status=new
 *
 * Set the environment variable LEAD_EXPORT_KEY in Cloudflare Pages to a long
 * random string. Without it, this endpoint is disabled entirely.
 * Keep the URL private — it is a plain shared secret, not a login.
 */

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export async function onRequestGet({ request, env }) {
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

  // Excel on Windows needs the BOM to read UTF-8 correctly
  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="inquiries.csv"',
      "Cache-Control": "no-store"
    }
  });
}
