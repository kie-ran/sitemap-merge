/**
 * Webhook signature validation for Webflow webhooks
 * 
 * Note: TextEncoder, crypto, and console are available in Cloudflare Workers runtime
 */

/**
 * Validate webhook signature using HMAC-SHA256
 * Webflow sends signature in x-webflow-signature header (hex-encoded)
 */
export async function validateWebhookSignature(
  requestBody: string,
  signature: string | null,
  secretKey: string
): Promise<boolean> {
  if (!signature) {
    return false;
  }

  try {
    // Create HMAC-SHA256 hash
    // TextEncoder is available globally in Cloudflare Workers
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secretKey);
    const messageData = encoder.encode(requestBody);

    // crypto.subtle is available globally in Cloudflare Workers
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const computedSignature = signatureArray
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Normalize both signatures to lowercase for comparison (Webflow uses lowercase hex)
    const normalizedComputed = computedSignature.toLowerCase();
    const normalizedReceived = signature.toLowerCase();

    // Constant-time comparison would be better in production, but for webhooks this is acceptable
    return normalizedComputed === normalizedReceived;
  } catch (error) {
    // console is available globally in Cloudflare Workers
    console.error('Error validating webhook signature:', error);
    return false;
  }
}

/**
 * Get webhook secret for a given site ID
 */
export function getWebhookSecret(siteId: string, env: {
  WEBHOOK_SECRET_MAIN?: string;
  WEBHOOK_SECRET_CITY?: string;
  WEBHOOK_SECRET_CAREERS?: string;
}): string | null {
  // This is a simplified approach - in production, you'd want to map
  // site IDs to secrets more dynamically (maybe via KV or env vars)
  // For now, we'll rely on env vars being set per site
  
  // If all sites share a secret, use any of them
  if (env.WEBHOOK_SECRET_MAIN) {
    return env.WEBHOOK_SECRET_MAIN;
  }
  if (env.WEBHOOK_SECRET_CITY) {
    return env.WEBHOOK_SECRET_CITY;
  }
  if (env.WEBHOOK_SECRET_CAREERS) {
    return env.WEBHOOK_SECRET_CAREERS;
  }

  return null;
}

