// The one place that talks to Gemini. Every caller shares the same model
// chain and the same fallthrough rules: per-model overload (503), quota
// (429) and a retired model name (404) mean "try the next model"; anything
// else is fatal. Born of 2026-07-11, when gemini-2.5-flash was retired and
// nobody knew - and consolidated after two later call sites re-forgot the
// 404 rule.

// Fast first. The pinned 2.5 Flash-Lite does not think unless asked, so it
// answers in a second or two. The "latest" alias moved on to a newer
// Flash-Lite that always thinks a little, and on 2026-11-11 it was taking 7 to
// 8 seconds per call (two calls for a question, so 15 seconds of waiting). It
// stays as the fallback: when the pinned model is retired (404) or overloaded,
// a slow answer still beats none.
export const GEMINI_MODELS = ['gemini-2.5-flash-lite', 'gemini-flash-lite-latest']

const RETRYABLE = [503, 429, 404]

// A hung upstream must not hold the caller: the cron functions walk every
// user in one invocation, and pg_net gives them 20 s in total.
const CALL_TIMEOUT_MS = 15_000

type ModelResult =
  | { ok: true; text: string }
  | { ok: false; fatal: boolean; error: string }

async function callModel(
  model: string,
  prompt: string,
  generationConfig: Record<string, unknown>,
): Promise<ModelResult> {
  const started = Date.now()
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      // the upstream body can echo request details - log it, keep it out of replies
      console.error(`gemini ${model} HTTP ${res.status}:`, (await res.text()).slice(0, 500))
      return { ok: false, fatal: !RETRYABLE.includes(res.status), error: `HTTP ${res.status}` }
    }
    const data = await res.json()
    // slow answers are the usual reason the message box feels stuck - leave a
    // trace, so the function log says which model took how long
    const ms = Date.now() - started
    if (ms > 4000) console.warn(`gemini ${model} took ${ms} ms`)
    const candidate = data.candidates?.[0]
    // a reply can arrive in several parts, and a thinking model puts its
    // notes in parts flagged `thought`. Reading only the first part once
    // saved a reflection that was just the two words "Job Search".
    const text = ((candidate?.content?.parts ?? []) as { text?: string; thought?: boolean }[])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('')
      .trim()
    if (!text) return { ok: false, fatal: false, error: 'empty reply' }
    // ran out of tokens mid-sentence: half an answer is worse than the next model's whole one
    if (candidate?.finishReason === 'MAX_TOKENS') return { ok: false, fatal: false, error: 'reply cut off' }
    return { ok: true, text }
  } catch (err) {
    // network errors are per-attempt, not per-key - the next model may work
    return { ok: false, fatal: false, error: String(err) }
  }
}

/** Free-text generation through the model chain. `model` names the one that
 *  answered; on failure `text` is null and `error` says why the last try died. */
export async function askGemini(
  prompt: string,
  generationConfig: Record<string, unknown> = {},
): Promise<{ text: string | null; model: string | null; error: string }> {
  let error = ''
  for (const model of GEMINI_MODELS) {
    const r = await callModel(model, prompt, generationConfig)
    if (r.ok) return { text: r.text, model, error: '' }
    error = `${model}: ${r.error}`
    if (r.fatal) break
  }
  return { text: null, model: null, error }
}

/** Structured-output generation. A reply that fails to parse (the model
 *  rambled past the token cap and truncated its JSON) or fails `valid` counts
 *  as that model failing - the next one tries. */
export async function askGeminiJson<T>(
  prompt: string,
  responseSchema: Record<string, unknown>,
  generationConfig: Record<string, unknown> = {},
  valid?: (data: T) => boolean,
): Promise<{ data: T | null; error: string }> {
  let error = ''
  for (const model of GEMINI_MODELS) {
    const r = await callModel(model, prompt, {
      responseMimeType: 'application/json',
      responseSchema,
      maxOutputTokens: 2048,
      ...generationConfig,
    })
    if (!r.ok) {
      error = `${model}: ${r.error}`
      if (r.fatal) break
      continue
    }
    try {
      const data = JSON.parse(r.text) as T
      if (!valid || valid(data)) return { data, error: '' }
      error = `${model}: reply missing required fields`
    } catch {
      error = `${model}: truncated/unparseable JSON output`
    }
  }
  return { data: null, error }
}
