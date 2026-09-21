import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { assertAnthropicModelsValid } from "../_shared/validate-anthropic-models.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  sniffMediaType,
  SUPPORTED_ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BASE64_CHARS,
} from "../_shared/media.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A photo or PDF sent with the question. Read by the model directly — no extraction step. */
interface AttachmentInput {
  media_type: string;
  data: string;
  name?: string;
}

interface ClinicalQARequest {
  question: string;
  specialty_id?: string;
  stream?: boolean;
  conversation_history?: ConversationMessage[];
  // "fast" (default) = RAG only, ~1.5s budget, Haiku model → first token <2s
  // "thorough" = full RAG + Firecrawl + PubMed, Sonnet model → deep evidence synthesis
  mode?: 'fast' | 'thorough';
  attachments?: AttachmentInput[];
}

// Without this the model refuses ordinary clinician phrasing ("a friend had this
// panel, analyze it") as a HIPAA violation. It is accurate: attachments require a
// signed-in account, and reviewing patient documents is the tool's intended use.
const CLINICIAN_CONTEXT = `CLINICAL CONTEXT
You are operating inside DoMyNote, a HIPAA-compliant clinical decision-support tool used by licensed clinicians. The user is a signed-in clinician; documents they attach — including patient-identifiable labs, notes, or reports — are shared for legitimate clinical care and review, and interpreting them is the authorized purpose of this tool.
- Do not refuse, withhold interpretation, or lecture about privacy: the clinician is responsible for their authorization to view the record.
- Clinicians often use casual shorthand such as "a friend had this panel" or "someone sent me these labs". Treat it as a clinical review request and answer it fully.
- You may reference patient identifiers exactly as they appear in the document when asked; never add identifiers that are not in the document.`;

const ATTACHMENT_ADDENDUM = `ATTACHED DOCUMENTS
The clinician has attached one or more clinical documents (photos or PDFs of lab panels, imaging reports, medication lists, notes, or vitals). Read them directly — you can see them. Never say you cannot view images.
- In the "Case Data Check", first state what each document is. Then list ONLY the values that fall outside the reference range printed beside them, with how far out they are. Check each comparison before listing it: a value inside its range is never "abnormal", and everything else is summarized in one line as within range.
- Describe each value the same way everywhere. Once the Case Data Check lists a value as out of range, never call it "normal" later; say "minimally elevated" throughout.
- Cite only values that are actually on the document. If a test is not shown (for example albumin when only an albumin/globulin ratio is printed), do not describe it as normal or abnormal.
- Photographs of screens or paper may have glare, skew, or partial cropping: read what is legible, and explicitly name any values you cannot read rather than guessing.
- Ground the answer in the document's actual values. Use retrieved evidence where it applies; if no evidence was retrieved, cite only well-established guidelines you are confident exist, and keep the References section short rather than inventing citations.`;

function toContentBlock(a: AttachmentInput) {
  return a.media_type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } }
    : { type: 'image', source: { type: 'base64', media_type: a.media_type, data: a.data } };
}

/**
 * With attachments the question is often just "interpret this", which is useless
 * as a guideline search string. Ask Haiku for a one-line topic from the document
 * itself. Best-effort and bounded: any failure falls back to the question alone.
 */
async function deriveRetrievalQuery(apiKey: string, question: string, attachments: AttachmentInput[]): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: [
            ...attachments.map(toContentBlock),
            {
              type: 'text',
              text: `A clinician asked: "${question}"\n\nIn one line (max 25 words), state the clinical topic and any abnormal findings in the attached document(s), phrased as a search query for clinical guidelines. Output only that line.`,
            },
          ],
        }],
      }),
    });
    if (!resp.ok) return question;
    const data = await resp.json();
    const line = data.content?.[0]?.text?.trim();
    if (!line) return question;
    console.log(`[clinical-qa] retrieval query from attachments: ${line}`);
    // A casual ask ("a friend had this panel, analyze it") only dilutes the embedding —
    // search on the document's topic alone unless the question carries real content.
    return question.split(/\s+/).length <= 10 ? line : `${line} — ${question}`;
  } catch (e) {
    console.warn('[clinical-qa] retrieval hint skipped:', (e as Error)?.message);
    return question;
  } finally {
    clearTimeout(timer);
  }
}

const STRUCTURED_PROMPT = `You are an expert clinical decision support assistant modeled after UpToDate. Your responses must follow this exact structured format for every clinical question:

## Clinical Response: [Topic]

### Case Data Check
[Include this section ONLY when the question gives patient-specific data, an attached document, criteria to apply, or something to calculate — otherwise omit it entirely and start with the Bottom Line. One line per item that decides the answer: each out-of-range document value with its printed range; each criterion as "<criterion>: <patient value> → MET" or "→ NOT MET"; each calculation with the patient's numbers substituted and the result. End with a one-line tally.]

### Bottom Line
[The direct answer in 1-3 sentences that a clinician can act on at the bedside: the specific drug and dose, threshold, diagnosis, or next step. No preamble, no restating the question. It must agree exactly with the Case Data Check when there is one.]

---

### Assumptions
[List 2-4 key clinical assumptions you are making based on the question. Be specific about what patient characteristics or scenarios you're addressing.]

---

### Evidence-Based Answer
[Expand on the bottom line in 2-3 sentences: what the evidence says and how strong it is. Do not simply repeat the Bottom Line.]

---

### Management Approach

**Recommended Actions:**
1. [First-line recommendation with specific details]
2. [Alternative or additional recommendations]
3. [Monitoring or follow-up considerations]

**Contraindications/Cautions:**
- [List key contraindications if applicable]
- [Drug interactions or precautions]

---

### Rationale
[Explain the pathophysiology or clinical reasoning behind the recommendations in 2-3 sentences. Include risk-benefit considerations.]

---

### Key Points
• [Key point 1] [1]
• [Key point 2] [2]
• [Key point 3] [3]

---

### References
[1] [Guideline or source name, Year]
[2] [Guideline or source name, Year]
[3] [Guideline or source name, Year]

---

IMPORTANT RULES:
1. Use markdown formatting (headers, bold, bullet points, numbered lists)
2. Work the case before you conclude: when there is patient data to verify, the Case Data Check comes first and the Bottom Line follows from it; for general questions, lead with the Bottom Line. Do not open with a warning banner or disclaimer; instead end the response with exactly one line: "_Decision support only — verify against current guidelines and the individual patient._"
3. Number your references and cite them in Key Points using [1], [2], etc.
4. Be specific about drug names, dosages, and recommendations
5. If the guidelines don't cover a topic well, acknowledge limitations clearly
6. Keep the response focused and clinically actionable
7. CALCULATIONS: for any computed value (creatinine clearance, risk scores, weight-based doses, ratios), write the formula with the patient's numbers substituted and work it step by step, then re-check the arithmetic before stating the result. Apply sex and unit correction factors explicitly. State when a result crosses a clinically meaningful threshold.
8. CONSISTENCY: before finishing, make sure every section agrees with the others — the same criteria counts, the same values, the same dose. Never describe a value as both normal and abnormal.
9. NO INVENTED DATA: never state a patient value, finding, or test result that was not provided. Restate the patient's given data (age, sex, weight, labs) exactly as stated; never alter it.
11. CRITERIA: when a recommendation depends on a multi-part rule (dose-reduction criteria, risk scores, diagnostic criteria), evaluate EVERY criterion on its own line against the patient's stated value and mark it MET or NOT MET — for example "Age 85 ≥ 80 years: MET" — before stating the conclusion. The count in the conclusion must equal the lines marked MET.
12. RULE VS EXCEPTION: when a guideline gives a general target plus condition-specific exceptions (blood pressure targets, dose adjustments, timing), state the general rule first and label each exception with the condition it applies to. Never present an exception as the default.
13. EXCERPTS ARE FRAGMENTS: the Available Evidence Context is cut mechanically from guideline PDFs, so an excerpt may begin mid-recommendation and contain only part of it — often only the exception. Read qualifiers literally ("compelling conditions", "in patients with…", "except…") and never promote a fragment into the general rule. When an excerpt is clearly partial, complete the recommendation from your knowledge of that same guideline and say which part came from the excerpt.
10. REFERENCES: cite the Available Evidence Context when it is provided. If no evidence context was retrieved, title the section "### References (from model knowledge — verify before citing)" and list only guidelines you are confident exist, with the correct issuing society.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Authentication is OPTIONAL for STAT Consult: it answers guideline questions
  // and stores nothing user-scoped. A valid JWT is used when present; guests are
  // served anonymously rather than rejected with a 401.
  let caller: Awaited<ReturnType<typeof requireUser>> | null = null;
  try {
    caller = await requireUser(req);
  } catch (_authError) {
    caller = null;
  }




  await assertAnthropicModelsValid();
  try {
    const startTime = Date.now();

    // Bad input is a 400, not a 500 — a malformed body is the caller's error, not a server fault
    let body: ClinicalQARequest;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({
        success: false,
        error: 'Request body must be valid JSON.',
        answer: null,
        guidelines: [],
        pubmedSources: [],
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { specialty_id, stream = true, conversation_history = [], mode = 'thorough', attachments: rawAttachments = [] } = body;
    let question = typeof body.question === 'string' ? body.question.trim() : '';

    const bad = (error: string, status = 400) => new Response(JSON.stringify({
      success: false, error, answer: null, guidelines: [], pubmedSources: [],
    }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    if (!Array.isArray(rawAttachments)) return bad('attachments must be an array.');
    if (rawAttachments.length > MAX_ATTACHMENTS) {
      return bad(`You can attach up to ${MAX_ATTACHMENTS} documents per question.`);
    }

    // Plain questions may be anonymous; attachments are PHI and need a signed-in caller.
    if (rawAttachments.length > 0 && !caller) {
      return bad('Please sign in to attach documents.', 401);
    }

    const attachments: AttachmentInput[] = [];
    for (const [i, a] of rawAttachments.entries()) {
      const data = typeof a?.data === 'string' ? a.data.replace(/^data:[^,]+,/, '').replace(/\s/g, '') : '';
      if (!data) return bad(`Attachment ${i + 1} is empty.`);
      if (data.length > MAX_ATTACHMENT_BASE64_CHARS) {
        return bad(`Attachment ${i + 1} is too large. Please use a smaller photo or a shorter PDF.`, 413);
      }
      // Trust the bytes over the declared type — HEIC mislabelled as JPEG is the classic failure.
      const sniffed = sniffMediaType(data);
      const media_type = sniffed ?? (typeof a?.media_type === 'string' ? a.media_type.toLowerCase() : 'image/jpeg');
      if (!SUPPORTED_ATTACHMENT_TYPES.includes(media_type)) {
        const isHeic = media_type === 'image/heic' || media_type === 'image/heif';
        return bad(isHeic
          ? "This photo is in Apple's HEIC format, which cannot be read. On your iPhone open Settings > Camera > Formats and choose \"Most Compatible\", then retake the photo."
          : `Attachment ${i + 1} has an unsupported format (${media_type}). Please use a JPEG, PNG, GIF, WebP, or PDF.`);
      }
      attachments.push({ media_type, data, name: typeof a?.name === 'string' ? a.name : undefined });
    }
    const hasAttachments = attachments.length > 0;

    if (!question) {
      if (!hasAttachments) return bad('Question is required.');
      question = 'Please review and interpret the attached clinical document(s).';
    }

    console.log(`Clinical Q&A request: "${question.substring(0, 100)}..." (mode: ${mode}, specialty: ${specialty_id || 'all'}, streaming: ${stream}, history: ${conversation_history.length} msgs, attachments: ${attachments.length})`);

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Run RAG (and in thorough mode, Firecrawl) with bounded budgets.
    // Fast mode = clinic use: RAG only, ≤1.5s budget. Speed beats web evidence in-room.
    const retrievalQuery = hasAttachments
      ? await deriveRetrievalQuery(anthropicApiKey, question, attachments)
      : question;

    console.log(`Starting retrieval (mode=${mode})...`);
    const retrievalStart = Date.now();

    const ragBody: any = {
      query: retrievalQuery,
      top_k: mode === 'thorough' ? 10 : 5,
      similarity_threshold: 0.50
    };
    if (specialty_id) {
      ragBody.specialty_id = specialty_id;
    }

    const RAG_BUDGET_MS = mode === 'thorough' ? 8000 : 1500;
    const ragPromise = Promise.race([
      supabase.functions.invoke('rag-retrieve', { body: ragBody }),
      new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: 'rag timeout' } }), RAG_BUDGET_MS)
      ),
    ]);

    // Firecrawl ONLY in thorough mode (was 6s wait every request)
    const firecrawlPromise = mode === 'thorough'
      ? Promise.race([
          supabase.functions.invoke('firecrawl-search', {
            body: {
              query: `${retrievalQuery} clinical guidelines site:acc.org OR site:idsociety.org OR site:kdigo.org OR site:chestnet.org OR site:aha.org OR site:aan.com OR site:endocrine.org OR site:ncbi.nlm.nih.gov/books`,
              options: { limit: 3 },
            },
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Firecrawl timeout')), 6000)),
        ])
      : Promise.resolve({ data: null, error: null });

    // Web search is only consulted when guideline retrieval comes back thin, so only
    // wait for it then — awaiting it unconditionally cost ~6s before the first word.
    firecrawlPromise.catch(() => {});
    const [ragSettled] = await Promise.allSettled([ragPromise]);

    let results: any[] = [];
    if (ragSettled.status === 'fulfilled') {
      const { data: ragData, error: ragError } = (ragSettled.value as any) ?? {};
      if (ragError) {
        console.warn('RAG retrieval skipped:', ragError.message);
      } else {
        results = ragData?.results || [];
      }
    } else {
      console.warn('RAG retrieval rejected:', ragSettled.reason);
    }

    const retrievalTime = Date.now() - retrievalStart;
    console.log(`Retrieved ${results.length} guideline chunks in ${retrievalTime}ms (budget ${RAG_BUDGET_MS}ms)`);

    const avgSimilarity = results.length > 0
      ? results.reduce((sum: number, r: any) => sum + r.similarity, 0) / results.length
      : 0;

    // Web/PubMed augmentation only in thorough mode
    let webResults: any[] = [];
    let pubmedResults: any[] = [];

    if (mode === 'thorough') {
      const needsFallback = results.length < 3 || avgSimilarity < 0.45;

      if (needsFallback) {
        // With an attachment the model answers from the document itself, so web evidence is a
        // bonus: give it a short grace period instead of holding the first word for the full timeout.
        const firecrawlWait = hasAttachments
          ? Promise.race([
              firecrawlPromise,
              new Promise((_, reject) => setTimeout(() => reject(new Error('Firecrawl grace period elapsed')), 2500)),
            ])
          : firecrawlPromise;
        const [firecrawlSettled] = await Promise.allSettled([firecrawlWait]);
        if (firecrawlSettled.status === 'fulfilled') {
          const { data: webData, error: webError } = (firecrawlSettled.value as any) ?? {};
          if (!webError && webData?.data && Array.isArray(webData.data)) {
            webResults = webData.data;
            console.log(`Using ${webResults.length} Firecrawl web results (RAG avg similarity: ${avgSimilarity.toFixed(3)})`);
          }
        } else {
          console.log('Firecrawl unavailable, skipping Layer 2');
        }
      }

      if (needsFallback && !hasAttachments && (results.length + webResults.length) < 3) {
        console.log('Still insufficient coverage, attempting PubMed search...');
        try {
          // This call was unbounded — a slow PubMed held the answer indefinitely.
          const { data: pubmedData, error: pubmedError } = await Promise.race([
            supabase.functions.invoke('pubmed-search', { body: { query: retrievalQuery, maxResults: 5 } }),
            new Promise<{ data: null; error: { message: string } }>((resolve) =>
              setTimeout(() => resolve({ data: null, error: { message: 'pubmed timeout' } }), 4000)
            ),
          ]);
          if (!pubmedError && pubmedData?.results) {
            pubmedResults = pubmedData.results;
            console.log(`Retrieved ${pubmedResults.length} PubMed abstracts`);
          }
        } catch (e) {
          console.log('PubMed search failed:', e);
        }
      }
    }

    // Build context from all sources
    let context = '';
    
    if (results.length > 0) {
      context += '## LOCAL GUIDELINE DATABASE\n\n';
      context += results
        .map((r: any, idx: number) => `[Guideline ${idx + 1}] (Relevance: ${(r.similarity * 100).toFixed(1)}%)\nSource: ${r.source || 'Clinical Guideline'}\n${r.content}`)
        .join('\n\n---\n\n');
    }
    
    if (webResults.length > 0) {
      context += '\n\n## WEB GUIDELINE SOURCES (Official Society Guidelines)\n\n';
      context += webResults
        .map((r: any, idx: number) => `[Web ${idx + 1}] URL: ${r.url}\nTitle: ${r.title || 'Guideline'}\n${r.markdown || r.description || ''}`)
        .join('\n\n---\n\n');
    }
    
    if (pubmedResults.length > 0) {
      context += '\n\n## PUBMED ABSTRACTS (Supplementary Research)\n\n';
      context += pubmedResults
        .map((r: any, idx: number) => `[PubMed ${idx + 1}] PMID: ${r.pmid}\nTitle: ${r.title}\nAuthors: ${r.authors}\nJournal: ${r.journal} (${r.year})\n${r.abstract}`)
        .join('\n\n---\n\n');
    }

    // Format all sources for metadata
    const guidelines = results.map((r: any, idx: number) => ({
      sourceNumber: idx + 1,
      source: r.source || 'Unknown Source',
      similarity: r.similarity,
      content: r.content.substring(0, 300) + (r.content.length > 300 ? '...' : ''),
      metadata: r.metadata
    }));

    const webSources = webResults.map((r: any, idx: number) => ({
      sourceNumber: idx + 1,
      url: r.url,
      title: r.title || 'Official Guideline',
      description: r.description || '',
      markdown: r.markdown?.substring(0, 300) + (r.markdown?.length > 300 ? '...' : '')
    }));

    const pubmedSources = pubmedResults.map((r: any, idx: number) => ({
      sourceNumber: idx + 1,
      pmid: r.pmid,
      title: r.title,
      authors: r.authors,
      journal: r.journal,
      year: r.year,
      abstract: r.abstract?.substring(0, 300) + (r.abstract?.length > 300 ? '...' : '')
    }));

    // Only return early if no context AND no conversation history
    // If there's conversation history, the AI can still answer follow-up questions
    // With an attachment the model answers from the document itself — never short-circuit
    // to the canned "no guidelines found" JSON, which would also break the SSE contract.
    if (!context && conversation_history.length === 0 && !hasAttachments) {
      const noContextResponse = {
        success: true,
        answer: `## Clinical Response: ${question.substring(0, 50)}...

⚠️ **CLINICAL CASE ALERT**
Clinical judgment required: AI can provide general information but may not fully account for clinical nuance or patient-specific factors.

---

### Notice
I couldn't find relevant guidelines in our database to answer your question comprehensively. This may be because:

1. The topic is not covered in the current guideline database
2. The question may need to be rephrased for better matching
3. This is a specialized topic requiring additional sources

**Recommendation:** Please consult UpToDate, PubMed, or specialty-specific guidelines directly for this query.`,
        guidelines: [],
        webSources: [],
        pubmedSources: [],
        metrics: {
          retrievalTime,
          generationTime: 0,
          totalTime: Date.now() - startTime,
          chunksRetrieved: 0,
          webRetrieved: 0,
          pubmedRetrieved: 0
        }
      };

      return new Response(JSON.stringify(noContextResponse), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Build context message - may be empty if only conversation history exists
    const contextSection = context ? `

---

Available Evidence Context:
${context}

---` : '\n\n(No new guideline context retrieved for this follow-up question - using conversation history)\n';

    const systemPrompt = [CLINICIAN_CONTEXT, STRUCTURED_PROMPT, hasAttachments ? ATTACHMENT_ADDENDUM : '']
      .filter(Boolean)
      .join('\n\n');
    const userText = `Clinical Question: ${question}
${contextSection}
Generate a comprehensive, structured clinical response following the exact format specified. Use the evidence provided (if any) and consider the prior conversation context when answering follow-up questions.`;

    // Attachments ride on the current turn only; history stays text so it serializes as-is.
    const buildMessages = () => [
      ...conversation_history.map(msg => ({ role: msg.role, content: msg.content })),
      {
        role: 'user',
        content: hasAttachments
          ? [...attachments.map(toContentBlock), { type: 'text', text: userText }]
          : userText,
      },
    ];

    // Step 3: Generate response with streaming
    if (stream) {
      console.log('Starting streaming response...');
      const generationStart = Date.now();

      const abortCtrl = new AbortController();
      const abortTimer = setTimeout(() => abortCtrl.abort(), 60000);
      const activeModel = hasAttachments || mode === 'thorough' ? 'claude-sonnet-4-5' : 'claude-haiku-4-5';
      console.log(`[clinical-qa] calling Anthropic model=${activeModel}`);

      let anthropicResponse: Response;
      try {
        anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: abortCtrl.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: activeModel,
            max_tokens: 8192,
            // The API default of 1.0 is far too loose for clinical reasoning — it produced
            // answers that contradicted the patient's own stated age.
            temperature: 0.2,
            stream: true,
            system: systemPrompt,
            messages: buildMessages(),
          }),
        });
      } catch (e) {
        clearTimeout(abortTimer);
        const msg = (e as Error)?.name === 'AbortError'
          ? `Upstream model timed out after 60s (model=${activeModel}). Try Fast mode or retry.`
          : `Upstream model fetch failed: ${(e as Error)?.message}`;
        console.error('[clinical-qa]', msg);
        return new Response(JSON.stringify({ error: msg }), {
          status: 504,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      clearTimeout(abortTimer);

      if (!anthropicResponse.ok) {
        const errorText = await anthropicResponse.text();
        console.error('Anthropic API error:', anthropicResponse.status, errorText);
        return new Response(JSON.stringify({ error: `Claude API error ${anthropicResponse.status}: ${errorText.slice(0, 500)}` }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create a TransformStream to process SSE and add metadata
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      // Upstream SSE lines are routinely split across network chunks. Parsing each
      // chunk alone made JSON.parse fail on the fragments, and the empty catch below
      // swallowed them — silently deleting words (and doses) from the answer.
      let carry = '';
      
      const transformStream = new TransformStream({
        start(controller) {
          // Send metadata first
          const metadata = {
            type: 'metadata',
            guidelines,
            webSources,
            pubmedSources,
            metrics: {
              retrievalTime,
              chunksRetrieved: results.length,
              webRetrieved: webResults.length,
              pubmedRetrieved: pubmedResults.length,
              avgSimilarity: results.length > 0 ? avgSimilarity : 0
            }
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`));
        },
        async transform(chunk, controller) {
          carry += decoder.decode(chunk, { stream: true });
          // Only complete lines are parsed; the trailing partial waits for the next chunk.
          const lines = carry.split('\n');
          carry = lines.pop() ?? '';
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                // Send completion event with final metrics
                const generationTime = Date.now() - generationStart;
                const completeMetrics = {
                  type: 'done',
                  metrics: {
                    retrievalTime,
                    generationTime,
                    totalTime: Date.now() - startTime,
                    chunksRetrieved: results.length,
                    webRetrieved: webResults.length,
                    pubmedRetrieved: pubmedResults.length,
                    avgSimilarity: results.length > 0 ? avgSimilarity : 0
                  }
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(completeMetrics)}\n\n`));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                continue;
              }
              
              try {
                const parsed = JSON.parse(data);
                
                // Handle content_block_delta events (streaming text)
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  const content = { type: 'content', text: parsed.delta.text };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(content)}\n\n`));
                }
                
                // Handle message_stop to send done event
                if (parsed.type === 'message_stop') {
                  const generationTime = Date.now() - generationStart;
                  const completeMetrics = {
                    type: 'done',
                    metrics: {
                      retrievalTime,
                      generationTime,
                      totalTime: Date.now() - startTime,
                      chunksRetrieved: results.length,
                      webRetrieved: webResults.length,
                      pubmedRetrieved: pubmedResults.length,
                      avgSimilarity: results.length > 0 ? avgSimilarity : 0
                    }
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(completeMetrics)}\n\n`));
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                }
              } catch {
                // Not valid JSON, skip
              }
            }
          }
        }
      });

      const stream = anthropicResponse.body!.pipeThrough(transformStream);

      return new Response(stream, {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        },
      });
    }

    // Non-streaming fallback (original behavior)
    console.log('Generating non-streaming response...');
    const generationStart = Date.now();

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: hasAttachments || mode === 'thorough' ? 'claude-sonnet-4-5' : 'claude-haiku-4-5',
        max_tokens: 8192,
        temperature: 0.2,
        system: systemPrompt,
        messages: buildMessages(),
      }),
    });

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error('Anthropic API error:', errorText);
      throw new Error(`Claude API error: ${anthropicResponse.status}`);
    }

    const anthropicData = await anthropicResponse.json();
    const answer = anthropicData.content[0].text;
    const generationTime = Date.now() - generationStart;

    console.log(`Answer generated in ${generationTime}ms`);

    const totalTime = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      answer,
      guidelines,
      webSources,
      pubmedSources,
      metrics: {
        retrievalTime,
        generationTime,
        totalTime,
        chunksRetrieved: results.length,
        webRetrieved: webResults.length,
        pubmedRetrieved: pubmedResults.length,
        avgSimilarity: results.length > 0 ? avgSimilarity : 0
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in clinical-qa:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      answer: null,
      guidelines: [],
      pubmedSources: []
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
