/* =========================================================
   api/_whatsappProvider.js
   Provider abstraction for WhatsApp message delivery.

   Default provider: Twilio
   Future provider support: MSG91 (stubbed for easy extension)
   ========================================================= */

import twilio from "twilio";

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

function createProviderError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function normalizePhoneE164(rawValue) {
  if (typeof rawValue !== "string") return null;

  let value = rawValue.trim();
  if (!value) return null;

  if (value.startsWith("00")) {
    value = `+${value.slice(2)}`;
  }

  value = value.replace(/[\s()-]/g, "");

  if (!value.startsWith("+")) return null;
  if (!E164_REGEX.test(value)) return null;
  return value;
}

export function isValidPhoneE164(value) {
  return Boolean(normalizePhoneE164(value));
}

function getProviderName() {
  return String(process.env.WHATSAPP_PROVIDER || "twilio").toLowerCase();
}

function toPositiveInt(raw, fallback) {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getWhatsAppDispatchConfig() {
  return {
    provider: getProviderName(),
    batchSize: toPositiveInt(process.env.WHATSAPP_BATCH_SIZE, 30),
    maxParallelBatches: toPositiveInt(process.env.WHATSAPP_MAX_PARALLEL_BATCHES, 2)
  };
}

function toWhatsAppAddress(number) {
  return number.startsWith("whatsapp:") ? number : `whatsapp:${number}`;
}

function getTwilioClientConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = normalizePhoneE164(process.env.TWILIO_WHATSAPP_NUMBER || "");

  if (!accountSid || !authToken || !fromNumber) {
    throw createProviderError(
      "Missing Twilio WhatsApp configuration. Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER (E.164).",
      "env_missing"
    );
  }

  return {
    client: twilio(accountSid, authToken),
    from: toWhatsAppAddress(fromNumber)
  };
}

export function validateWhatsAppProviderConfig() {
  const provider = getProviderName();

  if (provider === "twilio") {
    getTwilioClientConfig();
    return;
  }

  if (provider === "msg91") {
    throw createProviderError("MSG91 provider is not implemented yet.", "provider_not_implemented");
  }

  throw createProviderError(`Unsupported WhatsApp provider: ${provider}`, "provider_not_supported");
}

export async function sendWhatsAppMessage({ to, body }) {
  const provider = getProviderName();

  if (provider === "twilio") {
    const normalizedTo = normalizePhoneE164(to);
    if (!normalizedTo) {
      throw createProviderError(`Invalid recipient number: ${to}`, "invalid_recipient");
    }

    const { client, from } = getTwilioClientConfig();
    const result = await client.messages.create({
      from,
      to: toWhatsAppAddress(normalizedTo),
      body
    });

    return {
      provider,
      sid: result.sid,
      status: result.status || "queued"
    };
  }

  if (provider === "msg91") {
    throw createProviderError("MSG91 provider is not implemented yet.", "provider_not_implemented");
  }

  throw createProviderError(`Unsupported WhatsApp provider: ${provider}`, "provider_not_supported");
}
