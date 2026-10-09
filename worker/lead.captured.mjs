// worker/lead.captured.mjs
// Simple outbox consumer for lead.captured events.
// Consumes the "lead.captured" topic written by the API after OTP verification.
// Processes the event: updates the lead record to mark verified_at and triggers any
// additional actions needed.  This example is minimal – it only logs the event
// and writes a dummy property to the lead record for illustration.

import { sb } from './supabase.mjs'; // assume same supabase helper

export async function consumeLeadCaptured(payload) {
  const { leadId, phone } = payload;
  if (!leadId) return;
  await sb.update('leads', `id=eq.${leadId}`, { verified_at: new Date().toISOString() });
  console.log(`[lead-captured] lead ${leadId} verified`);
}

// The worker interface expected by the background job runner looks for a
// `consume()` function that receives the event payload.
export const consume = consumeLeadCaptured;
