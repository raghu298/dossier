import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { AiError } from "../errors";
import { BaseProvider, type ChatAnswer, type ChatCall, type Effort, withJsonSchema } from "../provider";
import { keyGuardedFetch } from "./guarded-fetch";

/** Offered when the model list can't be fetched, e.g. before a key is saved. */
export const ANTHROPIC_FALLBACK_MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5"];

/**
 * Current models think before they answer unless told otherwise, and the
 * thinking counts towards `max_tokens`: without room on top, a long think
 * leaves none for the answer.
 */
const THINKING_TOKENS = 12_000;

// The effort levels each server and model takes, looked up once: older
// models, such as Claude Haiku 4.5, refuse the parameter.
const effortLevels = new Map<string, ReadonlySet<Effort>>();

/**
 * Anthropic compiles a structured-output schema into a grammar and refuses
 * one it finds too large (a 400), as with the extracted profile's. Such a
 * schema then goes in the system prompt instead, and BaseProvider checks the
 * answer against it as it does for providers without structured output.
 */
const TOO_LARGE_SCHEMA = /grammar is too large|schema is too (large|complex)/i;

/** Schemas Anthropic refused as too large, by name: sent in the prompt from then on. */
const schemasInPrompt = new Set<string>();

function refusedAsTooLarge(error: unknown): boolean {
  return error instanceof Anthropic.BadRequestError && TOO_LARGE_SCHEMA.test(error.message);
}

/** Claude through the Messages API with the user's own key. */
export class AnthropicProvider extends BaseProvider {
  readonly kind = "ANTHROPIC" as const;
  private readonly client: Anthropic | null;

  constructor(
    private readonly baseURL: string,
    apiKey: string | null,
    model: string | null,
    timeoutMs: number,
  ) {
    super(model, timeoutMs);
    this.client = apiKey ? new Anthropic({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 1, fetch: keyGuardedFetch() }) : null;
  }

  /** Current Claude models reject `temperature`; creativity is in the prompt's wording instead. */
  protected override acceptsTemperature(): boolean {
    return false;
  }

  protected async chat(call: ChatCall): Promise<ChatAnswer> {
    if (!this.client) throw AiError.config("Add your Anthropic API key in Settings → AI provider first.");
    const effort = call.effort && (await this.effortLevels(this.client, call.model, call.signal)).has(call.effort) ? call.effort : undefined;
    const create = (inPrompt: boolean) => {
      const format = call.json && !inPrompt ? { format: zodOutputFormat(call.json.schema) } : {};
      const outputConfig = { ...format, ...(effort ? { effort } : {}) };
      return this.client!.messages.create(
        {
          model: call.model,
          max_tokens: call.maxTokens + THINKING_TOKENS,
          system: call.json && inPrompt ? withJsonSchema(call.system, call.json.schema) : call.system,
          messages: call.messages,
          ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
        },
        { signal: call.signal },
      );
    };
    const inPrompt = call.json ? schemasInPrompt.has(call.json.name) : false;
    let message: Anthropic.Message;
    try {
      message = await create(inPrompt);
    } catch (error) {
      if (!call.json || inPrompt || !refusedAsTooLarge(error)) throw error;
      schemasInPrompt.add(call.json.name);
      message = await create(true);
    }
    if (message.stop_reason === "refusal") {
      throw new AiError("provider", "The model declined to answer this one. Try rewording it, or try again.", "refusal");
    }
    return {
      text: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
      cutOff: message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded",
    };
  }

  /** The effort levels `model` takes, from the Models API; none when that can't tell. */
  private async effortLevels(client: Anthropic, model: string, signal: AbortSignal): Promise<ReadonlySet<Effort>> {
    const key = `${this.baseURL} ${model}`;
    const known = effortLevels.get(key);
    if (known) return known;
    try {
      const effort = (await client.models.retrieve(model, {}, { signal })).capabilities?.effort;
      const levels = new Set((["low", "medium", "high"] as const).filter((level) => effort?.supported && effort[level].supported));
      effortLevels.set(key, levels);
      return levels;
    } catch (error) {
      if (signal.aborted) throw error;
      // Not remembered: the call goes ahead without an effort, and the next one asks again.
      return new Set();
    }
  }

  protected async fetchModels(signal: AbortSignal): Promise<string[]> {
    if (!this.client) return ANTHROPIC_FALLBACK_MODELS;
    try {
      const ids: string[] = [];
      for await (const model of this.client.models.list({ limit: 100 }, { signal })) ids.push(model.id);
      return ids.length > 0 ? ids : ANTHROPIC_FALLBACK_MODELS;
    } catch (error) {
      if (signal.aborted) throw error;
      return ANTHROPIC_FALLBACK_MODELS;
    }
  }
}
