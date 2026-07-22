/**
 * Local Ollama model gateway for Phase 34 grounded model synthesis proofs.
 * MODEL_WEIGHT_TRAINING = NO. Inference only. Invention guard must run after.
 * Native host default :11436 (Colima mux owns :11434).
 */
import crypto from 'node:crypto';

export const DEFAULT_OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11436';
export const DEFAULT_OLLAMA_MODEL = process.env.PHASE34_OLLAMA_MODEL || 'llama3.2:1b';
export const GATEWAY_VERSION = 'phase34-ollama-gateway-v2';

/** Product-quality role for known local models. */
export function classifyModelTier(modelName) {
  const name = String(modelName || '');
  if (name.includes('1b') || name === 'llama3.2:1b') {
    return {
      role: 'TRANSPORT_AND_SMOKE_ONLY',
      product_quality: 'MODEL_TIER_INSUFFICIENT',
      chatgpt_tier_claimed: false,
    };
  }
  return {
    role: 'LOCAL_CANDIDATE',
    product_quality: 'UNRATED',
    chatgpt_tier_claimed: false,
  };
}

export async function ollamaHealth({ baseUrl = DEFAULT_OLLAMA_BASE, timeoutMs = 5_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/version`, { signal: controller.signal });
    if (!res.ok) return { ok: false, ready: false, reason: `http_${res.status}` };
    const body = await res.json();
    return { ok: true, ready: true, version: body.version || null, baseUrl };
  } catch (e) {
    return { ok: false, ready: false, reason: String(e.message || e), baseUrl };
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaListModels({ baseUrl = DEFAULT_OLLAMA_BASE, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) throw new Error(`ollama_tags_http_${res.status}`);
    const body = await res.json();
    const models = (body.models || []).map((m) => ({
      name: m.name,
      digest: m.digest || null,
      size_bytes: m.size || null,
      parameter_size: m.details?.parameter_size || null,
      quantization: m.details?.quantization_level || null,
      ...classifyModelTier(m.name),
    }));
    return { ok: true, models };
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaGenerate({
  prompt,
  system,
  model = DEFAULT_OLLAMA_MODEL,
  baseUrl = DEFAULT_OLLAMA_BASE,
  timeoutMs = Number(process.env.PHASE34_OLLAMA_TIMEOUT_MS || 180_000),
  keepAlive = process.env.PHASE34_OLLAMA_KEEP_ALIVE || '30m',
  numPredict = Number(process.env.PHASE34_OLLAMA_NUM_PREDICT || 64),
  requestId = null,
} = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: JSON.stringify({
        model,
        prompt,
        system,
        stream: false,
        keep_alive: keepAlive,
        options: { temperature: 0.1, num_predict: numPredict },
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
    const loadMs = body.load_duration ? Math.round(body.load_duration / 1e6) : null;
    return {
      ok: true,
      output,
      model,
      provider: 'ollama',
      finish_reason: body.done_reason || (body.done ? 'stop' : 'unknown'),
      input_tokens: body.prompt_eval_count ?? null,
      output_tokens: body.eval_count ?? null,
      total_latency_ms: latency,
      load_duration_ms: loadMs,
      warm_cold: loadMs != null && loadMs < 2_000 ? 'warm' : 'cold_or_unknown',
      generation_latency_ms: body.eval_duration
        ? Math.round(body.eval_duration / 1e6)
        : latency,
      time_to_first_token_ms: body.prompt_eval_duration
        ? Math.round(body.prompt_eval_duration / 1e6)
        : null,
      request_id: requestId,
      // Do not echo raw prompt/system in return — only hashes at ledger layer.
      raw_meta: {
        done: body.done,
        done_reason: body.done_reason,
        eval_count: body.eval_count,
        prompt_eval_count: body.prompt_eval_count,
      },
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError' || /aborted/i.test(String(err?.message || err));
    if (aborted) {
      const e = new Error(
        `ollama_generate_aborted_after_${timeoutMs}ms (base=${baseUrl} model=${model}); ` +
          'treat as inference/client timeout — /api/tags success is not generation health',
      );
      e.code = 'MODEL_TIMEOUT';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gateway with bounded consecutive-failure circuit breaker.
 */
export function createOllamaModelGateway(options = {}) {
  const model = options.model || DEFAULT_OLLAMA_MODEL;
  const baseUrl = options.baseUrl || DEFAULT_OLLAMA_BASE;
  const timeoutMs = options.timeoutMs || Number(process.env.PHASE34_OLLAMA_TIMEOUT_MS || 120_000);
  const failureThreshold = options.failureThreshold || 5;
  const tier = classifyModelTier(model);
  let consecutiveFailures = 0;
  let circuitOpen = false;

  return {
    provider: 'ollama',
    model,
    gateway_version: GATEWAY_VERSION,
    model_tier: tier,
    async health() {
      return ollamaHealth({ baseUrl });
    },
    async listModels() {
      return ollamaListModels({ baseUrl });
    },
    async complete({ capability, structured_result, snapshot, evidence_summary, inference_id } = {}) {
      if (circuitOpen) {
        const err = new Error('MODEL_UNAVAILABLE:circuit_open');
        err.code = 'MODEL_UNAVAILABLE';
        throw err;
      }
      const invocation_id = `mi-${crypto.randomUUID().replace(/-/g, '')}`;
      const request_id = inference_id || `req-${crypto.randomUUID().replace(/-/g, '')}`;
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
        .update(JSON.stringify({ provider: 'ollama', model, temperature: 0.1, gateway: GATEWAY_VERSION }))
        .digest('hex');

      let gen;
      try {
        gen = await ollamaGenerate({
          prompt,
          system,
          model,
          baseUrl,
          timeoutMs,
          requestId: request_id,
        });
        consecutiveFailures = 0;
      } catch (e) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= failureThreshold) circuitOpen = true;
        throw e;
      }

      const output_hash = crypto.createHash('sha256').update(gen.output).digest('hex');
      const model_ledger = {
        model_invocation_id: invocation_id,
        inference_id: inference_id || null,
        request_id,
        provider: 'ollama',
        model_identifier: model,
        model_role: tier.role,
        product_quality: tier.product_quality,
        model_configuration_hash: config_hash,
        gateway_version: GATEWAY_VERSION,
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
        load_duration_ms: gen.load_duration_ms,
        warm_cold: gen.warm_cold,
        finish_reason: gen.finish_reason,
        output_hash,
      };

      return {
        synthesis_version: 'phase34-grounded-synthesis-v1',
        tier: 'privacy-local',
        model_invoked: true,
        model_gateway: { provider: 'ollama', model, gateway_version: GATEWAY_VERSION },
        synthesis_label: 'GROUNDED MODEL SYNTHESIS',
        direct_answer: gen.output,
        customer_summary: gen.output,
        key_values: structured,
        what_changed: '',
        evidence_summary:
          typeof evidence_summary === 'string'
            ? evidence_summary
            : `Structured facts used; model=${model}.`,
        limitations: [
          'MODEL_WEIGHT_TRAINING_NO',
          'LOCAL_OLLAMA_INFERENCE',
          tier.product_quality,
        ],
        next_actions: [],
        uncertainties: [],
        confidence: structured.confidence ?? 'medium',
        structured_result: structured,
        model_ledger,
      };
    },
  };
}
