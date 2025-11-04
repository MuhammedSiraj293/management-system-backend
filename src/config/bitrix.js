import env from './env.js';
import logger from './logger.js';

/**
 * --- IMPORTANT ---
 * 1. In your Bitrix24 account, go to Applications -> Webhooks -> Add Webhook.
 * 2. Add an "Inbound Webhook" (crm).
 * 3. Give it permissions for "CRM" (crm_lead_add, crm_lead_fields).
 * 4. Bitrix will give you a unique URL, like:
 * https://YOUR_DOMAIN.bitrix24.com/rest/1/YOUR_SECRET_TOKEN/
 * 5. Add this full URL to your .env file as BITRIX_WEBHOOK_URL.
 */

const BITRIX_WEBHOOK_URL = env.BITRIX_WEBHOOK_URL || null;

if (!BITRIX_WEBHOOK_URL && env.NODE_ENV !== 'test') {
  logger.warn(
    'BITRIX_WEBHOOK_URL is not set in .env file. Bitrix integration will be disabled.'
  );
}

/**
 * Gets the base webhook URL for Bitrix.
 * @returns {string|null} The Bitrix webhook URL.
 */
export const getBitrixWebhookUrl = () => {
  return BITRIX_WEBHOOK_URL;
};

/**
 * Creates the full API endpoint URL for a specific Bitrix method.
 * @param {string} method - The Bitrix API method (e.g., 'crm.lead.add').
 * @returns {string|null} The full URL for the API call, or null if not configured.
 */
export const getBitrixApiUrl = (method) => {
  const baseUrl = getBitrixWebhookUrl();
  if (!baseUrl) {
    return null;
  }
  // Ensure the URL ends with a slash before adding the method
  return `${baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'}${method}`;
};