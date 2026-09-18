import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * POST /functions/v1/freestyle-chat
 *
 * Accepts:
 *   - job_id: string
 *   - message: string
 *   - current_note: string
 *
 * Returns:
 *   - { message_id, reply, updated_note, diff[] }
 *
 * Stores messages in freestyle_chat_messages table.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { job_id, message, current_note, apply_message_id } = await req.json();

    if (!job_id || (!message && !apply_message_id)) {
      return new Response(
        JSON.stringify({ error: "job_id and message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Apply path — commit a revision the clinician already reviewed
    if (apply_message_id) {
      const { data: msg, error: readErr } = await supabaseClient
        .from("freestyle_chat_messages")
        .select("id, job_id, user_id, diff")
        .eq("id", apply_message_id)
        .single();

      if (readErr || !msg || msg.user_id !== user.id || msg.job_id !== job_id) {
        return new Response(JSON.stringify({ error: "Revision not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const revised = msg.diff?.revised_note;
      if (!revised) {
        return new Response(JSON.stringify({ error: "That revision is no longer available." }), {
          status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: writeErr } = await supabaseClient
        .from("freestyle_jobs")
        .update({ result_note: revised })
        .eq("id", job_id);

      if (writeErr) {
        return new Response(JSON.stringify({ error: writeErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseClient
        .from("freestyle_chat_messages")
        .update({ applied: true })
        .eq("id", apply_message_id);

      return new Response(
        JSON.stringify({ message_id: apply_message_id, reply: "", updated_note: revised, diff: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify job belongs to user, and take the note from the DB rather than the client
    const { data: job, error: jobError } = await supabaseClient
      .from("freestyle_jobs")
      .select("id, user_id, result_note")
      .eq("id", job_id)
      .single();

    if (jobError || !job || job.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseNote = (job.result_note || current_note || "").trim();
    if (!baseNote) {
      return new Response(
        JSON.stringify({ error: "This note has no content to refine yet." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Note refinement is temporarily unavailable." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Save user message
    await supabaseClient
      .from("freestyle_chat_messages")
      .insert({
        job_id,
        user_id: user.id,
        role: "user",
        content: message,
      });

    const revisedNote = await reviseNote(OPENAI_API_KEY, baseNote, message);
    const changes = diffSections(baseNote, revisedNote);

    const reply = changes.length > 0
      ? `Updated ${changes.length} section${changes.length === 1 ? "" : "s"}: ${changes.map((c) => c.section).join(", ")}. Review the change below and tap Apply to save it.`
      : `I reviewed the note against that request but found nothing to change. The note is unchanged.`;

    // The revision is held on the message row until the clinician applies it —
    // the note in freestyle_jobs is not touched here.
    const diff = { changes, revised_note: revisedNote };
    const updatedNote = revisedNote;

    // Save assistant response
    const { data: assistantMsg, error: msgError } = await supabaseClient
      .from("freestyle_chat_messages")
      .insert({
        job_id,
        user_id: user.id,
        role: "assistant",
        content: reply,
        diff: changes.length > 0 ? diff : null,
      })
      .select("id")
      .single();

    if (msgError) {
      return new Response(JSON.stringify({ error: msgError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        message_id: assistantMsg.id,
        reply,
        updated_note: updatedNote,
        diff,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    console.error("freestyle-chat error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

const REVISE_SYSTEM = `You are a clinical documentation specialist revising an existing History & Physical note at a physician's request.

RULES:
1. Return the COMPLETE revised note, from the first section header to the last. Never return a fragment, a diff, or a commentary — only the note itself.
2. Apply ONLY what the physician asked for. Leave every other section byte-for-byte unchanged.
3. NEVER invent clinical findings, vitals, lab values, medications, or history that the physician did not supply. If the request asks for content that was never documented, expand the structure and mark the unknown parts "Not assessed" or "Not obtained this visit" rather than fabricating a finding.
4. Preserve the existing section headers exactly — ALL CAPS at column zero followed by a colon.
5. Output PLAIN TEXT. No markdown, no asterisks, no "#" headings. This is pasted into an EHR.`;

async function reviseNote(apiKey: string, note: string, instruction: string): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: REVISE_SYSTEM },
        {
          role: "user",
          content: `Here is the current note:\n\n${note}\n\n---\n\nPhysician's request: ${instruction}\n\nReturn the complete revised note.`,
        },
      ],
      temperature: 0.2,
      max_tokens: 8000,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim() || "";

  if (!content) throw new Error("The revision came back empty. Please try again.");

  // A revision that loses most of the note means the model returned a fragment —
  // refuse it rather than letting a clinician apply a truncated chart entry.
  if (choice?.finish_reason === "length" || content.length < note.length * 0.5) {
    throw new Error("The revision came back incomplete. Please try a more specific request.");
  }

  return content;
}

/** Split a note into { SECTION HEADER -> body } using the same convention the generator emits. */
function splitSections(note: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current = "PREAMBLE";
  let buf: string[] = [];

  for (const line of note.split("\n")) {
    const bare = line.replace(/^\s*#{1,6}\s*/, "").replace(/\*\*/g, "").trim();
    const m = bare.match(/^([A-Z][A-Z &/'-]{2,40}):\s*(.*)$/);
    if (m) {
      out[current] = buf.join("\n").trim();
      current = m[1].trim();
      buf = m[2] ? [m[2]] : [];
    } else {
      buf.push(line);
    }
  }
  out[current] = buf.join("\n").trim();
  return out;
}

/** Real before/after diff computed from the two notes — never fabricated. */
function diffSections(before: string, after: string) {
  const a = splitSections(before);
  const b = splitSections(after);
  const changes: Array<{ section: string; before: string; after: string }> = [];

  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const prev = a[key] ?? "";
    const next = b[key] ?? "";
    if (prev.trim() === next.trim()) continue;
    changes.push({
      section: key === "PREAMBLE" ? "Note header" : titleCase(key),
      before: prev || "(section not present)",
      after: next || "(section removed)",
    });
  }

  return changes;
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
