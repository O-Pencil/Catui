/**
 * [WHO]: getEnvApiKey
 * [FROM]: Depends on env-api-keys for environment/provider API key lookup
 * [TO]: Consumed by @pencil-agent/ai/env subpath consumers
 * [HERE]: core/lib/ai/src/env.ts - additive env helper subpath entry for AI package
 */

export { getEnvApiKey } from "./env-api-keys.js";
