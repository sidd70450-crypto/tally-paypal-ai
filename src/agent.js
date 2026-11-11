// Agent tool-use loop shared by both agents, with two interchangeable AI
// providers: Google Gemini (free tier) and Anthropic Claude.
// Emits events (thinking, text, tool calls/results) so the UI can show the agent working live.
import Anthropic from "@anthropic-ai/sdk";

export const PROVIDER = (process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini" : "claude")).toLowerCase();
// Gemini free-tier quotas are per model per day, so we keep a fallback chain
// and rotate to the next model when one runs out.
const GEMINI_MODELS = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest")
  .split(",").map((s) => s.trim()).filter(Boolean);
export const MODEL_NAME = PROVIDER === "gemini" ? GEMINI_MODELS.join(" → ") : process.env.CLAUDE_MODEL || "claude-opus-5-5";

async function execAll(calls, execTool, emit) {
  return Promise.all(calls.map(async (c) => {
    emit({ type: "tool_call", id: c.id, name: c.name, input: c.input });
    let out, isError = false;
    try {
      out = await execTool(c.name, c.input);
      if (out?.error) isError = true;
    } catch (err) {
      console.error(`[tool ${c.name}]`, err);
      out = { error: err.message };
      isError = true;
    }
    emit({ type: "tool_result", id: c.id, name: c.name, output: out, isError });
    return { ...c, out, isError };
  }));
}

// =====================================================================
// Google Gemini (REST: generateContent with function calling)
// =====================================================================
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// Gemini's function schemas are an OpenAPI subset: drop unsupported keys.
function toGeminiSchema(s) {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== "object") return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties") continue;
    out[k] = typeof v === "object" ? toGeminiSchema(v) : v;
  }
  if (out.type === "object" && out.properties && !Object.keys(out.properties).length) delete out.properties;
  return out;
}

// History entries are either native Gemini ({role, parts, model?}) or the simple
// Anthropic-style messages the server appends (notices, user input).
// Thought signatures only validate on the model that made them, so turns from
// another model (after a quota fallback) get their signatures neutralised.
const SKIP_SIG = "skip_thought_signature_validator";
function toGeminiContent(m, currentModel) {
  if (m.parts) {
    if (!m.model || m.model === currentModel) return { role: m.role, parts: m.parts };
    const parts = m.parts
      .filter((p) => !p.thought)
      .map(({ thoughtSignature, ...p }) => (p.functionCall ? { ...p, thoughtSignature: SKIP_SIG } : p));
    return { role: m.role, parts: parts.length ? parts : [{ text: "(ok)" }] };
  }
  const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
  const parts = blocks.map((b) => {
    if (b.type === "text") return { text: b.text };
    if ((b.type === "image" || b.type === "document") && b.source?.type === "base64") return { inlineData: { mimeType: b.source.media_type, data: b.source.data } };
    return { text: JSON.stringify(b) };
  });
  return { role: m.role === "assistant" ? "model" : "user", parts };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const exhaustedUntil = new Map(); // model -> timestamp when we may retry it
const noThinkingLevel = new Set(); // models that reject thinkingLevel

function pickModel() {
  const now = Date.now();
  return GEMINI_MODELS.find((m) => !(exhaustedUntil.get(m) > now));
}

/** Calls Gemini, rotating models on quota exhaustion. Returns { data, model }. */
async function callGemini(build) {
  let lastErr = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    const model = pickModel();
    if (!model) throw new Error(`All Gemini models have hit today's free-tier quota. ${lastErr}`);
    const body = build(model, !noThinkingLevel.has(model));
    const t0 = Date.now();
    const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY || "" },
      body: JSON.stringify(body),
    });
    if (res.ok) { console.log(`[gemini] ${model} ${Date.now() - t0}ms`); return { data: await res.json(), model }; }

    const text = await res.text();
    let err = {};
    try { err = JSON.parse(text).error || {}; } catch {}
    lastErr = `Gemini ${res.status}: ${(err.message || text).split("\n")[0]}`;
    console.log(`[gemini] ${model} HTTP ${res.status}: ${lastErr.slice(0, 160)}`);

    if (res.status === 429) {
      const details = err.details || [];
      const perDay = details.some((d) => d.violations?.some((v) => /PerDay/i.test(v.quotaId || "")));
      const delay = parseFloat(details.find((d) => d.retryDelay)?.retryDelay || "0");
      if (perDay || delay > 15) {
        // Out of quota for a while: move on to the next model in the chain.
        exhaustedUntil.set(model, Date.now() + (perDay ? 60 * 60_000 : delay * 1000));
        continue;
      }
      await sleep(Math.max(delay * 1000, 1500 * 2 ** attempt));
      continue;
    }
    if (res.status === 400 && /thinking.?level/i.test(err.message || "")) { noThinkingLevel.add(model); continue; }
    if (res.status === 404) { exhaustedUntil.set(model, Date.now() + 24 * 3600_000); continue; }
    if ((res.status === 503 || res.status === 500) && attempt < 3) { await sleep(1500 * 2 ** attempt); continue; }
    throw new Error(lastErr);
  }
  throw new Error(lastErr || "Gemini request failed");
}

async function runGemini({ system, tools, history, userContent, execTool, emit, maxSteps }) {
  history.push({ role: "user", content: userContent });
  const functionDeclarations = tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.input_schema) }));
  for (let step = 0; step < maxSteps; step++) {
    const { data, model } = await callGemini((m, withLevel) => ({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((h) => toGeminiContent(h, m)),
      tools: [{ functionDeclarations }],
      generationConfig: {
        thinkingConfig: { includeThoughts: true, ...(withLevel && process.env.GEMINI_THINKING !== "default" ? { thinkingLevel: process.env.GEMINI_THINKING || "low" } : {}) },
      },
    }));
    const cand = data.candidates?.[0];
    if (!cand?.content?.parts?.length) {
      const reason = cand?.finishReason || data.promptFeedback?.blockReason || "no response";
      emit({ type: "text", text: `I couldn't complete that (${reason}). Try rephrasing.` });
      return;
    }
    // Store the model turn exactly as returned (keeps thought signatures intact).
    history.push({ role: "model", parts: cand.content.parts, model });

    const calls = [];
    for (const p of cand.content.parts) {
      if (p.thought && p.text) emit({ type: "thinking", text: p.text });
      else if (p.text?.trim()) emit({ type: "text", text: p.text });
      if (p.functionCall) calls.push({ id: p.functionCall.id || `${p.functionCall.name}-${step}-${calls.length}`, callId: p.functionCall.id, name: p.functionCall.name, input: p.functionCall.args || {} });
    }
    if (!calls.length) return;

    const results = await execAll(calls, execTool, emit);
    history.push({
      role: "user",
      parts: results.map((r) => ({
        functionResponse: { ...(r.callId ? { id: r.callId } : {}), name: r.name, response: r.isError ? { error: r.out?.error ?? r.out } : { result: r.out } },
      })),
    });
  }
  emit({ type: "text", text: "(Stopped after too many steps.)" });
}

// =====================================================================
// Anthropic Claude (official SDK, manual tool-use loop)
// =====================================================================
let anthropic;
const EFFORT = process.env.CLAUDE_EFFORT || "low";
let useFallbacks = process.env.CLAUDE_FALLBACKS !== "off";

async function callClaude(params) {
  anthropic ||= new Anthropic();
  const base = {
    model: MODEL_NAME,
    max_tokens: 16000,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: EFFORT },
    ...params,
  };
  if (useFallbacks) {
    try {
      return await anthropic.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
        console.warn("[agent] server-side fallbacks unavailable, continuing without them");
        useFallbacks = false;
      } else throw err;
    }
  }
  return await anthropic.messages.create(base);
}

async function runClaude({ system, tools, history, userContent, execTool, emit, maxSteps }) {
  history.push({ role: "user", content: userContent });
  for (let step = 0; step < maxSteps; step++) {
    const res = await callClaude({ system, tools, messages: history });
    history.push({ role: "assistant", content: res.content });

    for (const b of res.content) {
      if (b.type === "thinking" && b.thinking) emit({ type: "thinking", text: b.thinking });
      if (b.type === "text" && b.text.trim()) emit({ type: "text", text: b.text });
    }

    if (res.stop_reason === "refusal") { emit({ type: "text", text: "I can't help with that request." }); return; }
    if (res.stop_reason === "pause_turn") continue;
    if (res.stop_reason !== "tool_use") return;

    const calls = res.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
    const results = await execAll(calls, execTool, emit);
    history.push({ role: "user", content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: JSON.stringify(r.out), is_error: r.isError })) });
  }
  emit({ type: "text", text: "(Stopped after too many steps.)" });
}

/** Runs one user turn. `history` is mutated append-only. */
export function runAgent(opts) {
  const o = { maxSteps: 12, ...opts };
  return PROVIDER === "gemini" ? runGemini(o) : runClaude(o);
}
