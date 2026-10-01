/**
 * The subscribe API's answer, in ONE place. The route returns it for every valid
 * address (new, pending or already active, so nothing leaks) and the form prints
 * what the API returned, falling back to this same string only when it never
 * reached the API (the honeypot's silent success).
 */
export const SUBSCRIBE_SUCCESS_MESSAGE = "Almost there. Check your email to confirm.";
