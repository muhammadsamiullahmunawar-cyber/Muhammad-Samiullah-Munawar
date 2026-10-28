import { describe, expect, it } from "vitest";
import { passwordSchema, passwordScore, signupSchema } from "./password";

describe("password rules", () => {
  it("rejects passwords shorter than 10 characters", () => {
    expect(passwordSchema.safeParse("Ab1!xyz").success).toBe(false);
    expect(passwordScore("Ab1!xyzab")).toBe(0);
  });
  it("rejects weak 10+ char passwords", () => {
    expect(passwordSchema.safeParse("aaaaaaaaaaaa").success).toBe(false);
  });
  it("accepts a strong password", () => {
    expect(passwordSchema.safeParse("Tate-Secure-2026").success).toBe(true);
  });
  it("rejects invalid usernames", () => {
    expect(
      signupSchema.safeParse({
        email: "a@b.co",
        username: "no spaces",
        password: "Tate-Secure-2026",
      }).success,
    ).toBe(false);
  });
});
