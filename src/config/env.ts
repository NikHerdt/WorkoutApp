/**
 * Build-time configuration, read from `.env` (see `.env.example`).
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` references into the bundle at build
 * time, so these must be accessed as static property reads — destructuring
 * `process.env` or indexing it dynamically will not be substituted.
 *
 * ⚠️  Anything here ships inside the APK and is extractable. `.env` keeps values
 * out of git; it does not keep them secret from someone holding the app. The GCS
 * service account is therefore scoped to a single bucket, and the Anthropic key
 * is better entered in-app (stored in the app's private database) than baked in.
 */

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

/** GCS bucket for database backups. Empty when not configured. */
export const GCS_BUCKET = clean(process.env.EXPO_PUBLIC_GCS_BUCKET);

/** Service account JSON key for that bucket, as a raw JSON string. */
export const GCS_SERVICE_ACCOUNT_JSON = clean(
  process.env.EXPO_PUBLIC_GCS_SERVICE_ACCOUNT_JSON
);

/** Anthropic API key for AI program generation. Empty when entered in-app instead. */
export const ANTHROPIC_API_KEY = clean(process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY);
