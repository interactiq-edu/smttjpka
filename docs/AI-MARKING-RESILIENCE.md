# AI marking resilience

InteractIQ sends preliminary marking requests through the Cloudflare AI Gateway named `default`. The primary model is Workers AI. If the primary model is unavailable after three application-level attempts with exponential backoff, InteractIQ calls the provider-native Google AI Studio endpoint for `gemini-3.8-flash` through the same gateway.

## Credential safety

Never put a Gemini API key in source code, `wrangler.toml`, browser storage, GitHub Actions output, or a client-side environment variable. If a key has appeared in a chat message or screenshot, revoke it before using the integration.

Create a new Google AI Studio key, then store it in Cloudflare:

1. Open **AI > AI Gateway > default > Provider Keys**.
2. Add a Google AI Studio credential using the **default** BYOK alias.
3. Keep `AI_BACKUP_MODEL = "gemini-3.8-flash"` and the Cloudflare account ID in `wrangler.toml`.
4. Create an AI Gateway authentication token and store it as the encrypted Worker secret `AI_GATEWAY_TOKEN`.
4. Run a Math Response preview and confirm the request appears in AI Gateway logs.

Cloudflare documentation: <https://developers.cloudflare.com/ai-gateway/usage/providers/google-ai-studio/>

## Gateway controls

In the `default` gateway, enable automatic retries for upstream failures with an exponential strategy. The Worker also performs short bounded retries, so keep the gateway policy conservative to avoid excessive duplicate cost.

Cloudflare retry documentation: <https://developers.cloudflare.com/ai-gateway/configuration/retries/>

## Budget alert

The Memory Control page links to Cloudflare Billing and displays tenant-scoped daily request and token usage from InteractIQ. A Cloudflare budget alert is account-level and requires an account owner to choose the amount and notification recipients in Billing.

Cloudflare budget alert documentation: <https://developers.cloudflare.com/billing/manage/budget-alerts/>

## Pending marks

If both providers fail, the answer is stored as `PENDING`:

- no zero mark is written;
- the question is excluded from the provisional numerator and denominator;
- students see **Waiting for AI marking**;
- teachers see **AI marking pending** and may retry or enter a manual mark;
- final review is blocked until every pending answer has an AI or teacher mark.

Newly uploaded images are resized to a maximum edge of 1,800 pixels, and handwriting canvases use compressed WebP or JPEG before submission. This reduces AI image-processing cost while retaining enough detail for formula and handwriting review.
