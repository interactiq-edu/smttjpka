import { fromBase64Url, toArrayBuffer } from './crypto';

interface GoogleTokenPayload {
  iss: string;
  aud: string | string[];
  azp?: string;
  exp: number;
  iat?: number;
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

interface GoogleTokenHeader {
  alg: string;
  kid: string;
}

interface GoogleJwk extends JsonWebKey {
  kid?: string;
}

export interface GoogleIdentity {
  subject: string;
  email: string | null;
  displayName: string | null;
}

const decoder = new TextDecoder();

const parseJsonSegment = <T>(segment: string): T => JSON.parse(decoder.decode(fromBase64Url(segment))) as T;

export const verifyGoogleCredential = async (credential: string, audience: string): Promise<GoogleIdentity> => {
  const [encodedHeader, encodedPayload, encodedSignature, ...extra] = credential.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra.length > 0) throw new Error('Malformed Google credential.');

  let header: GoogleTokenHeader;
  let payload: GoogleTokenPayload;
  try {
    header = parseJsonSegment<GoogleTokenHeader>(encodedHeader);
    payload = parseJsonSegment<GoogleTokenPayload>(encodedPayload);
  } catch {
    throw new Error('Malformed Google credential.');
  }

  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Google credential.');
  const certificateResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!certificateResponse.ok) throw new Error('Google certificate lookup failed.');
  const certificates = (await certificateResponse.json()) as { keys?: GoogleJwk[] };
  const key = certificates.keys?.find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA');
  if (!key) throw new Error('Google signing key was not found.');

  const verificationKey = await crypto.subtle.importKey(
    'jwk',
    key,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signatureValid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    verificationKey,
    toArrayBuffer(fromBase64Url(encodedSignature)),
    toArrayBuffer(new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)),
  );
  if (!signatureValid) throw new Error('Google credential signature is invalid.');

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) || !audiences.includes(audience) || payload.exp <= now || (payload.iat !== undefined && payload.iat > now + 60) || !payload.sub) {
    throw new Error('Google credential claims are invalid.');
  }
  if (payload.email !== undefined && payload.email_verified !== true) throw new Error('Google email is not verified.');

  return { subject: payload.sub, email: payload.email ?? null, displayName: payload.name ?? null };
};
