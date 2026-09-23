const encoder = new TextEncoder();

const toBase64 = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const toBase64Url = (value: Uint8Array): string =>
  toBase64(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

export const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const toArrayBuffer = (value: Uint8Array): ArrayBuffer => new Uint8Array(value).buffer;

export const randomToken = (bytes = 32): string => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return toBase64Url(value);
};

export const sha256 = async (value: string): Promise<string> =>
  toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));

export const verifyPbkdf2Password = async (
  password: string,
  salt: string,
  iterations: number,
  expectedHash: string,
): Promise<boolean> => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(fromBase64Url(salt)), iterations },
    key,
    256,
  );
  return constantTimeEqual(toBase64Url(new Uint8Array(bits)), expectedHash);
};

export const hashPbkdf2Password = async (password: string, iterations: number): Promise<{ hash: string; salt: string }> => {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(saltBytes), iterations },
    key,
    256,
  );
  return { hash: toBase64Url(new Uint8Array(bits)), salt: toBase64Url(saltBytes) };
};

export const constantTimeEqual = (left: string, right: string): boolean => {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
};

export const toSqliteTimestamp = (date: Date): string => date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
