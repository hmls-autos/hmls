import {
  calculateAudioCredits,
  calculateVideoCredits,
  CREDIT_COSTS,
  deductCredits,
  getCustomerCredits,
  type InputType,
} from "@hmls/agent";

export interface CreditCheck {
  hasEnough: boolean;
  balance: number;
  required: number;
}

export async function checkCredits(
  stripeCustomerId: string,
  inputType: InputType,
  durationSeconds?: number,
): Promise<CreditCheck> {
  const balance = await getCustomerCredits(stripeCustomerId);

  let required: number;
  switch (inputType) {
    case "audio":
      required = calculateAudioCredits(durationSeconds ?? 30);
      break;
    case "video":
      required = calculateVideoCredits(durationSeconds ?? 30);
      break;
    default:
      required = CREDIT_COSTS[inputType];
  }

  return {
    hasEnough: balance >= required,
    balance,
    required,
  };
}

export async function processCredits(
  stripeCustomerId: string,
  inputType: InputType,
  sessionId: number,
  durationSeconds?: number,
): Promise<{ charged: number } | Response> {
  const check = await checkCredits(
    stripeCustomerId,
    inputType,
    durationSeconds,
  );

  if (!check.hasEnough) {
    return new Response(
      JSON.stringify({
        error: "Insufficient credits",
        balance: check.balance,
        required: check.required,
        shortfall: check.required - check.balance,
      }),
      {
        status: 402,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  await deductCredits(
    stripeCustomerId,
    check.required,
    `Diagnostic session ${sessionId}: ${inputType} analysis`,
  );

  return { charged: check.required };
}
