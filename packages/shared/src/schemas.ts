import { z } from "zod";

export const coerceJson = z.string().transform((raw, ctx) => {
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    ctx.addIssue({
      code: "custom",
      message: `${raw} is not valid JSON: ${(err as Error).message}`
    });
    return z.NEVER;
  }
});

const arrayBuffer = z.instanceof(ArrayBuffer);

export const arrayBufferToUtf8 = arrayBuffer.transform((buf) =>
  new TextDecoder().decode(buf)
);

export const arrayBufferToBigInt = arrayBuffer.transform((buf) => {
  const bytes = new Uint8Array(buf);
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
});

export const arrayBufferToJson = arrayBufferToUtf8.pipe(coerceJson);

export const arrayBufferToUint8Array = arrayBuffer.transform(
  (buf) => new Uint8Array(buf)
);

export const arrayBufferToBase64 = arrayBuffer.transform((buf) => {
  let binary = "";
  for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
  return btoa(binary);
});
