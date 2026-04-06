const E164_REGEX = /^\+[1-9]\d{7,14}$/;

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