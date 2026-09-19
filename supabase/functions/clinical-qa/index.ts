import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { assertAnthropicModelsValid } from "../_shared/validate-anthropic-models.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClinicalQARequest {
  question: string;
  specialty_id?: string;
  stream?: boolean;
  conversation_history?: ConversationMessage[];
  // "fast" (default) = RAG only, ~1.5s budget, Haiku model → first token <2s
  // "thorough" = full RAG + Firecrawl + PubMed, Sonnet model → deep evidence synthesis
  mode?: 'fast' | 'thorough';
}

const STRUCTURED_PROMPT = `You are an expert clinical decision support assistant modeled after UpToDate. Your responses must follow this exact structured format for every clinical question:

## Clinical Response: [Topic]

⚠️ **CLINICAL CASE ALERT**
Clinical judgment required: AI can provide general information but may not fully account for clinical nuance or patient-specific factors. Always verify recommendations with current guidelines and clinical judgment.

---

### Assumptions
[List 2-4 key clinical assumptions you are making based on the question. Be specific about what patient characteristics or scenarios you're addressing.]

---

### Evidence-Based Answer
[Provide a clear, direct answer to the clinical question in 2-3 sentences. This should be the core recommendation.]

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

IMPORTANT FORMATTING RULES:
1. Use markdown formatting (headers, bold, bullet points, numbered lists)
2. Include the clinical alert banner at the top
3. Number your references and cite them in Key Points using [1], [2], etc.
4. Be specific about drug names, dosages, and recommendations
5. If the guidelines don't cover a topic well, acknowledge limitations clearly
6. Keep the response focused and clinically actionable`;

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
  void caller;




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

    const { question, specialty_id, stream = true, conversation_history = [], mode = 'thorough' } = body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Question is required.',
        answer: null,
        guidelines: [],
        pubmedSources: [],
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Clinical Q&A request: "${question.substring(0, 100)}..." (mode: ${mode}, specialty: ${specialty_id || 'all'}, streaming: ${stream}, history: ${conversation_history.length} msgs)`);

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Run RAG (and in thorough mode, Firecrawl) with bounded budgets.
    // Fast mode = clinic use: RAG only, ≤1.5s budget. Speed beats web evidence in-room.
    console.log(`Starting retrieval (mode=${mode})...`);
    const retrievalStart = Date.now();

    const ragBody: any = {
      query: question,
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
              query: `${question} clinical guidelines site:acc.org OR site:idsociety.org OR site:kdigo.org OR site:chestnet.org OR site:aha.org OR site:aan.com OR site:endocrine.org OR site:ncbi.nlm.nih.gov/books`,
              options: { limit: 3 },
            },
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Firecrawl timeout')), 6000)),
        ])
      : Promise.resolve({ data: null, error: null });

    const [ragSettled, firecrawlSettled] = await Promise.allSettled([ragPromise, firecrawlPromise]);

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

      if (needsFallback && firecrawlSettled.status === 'fulfilled') {
        const { data: webData, error: webError } = (firecrawlSettled.value as any) ?? {};
        if (!webError && webData?.data && Array.isArray(webData.data)) {
          webResults = webData.data;
          console.log(`Using ${webResults.length} Firecrawl web results (RAG avg similarity: ${avgSimilarity.toFixed(3)})`);
        }
      } else if (needsFallback) {
        console.log('Firecrawl unavailable, skipping Layer 2');
      }

      if (needsFallback && (results.length + webResults.length) < 3) {
        console.log('Still insufficient coverage, attempting PubMed search...');
        try {
          const { data: pubmedData, error: pubmedError } = await supabase.functions.invoke('pubmed-search', {
            body: { query: question, maxResults: 5 }
          });
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
    if (!context && conversation_history.length === 0) {
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

    // Note: prompt variable no longer used - messages are constructed inline with contextSection

    // Step 3: Generate response with streaming
    if (stream) {
      console.log('Starting streaming response...');
      const generationStart = Date.now();

      const abortCtrl = new AbortController();
      const abortTimer = setTimeout(() => abortCtrl.abort(), 60000);
      const activeModel = mode === 'thorough' ? 'claude-sonnet-4-5' : 'claude-haiku-4-5';
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
            stream: true,
            system: STRUCTURED_PROMPT,
            messages: [
              ...conversation_history.map(msg => ({
                role: msg.role,
                content: msg.content
              })),
              {
                role: 'user',
                content: `Clinical Question: ${question}
${contextSection}
Generate a comprehensive, structured clinical response following the exact format specified. Use the evidence provided (if any) and consider the prior conversation context when answering follow-up questions.`,
              },
            ],
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
          const text = decoder.decode(chunk);
          // Pass through the Anthropic SSE events, parsing content_block_delta
          const lines = text.split('\n');
          
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
        model: mode === 'thorough' ? 'claude-sonnet-4-5' : 'claude-haiku-4-5',
        max_tokens: 8192,
        system: STRUCTURED_PROMPT,
        messages: [
          // Include conversation history for context
          ...conversation_history.map(msg => ({
            role: msg.role,
            content: msg.content
          })),
          // Add current question with RAG context
          {
            role: 'user',
            content: `Clinical Question: ${question}
${contextSection}
Generate a comprehensive, structured clinical response following the exact format specified. Use the evidence provided (if any) and consider the prior conversation context when answering follow-up questions.`,
          },
        ],
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
