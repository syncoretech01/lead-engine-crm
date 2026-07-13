import { describe, expect, it } from "vitest";

import { isAllowedSnsTopic } from "@/lib/phase1/sns-message";

const OURS = "arn:aws:sns:us-east-1:111122223333:syncore-ses-events";
const FOREIGN = "arn:aws:sns:us-east-1:999988887777:attacker-topic";

describe("isAllowedSnsTopic", () => {
  it("is permissive when no allow-list is configured outside production (unbroken dev default)", () => {
    expect(isAllowedSnsTopic(FOREIGN, {})).toBe(true);
    expect(isAllowedSnsTopic(OURS, { SYNCORE_SES_TOPIC_ARNS: "" })).toBe(true);
    expect(isAllowedSnsTopic(OURS, { SYNCORE_SES_TOPIC_ARNS: "   " })).toBe(true);
    expect(isAllowedSnsTopic(FOREIGN, { NODE_ENV: "development" })).toBe(true);
  });

  it("fails closed when no allow-list is configured in production", () => {
    expect(isAllowedSnsTopic(OURS, { NODE_ENV: "production" })).toBe(false);
    expect(isAllowedSnsTopic(FOREIGN, { NODE_ENV: "production" })).toBe(false);
    expect(isAllowedSnsTopic(OURS, { NODE_ENV: "production", SYNCORE_SES_TOPIC_ARNS: "  " })).toBe(false);
  });

  it("accepts only configured ARNs even in production", () => {
    const env = { NODE_ENV: "production", SYNCORE_SES_TOPIC_ARNS: OURS };
    expect(isAllowedSnsTopic(OURS, env)).toBe(true);
    expect(isAllowedSnsTopic(FOREIGN, env)).toBe(false);
  });

  it("accepts only configured topic ARNs once the allow-list is set", () => {
    const env = { SYNCORE_SES_TOPIC_ARNS: OURS };
    expect(isAllowedSnsTopic(OURS, env)).toBe(true);
    expect(isAllowedSnsTopic(FOREIGN, env)).toBe(false);
    expect(isAllowedSnsTopic(undefined, env)).toBe(false);
  });

  it("supports multiple comma-separated ARNs with surrounding whitespace", () => {
    const env = { SYNCORE_SES_TOPIC_ARNS: ` ${OURS} , ${FOREIGN} ` };
    expect(isAllowedSnsTopic(OURS, env)).toBe(true);
    expect(isAllowedSnsTopic(FOREIGN, env)).toBe(true);
    expect(isAllowedSnsTopic("arn:aws:sns:us-east-1:000000000000:other", env)).toBe(false);
  });
});
