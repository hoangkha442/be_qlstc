import { createHmac } from 'node:crypto';

export function receiptSecret(receiptCode: string, serverKey: string) {
  return createHmac('sha256', serverKey)
    .update(`submission-receipt:${receiptCode}`)
    .digest('base64url');
}
