import assert from "assert/strict";

process.env.DRY_RUN = "true";

const { redactSecrets } = await import("../logger.js");
const { isUsableVolatility } = await import("../tools/screening.js");
const { getDeterministicCloseRule } = await import("../index.js");

function testSecretRedaction() {
  const input = {
    args: {
      walletKey: "abc123",
      nested: { llmApiKey: "sk-secretsecretsecretsecret" },
      safe: "hello",
    },
  };
  const redacted = redactSecrets(input);
  assert.equal(redacted.args.walletKey, "[REDACTED]");
  assert.equal(redacted.args.nested.llmApiKey, "[REDACTED]");
  assert.equal(redacted.args.safe, "hello");
}

function testVolatilityGuard() {
  assert.equal(isUsableVolatility(0), false);
  assert.equal(isUsableVolatility(null), false);
  assert.equal(isUsableVolatility(undefined), false);
  assert.equal(isUsableVolatility("not-a-number"), false);
  assert.equal(isUsableVolatility(0.01), true);
  assert.equal(isUsableVolatility("1.5"), true);
}

function testLowYieldAgeUsesConfig() {
  const position = {
    position: "test-position",
    pair: "TEST-SOL",
    pnl_pct: 0,
    total_value_usd: 100,
    fee_per_tvl_24h: 1,
    age_minutes: 90,
  };
  const baseConfig = {
    stopLossPct: -50,
    takeProfitPct: 5,
    outOfRangeBinsToClose: 10,
    downsideOutOfRangeBinsToClose: 8,
    downsideOutOfRangeWaitMinutes: 10,
    outOfRangeWaitMinutes: 30,
    minFeePerTvl24h: 7,
  };

  assert.equal(getDeterministicCloseRule(position, { ...baseConfig, minAgeBeforeYieldCheck: 120 }), null);
  assert.deepEqual(
    getDeterministicCloseRule(position, { ...baseConfig, minAgeBeforeYieldCheck: 60 }),
    { action: "CLOSE", rule: 5, reason: "low yield" },
  );
}

testSecretRedaction();
testVolatilityGuard();
testLowYieldAgeUsesConfig();

console.log("Regression tests passed");
process.exit(0);
