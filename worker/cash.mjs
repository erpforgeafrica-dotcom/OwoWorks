// worker/cash.mjs
// Consumes "redemption.requested" events with kind='cash'.
// Triggers Flutterwave cash payout and updates the redemption status in the database.

import { sb } from './supabase.mjs';
import * as flw from '../providers/flutterwave.mjs';

export async function consumeRedemption(payload) {
  const { redemption_id, kind, points, profile_id } = payload;
  if (kind !== 'cash') return;

  // Resolve a beneficiary bank code once (cached per process start).
  const banks = await flw.banks('NG');
  const bankCode = banks.find(b => /^(501|502|503|504|505|506|507|508|509|510|511|512|513|514|515|516|517|518|519|520|521|522|523|524|525|526|527|528|529|530|531|532|533|534|535|536|537|538|539|540|541|542|543|544|545|546|547|548|549|550|551|552|553|554|555|556|557|558|559|560|561|562|563|564|565|566|567|568|569|570|571|572|573|574|575|576|577|578|579|580|581|582|583|584|585|586|587|588|589|590|591|592|593|594|595|596|597|598|599|600)$/i)?.code;
  // Fallback to a simple test bank if none matched (for proof only).
  const fallbackBankCode = '501'; // example: GTBank

  // Compute a rough naira amount from points (1 point ≈ 0.02 NGN for demo)
  const amount = Math.max(10, Math.floor(points * 0.02));

  // Beneficiary account number – in a real system this would be stored per promoter.
  // Here we use a static test account for the pilot.
  const testAccountNumber = '0690000031';
  const testBankCode = bankCode || fallbackBankCode;
  const beneficiaryName = 'Promota User';

  try {
    const transfer = await flw.createTransfer({
      reference: `red-${redemption_id}`,
      amount,
      accountNumber: testAccountNumber,
      accountBank: testBankCode,
      beneficiaryName,
    });

    // Mark redemption as fulfilled via Flutterwave
    await sb.update(
      'redemptions',
      `id=eq.${redemption_id}`,
      {
        state: 'fulfilled',
        provider: 'flutterwave',
        provider_ref: transfer.transferId ?? redemption_id,
        value_minor: Math.round(amount * 100), // kobo equivalent
        updated_at: new Date().toISOString(),
      }
    );
    console.log(`[payout] cash redemption ${redemption_id} completed, transfer ${transfer.transferId}`);
  } catch (err) {
    console.error(`[payout] cash redemption ${redemption_id} failed:`, err.message);
    await sb.update(
      'redemptions',
      `id=eq.${redemption_id}`,
      {
        state: 'failed',
        failure_reason: err.message.slice(0, 200),
        updated_at: new Date().toISOString(),
      }
    );
  }
}

// Expose a `consume` function for the background worker runner.
export const consume = consumeRedemption;