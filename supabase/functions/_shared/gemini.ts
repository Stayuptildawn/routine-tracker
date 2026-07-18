// The one place that talks to Gemini. Every caller shares the same model
// chain and the same fallthrough rules: per-model overload (503), quota
// (429) and a retired model name (404) mean "try the next model"; anything
// else is fatal. Born of 2026-07-11, when gemini-2.5-flash was retired and
// nobody knew - and consolidated after two later call sites re-forgot the
// 404 rule.

// Fast-and-cheap first: heavier "latest" aliases run thinking passes that
// blow the edge-function worker limit.
export const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite']

const RETRYABLE = [503, 429, 404]

type ModelResult =
  | { ok: true; text: string }
  | { ok: false; fatal: boolean; error: string }

async function callModel(
  model: string,
  prompt: string,
  generationConfig: Record<string, unknown>,
): Promise<ModelResult> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
      },
    )
    if (!res.ok) return { ok: false, fatal: !RETRYABLE.includes(res.status), error: `HTTP ${res.status}: ${await res.text()}` }
    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!text) return { ok: false, fatal: false, error: 'empty reply' }
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
