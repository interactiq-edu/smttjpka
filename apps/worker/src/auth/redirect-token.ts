import { fromBase64Url, toArrayBuffer, toBase64Url } from './crypto';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const keyFor = async (secret: string): Promise<CryptoKey> => {
  if (secret.length < 32) throw new Error('Redirect token configuration is unavailable.');
  const keyBytes = await crypto.subtle.digest('SHA-256', encoder.encode(`interactiq-google-redirect:${secret}`));
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

export const sealRedirectToken = async (payload: object, secret: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(secret), encoder.encode(JSON.stringify(payload)));
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv);
  result.set(new Uint8Array(encrypted), iv.length);
  return toBase64Url(result);
};

export const openRedirectToken = async <T>(token: string, secret: string): Promise<T> => {
  const value = fromBase64Url(token);
  if (value.length < 29) throw new Error('Redirect token is invalid.');
  const iv = value.slice(0, 12);
  const encrypted = value.slice(12);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await keyFor(secret), toArrayBuffer(encrypted));
  return JSON.parse(decoder.decode(clear)) as T;
};
