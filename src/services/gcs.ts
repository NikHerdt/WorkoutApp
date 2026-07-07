import { KJUR } from 'jsrsasign';

/**
 * Minimal Google Cloud Storage JSON API client authenticated with a service
 * account key (RS256-signed JWT exchanged for an OAuth access token).
 * The key should belong to a service account whose only permission is
 * objectAdmin on the single backup bucket.
 */

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';
const TOKEN_LIFETIME_SEC = 3600;
/** Refresh the cached token this many seconds before it actually expires. */
const TOKEN_REFRESH_MARGIN_SEC = 300;

let cachedToken: { token: string; expiresAtMs: number; clientEmail: string } | null = null;

export function parseServiceAccountKey(json: string): ServiceAccountKey {
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Service account key is not valid JSON.');
  }
  if (typeof parsed?.client_email !== 'string' || typeof parsed?.private_key !== 'string') {
    throw new Error('Service account key must contain client_email and private_key.');
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    token_uri: typeof parsed.token_uri === 'string' ? parsed.token_uri : undefined,
  };
}

async function getAccessToken(key: ServiceAccountKey): Promise<string> {
  const now = Date.now();
  if (
    cachedToken &&
    cachedToken.clientEmail === key.client_email &&
    cachedToken.expiresAtMs - TOKEN_REFRESH_MARGIN_SEC * 1000 > now
  ) {
    return cachedToken.token;
  }

  const tokenUri = key.token_uri ?? DEFAULT_TOKEN_URI;
  const iat = Math.floor(now / 1000);
  const claims = {
    iss: key.client_email,
    scope: STORAGE_SCOPE,
    aud: tokenUri,
    iat,
    exp: iat + TOKEN_LIFETIME_SEC,
  };

  let assertion: string;
  try {
    assertion = KJUR.jws.JWS.sign(
      'RS256',
      JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
      JSON.stringify(claims),
      key.private_key
    );
  } catch (e) {
    throw new Error(`Could not sign auth token — check the private_key in your service account JSON. (${String(e)})`);
  }

  const body =
    'grant_type=' +
    encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
    '&assertion=' +
    encodeURIComponent(assertion);

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google auth failed (${response.status}): ${text.slice(0, 300)}`);
  }
  const data = await response.json();
  if (typeof data?.access_token !== 'string') {
    throw new Error('Google auth response did not include an access token.');
  }
  cachedToken = {
    token: data.access_token,
    expiresAtMs: now + (Number(data.expires_in) || TOKEN_LIFETIME_SEC) * 1000,
    clientEmail: key.client_email,
  };
  return cachedToken.token;
}

export async function gcsUploadObject(
  key: ServiceAccountKey,
  bucket: string,
  objectName: string,
  content: string,
  contentType = 'application/json'
): Promise<void> {
  const token = await getAccessToken(key);
  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o` +
    `?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: content,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload to gs://${bucket}/${objectName} failed (${response.status}): ${text.slice(0, 300)}`);
  }
}

/** Returns the object content, or null when the object does not exist. */
export async function gcsDownloadObject(
  key: ServiceAccountKey,
  bucket: string,
  objectName: string
): Promise<string | null> {
  const token = await getAccessToken(key);
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/` +
    `${encodeURIComponent(objectName)}?alt=media`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Download of gs://${bucket}/${objectName} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.text();
}
