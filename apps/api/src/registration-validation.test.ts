import { describe, expect, it } from "vitest";
import {
  konguEmailSchema,
  normalizedEmailSchema,
  registrationPasswordSchema
} from "../../../shared/registration-validation.js";

describe("shared Kongu registration validation", () => {
  it.each([
    "student@kongu.edu",
    "first.last@kongu.edu",
    "student+lab@kongu.edu",
    "  Student+Lab@KONGU.EDU  "
  ])("accepts and normalizes valid Kongu address %s", (email) => {
    expect(konguEmailSchema.parse(email)).toBe(email.trim().toLowerCase());
  });

  it.each([
    "student@gmail.com",
    "student@kongu.ac.in",
    "student@other.edu",
    "studentkongu.edu",
    "student@@kongu.edu",
    "@kongu.edu",
    "student@kongu.edu.example",
    "",
    "   ",
    "not an email"
  ])("rejects invalid Kongu address %s", (email) => {
    expect(konguEmailSchema.safeParse(email).success).toBe(false);
  });

  it("normalizes otherwise valid login email without imposing registration policy", () => {
    expect(normalizedEmailSchema.parse("  Student@Example.edu  ")).toBe("student@example.edu");
  });

  it("accepts the required password and rejects missing or invalid characteristics", () => {
    expect(registrationPasswordSchema.safeParse("Campus@123").success).toBe(true);
    for (const password of [
      "campus@123",
      "CAMPUS@123",
      "Campus@abc",
      "Campus123",
      "Cam@12",
      "Campus @123",
      "",
      "Campus\t@123"
    ]) {
      expect(registrationPasswordSchema.safeParse(password).success, password).toBe(false);
    }
  });
});
