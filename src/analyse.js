// Calls the Claude Messages API directly from the browser with the visitor's own key.
// The response is streamed so progress can be shown while the analysis is written.

import { ANALYSIS_TOOL } from './schema.js';

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (balanced)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most thorough)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest)' }
];

export const SYSTEM_PROMPT = `You are an experienced AI deployment strategist. You map business processes and find where AI agents can remove manual effort, mostly for private equity portfolio companies and finance teams.

Work only from the material provided.

1. Map the process as it runs today, in order, at the level a process owner would recognise. Usually 5 to 12 steps.
2. For every step give hands-on minutes per run and runs per month. Use figures stated in the source. Where one is missing, estimate it from comparable work, set estimated to true and give the basis in a few words. Never leave a figure out.
3. Quote the source text that evidences each step where there is one.
4. Propose agent solutions only where they remove real effort. Group steps when one agent would naturally handle them. Leave judgement-heavy or control-critical steps with people and say why.
5. share is the fraction of a step's current hands-on time the agent would remove at steady state, after counting the time people spend reviewing its work. Be conservative. 0.9 is the practical maximum and judgement work rarely goes above 0.5.
6. Deployment plans must be practical: data access, a labelled test set with an accuracy target, a narrow pilot, then rollout. Name real integration routes (APIs, mailboxes, exports) for the systems the source mentions.
7. Do not calculate savings totals. The application calculates them from your figures.
8. Write in plain British English. No jargon and no hype.
9. List the questions you would put to the process owner to test your assumptions.

Submit your answer with the submit_process_analysis tool.`;

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function explain(status, body) {
  const detail = body?.error?.message ? ` (${body.error.message})` : '';
  if (status === 401) return 'The API key was not accepted. Check it and try again.';
  if (status === 403) return `This key does not have access to that model${detail}.`;
  if (status === 404) return `That model was not found for this key${detail}. Try another model.`;
  if (status === 413) return 'The documents are too large to send in one request. Remove one and try again.';
  if (status === 429) return 'Rate limit reached for this key. Wait a minute and try again.';
  if (status === 529 || status === 503) return 'The API is busy right now. Try again in a moment.';
  if (status === 400) return `The request was rejected${detail}.`;
  return `The API returned an error (${status})${detail}.`;
}

export async function analyse({ apiKey, model, blocks, description, signal, onProgress }) {
  const content = [
    ...blocks,
    { type: 'text', text: `Analyse this process and submit your analysis with the tool.\n\n<process_description>\n${description || '(See the attached documents.)'}\n</process_description>` }
  ];

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        stream: true,
        system: SYSTEM_PROMPT,
        tools: [ANALYSIS_TOOL],
        tool_choice: { type: 'tool', name: ANALYSIS_TOOL.name },
        messages: [{ role: 'user', content }]
      })
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the Anthropic API. Check your connection and try again.', 0);
  }

  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    throw new ApiError(explain(res.status, body), res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let json = '';
  let stopReason = null;
  let usage = {};

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = event.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      let msg;
      try { msg = JSON.parse(data); } catch { continue; }
      if (msg.type === 'content_block_delta' && msg.delta?.type === 'input_json_delta') {
        json += msg.delta.partial_json;
        onProgress?.(progressFrom(json));
      } else if (msg.type === 'message_start') {
        usage = { ...usage, ...msg.message?.usage };
      } else if (msg.type === 'message_delta') {
        stopReason = msg.delta?.stop_reason ?? stopReason;
        usage = { ...usage, ...msg.usage };
      } else if (msg.type === 'error') {
        throw new ApiError(msg.error?.message || 'The API reported an error while writing the analysis.', 0);
      }
    }
  }

  if (stopReason === 'max_tokens') throw new ApiError('The analysis ran out of space before it finished. Try a shorter input or a single process.', 0);
  try {
    return { raw: JSON.parse(json), usage };
  } catch {
    throw new ApiError('The analysis came back incomplete. Try again.', 0);
  }
}

// Reads the partial JSON as it streams in to report what has been written so far.
export function progressFrom(partial) {
  const steps = (partial.match(/"minutes_per_run"/g) || []).length;
  const opportunities = (partial.match(/"what_the_agent_does"/g) || []).length;
  let stage = 'Reading the material';
  if (partial.includes('"steps"')) stage = 'Mapping the process';
  if (partial.includes('"opportunities"')) stage = 'Designing agent solutions';
  if (partial.includes('"validation_questions"')) stage = 'Writing validation questions';
  return { stage, steps, opportunities, chars: partial.length };
}
