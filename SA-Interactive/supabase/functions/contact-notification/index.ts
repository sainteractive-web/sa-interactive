import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://sa-interactive.sa-interactive-web.workers.dev",
]);
const recipient = "sa.interactive.web@gmail.com";
const sender = "onboarding@resend.dev";

function corsHeaders(origin: string) {
  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin.trim()).origin;
  } catch {
    return null;
  }

  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin);
  if (!allowedOrigins.has(normalizedOrigin) && !isLocalOrigin) return null;

  return {
    "Access-Control-Allow-Origin": normalizedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function jsonResponse(body: Record<string, unknown>, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function projectPublishableKeys(): Set<string> {
  const keys = new Set<string>();
  const rawKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (rawKeys) {
    try {
      const parsed = JSON.parse(rawKeys) as Record<string, unknown>;
      for (const key of Object.values(parsed)) {
        if (typeof key === "string") keys.add(key);
      }
    } catch {
      // Fall back to the project's legacy anon key when available.
    }
  }

  const legacyAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacyAnonKey) keys.add(legacyAnonKey);
  return keys;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function textValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  const cors = corsHeaders(origin);
  if (request.method === "OPTIONS") {
    if (!cors) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors });
  }
  if (!cors) return new Response("Origin not allowed", { status: 403 });
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, cors);

  // This static site uses a publishable key rather than Supabase Auth JWTs.
  // The deployed function disables platform JWT validation and validates the
  // project key here, then accepts only a UUID for a row already in the table.
  const apiKey = request.headers.get("apikey") ?? "";
  if (!apiKey || !projectPublishableKeys().has(apiKey)) {
    return jsonResponse({ error: "unauthorized" }, 401, cors);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400, cors);
  }

  const id = textValue(payload.id, 36);
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return jsonResponse({ error: "invalid_request" }, 400, cors);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
    return jsonResponse({ error: "email_service_not_configured" }, 503, cors);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: submission, error: claimError } = await admin
      .from("contact_submissions")
      .update({ email_notification_status: "sending" })
      .eq("id", id)
      .eq("email_notification_status", "pending")
      .select("id, name, email, project")
      .maybeSingle();

    if (claimError) return jsonResponse({ error: "submission_lookup_failed" }, 500, cors);
    if (!submission) {
      const { data: existing, error: lookupError } = await admin
        .from("contact_submissions")
        .select("email_notification_status")
        .eq("id", id)
        .maybeSingle();

      if (lookupError) return jsonResponse({ error: "submission_lookup_failed" }, 500, cors);
      if (!existing) return jsonResponse({ error: "submission_not_found" }, 404, cors);
      return jsonResponse({ ok: true, alreadyProcessed: true }, 200, cors);
    }

    const name = String(submission.name);
    const email = String(submission.email);
    const project = String(submission.project);
    const subjectName = name.replace(/[\r\n]+/g, " ").slice(0, 120);
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeProject = escapeHtml(project).replace(/\r?\n/g, "<br>");
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `sa-contact-${id}`,
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        reply_to: email,
        subject: `New SA Interactive project inquiry from ${subjectName}`,
        html: `<h2>New project inquiry</h2><p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> ${safeEmail}</p><p><strong>Project:</strong><br>${safeProject}</p>`,
        text: `New project inquiry\n\nName: ${name}\nEmail: ${email}\n\nProject:\n${project}`,
      }),
    });

    if (!resendResponse.ok) {
      await admin.from("contact_submissions")
        .update({ email_notification_status: "pending" })
        .eq("id", id)
        .eq("email_notification_status", "sending");
      return jsonResponse({ error: "email_delivery_failed" }, 502, cors);
    }

    await admin.from("contact_submissions")
      .update({ email_notification_status: "sent" })
      .eq("id", id)
      .eq("email_notification_status", "sending");

    return jsonResponse({ ok: true }, 200, cors);
  } catch {
    await admin.from("contact_submissions")
      .update({ email_notification_status: "pending" })
      .eq("id", id)
      .eq("email_notification_status", "sending");
    return jsonResponse({ error: "email_delivery_failed" }, 502, cors);
  }
});
