declare const btoa: (value: string) => string;
declare const atob: (value: string) => string;

/** Browser/sandbox-safe conversion. Chunking avoids the spread argument limit on large images. */
export const backupBase64Encode = (bytes: Uint8Array): string => {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16_384)
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 16_384)));
  return btoa(parts.join(''));
};
export const backupBase64Decode = (text: string): Uint8Array => {
  let binary: string;
  try {
    binary = atob(text);
  } catch (error) {
    throw new Error('Invalid base64 data', { cause: error });
  }
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};
export const backupBinaryPayload = (carrier: {
  bytes?: Uint8Array | undefined;
  base64?: string | null | undefined;
}): Uint8Array | null =>
  carrier.bytes ?? (carrier.base64 == null ? null : backupBase64Decode(carrier.base64));
