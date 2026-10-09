// worker/cash.mjs
// Consumes "redemption.requested" events with kind='cash'.
// Triggers Flutterwave cash payout and updates the redemption status in the database.

import { sb } from './supabase.mjs';
import * as flw from '../providers/flutterwave.mjs';

export async function consumeRedemption(payload) {
  const { redemption_id, kind, points, profile_id } = payload;
  if (kind !== 'cash') return;

  // Perform minimal payout via Flutterwave
  try {
    const res = await flw.initiatePayout({
      account_bank: '044', // test bank code
      account_number: '0690000031', // test account
      amount: Math.max(10, Math.floor(points / 100)), // rough conversion
      narration: `Promota cash payout for ${profile_id}`,
      currency: 'NGN',
      reference: `red-${redemption_id}`,
    });

    if (res.status === 'success') {
      await sb.update('redemptions', `id=eq.${redemption_id}`, {
        state: 'fulfilled',
        provider: 'flutterwave',
        provider_ref: res.data?.id,
        updated_at: new Date().toISOString(),
      });
      console.log(`[payout] cash redemption ${redemption_id} completed`);
    } else {
      await sb.update('redemptions', `id=eq.${redemption_id}`, {
        state: 'failed',
        failure_reason: res.message || 'Flutterwave error',
        updated_at: new Date().toISOString(),
      });
      console.error(`[payout] cash redemption ${redemption_id} failed:`, res.message);
    }
  } catch (err) {
    console.error(`[payout] cash redemption ${redemption_id} threw:`, err);
  }
}

export const consume = consumeRedemption;
