/**
 * Local Ollama model gateway for Phase 34 grounded model synthesis proofs.
 * MODEL_WEIGHT_TRAINING = NO. Inference only. Invention guard must run after.
 */
import crypto from 'node:crypto';

export const DEFAULT_OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = process.env.PHASE34_OLLAMA_MODEL || 'llama3.2:1b';

export async function ollamaGenerate({
  prompt,
  system,
  model = DEFAULT_OLLAMA_MODEL,
  baseUrl = DEFAULT_OLLAMA_BASE,
  timeoutMs = 45_000,
} = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        system,
        stream: false,
        options: { temperature: 0.1, num_predict: 256 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ollama_http_${res.status}:${text.slice(0, 200)}`);
    }
    const body = await res.json();
    const output = String(body.response || '').trim();
    const latency = Date.now() - started;
    return {
      ok: true,
      output,
      model,
      provider: 'ollama',
      finish_reason: body.done_reason || (body.done ? 'stop' : 'unknown'),
      input_tokens: body.prompt_eval_count ?? null,
      output_tokens: body.eval_count ?? null,
      total_latency_ms: latency,
      generation_latency_ms: body.eval_duration
        ? Math.round(body.eval_duration / 1e6)
        : latency,
      time_to_first_token_ms: body.prompt_eval_duration
        ? Math.round(body.prompt_eval_duration / 1e6)
        : null,
      raw: body,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gateway adapter compatible with synthesizeGrounded({ modelGateway }).
 * Returns synthesis-shaped fields; caller must still run invention guard.
 */
export function createOllamaModelGateway(options = {}) {
  const model = options.model || DEFAULT_OLLAMA_MODEL;
  const baseUrl = options.baseUrl || DEFAULT_OLLAMA_BASE;
  const timeoutMs = options.timeoutMs || 45_000;

  return {
    provider: 'ollama',
    model,
    async complete({ capability, structured_result, snapshot, evidence_summary } = {}) {
      const invocation_id = `mi-${crypto.randomUUID().replace(/-/g, '')}`;
      const structured = structured_result || {};
      const system =
        'You are a grounded marketplace assistant. Use ONLY the structured facts. ' +
        'Do not invent prices, sales, bids, bidders, forecasts, or scarcity. ' +
        'If a number is missing, say evidence is insufficient. Keep the answer concise.';
      const prompt = [
        `Capability: ${capability || 'unknown'}`,
        `Structured facts JSON: ${JSON.stringify(structured)}`,
        `Evidence summary: ${typeof evidence_summary === 'string' ? evidence_summary : JSON.stringify(evidence_summary || {})}`,
        `Included event count: ${snapshot?.included_event_ids?.length ?? 'unknown'}`,
        'Write a short customer-facing direct answer that restates only these facts.',
      ].join('\n');

      const structured_input_hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(structured))
        .digest('hex');
      const system_prompt_hash = crypto.createHash('sha256').update(system).digest('hex');
      const prompt_hash = crypto.createHash('sha256').update(prompt).digest('hex');
      const config_hash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ provider: 'ollama', model, temperature: 0.1 }))
        .digest('hex');

      const gen = await ollamaGenerate({ prompt, system, model, baseUrl, timeoutMs });
      const output_hash = crypto.createHash('sha256').update(gen.output).digest('hex');

      const model_ledger = {
        model_invocation_id: invocation_id,
        provider: 'ollama',
        model_identifier: model,
        model_configuration_hash: config_hash,
        prompt_configuration_id: 'phase34-grounded-prose-v1',
        prompt_configuration_hash: prompt_hash,
        system_prompt_hash,
        structured_input_hash,
        evidence_snapshot_hash: snapshot?.evidence_snapshot_hash || null,
        input_tokens: gen.input_tokens,
        output_tokens: gen.output_tokens,
        context_tokens: null,
        total_latency_ms: gen.total_latency_ms,
        time_to_first_token_ms: gen.time_to_first_token_ms,
        generation_latency_ms: gen.generation_latency_ms,
        finish_reason: gen.finish_reason,
        output_hash,
      };

      return {
        synthesis_version: 'phase34-grounded-synthesis-v1',
        tier: 'privacy-local',
        model_invoked: true,
        model_gateway: { provider: 'ollama', model },
        synthesis_label: 'GROUNDED MODEL SYNTHESIS',
        direct_answer: gen.output,
        customer_summary: gen.output,
        key_values: structured,
        what_changed: '',
        evidence_summary:
          typeof evidence_summary === 'string'
            ? evidence_summary
            : `Structured facts used; model=${model}.`,
        limitations: ['MODEL_WEIGHT_TRAINING_NO', 'LOCAL_OLLAMA_INFERENCE'],
        next_actions: [],
        uncertainties: [],
        confidence: structured.confidence ?? 'medium',
        structured_result: structured,
        model_ledger,
      };
    },
  };
}
