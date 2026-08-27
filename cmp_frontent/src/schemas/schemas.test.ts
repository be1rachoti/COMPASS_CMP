/**
 * The validation layer, checked against the bounds it claims to mirror.
 *
 * The bounds in the first block are taken from `cmp/validation/*.py`. If one of
 * these fails, the correct fix is almost always to change *this* side: the
 * server is the authority, and a client bound that has drifted from it produces
 * either a form that 422s after passing, or a form that refuses input the
 * system would have taken.
 */

import { describe, expect, it } from "vitest";

import { contact, email, mobile } from "@/schemas/contacts";
import { MANIFEST, PROOF, describeSize, fileSchema } from "@/schemas/files";
import {
  codeText,
  dateOnly,
  dateTimeLocal,
  future,
  futureDateTime,
  httpUrl,
  optional,
  pastOrToday,
  refText,
  shortText,
  uuid,
} from "@/schemas/primitives";
import { otpCode, password, passwordWithConfirmation } from "@/schemas/security";
import { agentSchema, approvalSchema } from "@/features/projects/schemas";
import { processorSchema, purposeSchema } from "@/features/registry/schemas";
import { passwordSignInSchema } from "@/features/auth/schemas";

/** Bounds copied from the server's validation package. Keep them in step. */
const SERVER = {
  shortText: 200,
  refText: 120,
  codeText: 80,
  httpUrl: 2000,
  email: 255,
  mobileMin: 6,
  mobileMax: 20,
  passwordMin: 12,
  passwordMax: 128,
  proofBytes: 25 * 1024 * 1024,
  manifestBytes: 25 * 1024 * 1024,
};

describe("bounds match the API's", () => {
  it("shortText stops where varchar(200) does", () => {
    const field = shortText("A name");
    expect(field.safeParse("x".repeat(SERVER.shortText)).success).toBe(true);
    expect(field.safeParse("x".repeat(SERVER.shortText + 1)).success).toBe(false);
  });

  it("refText stops where varchar(120) does", () => {
    const field = refText("A reference");
    expect(field.safeParse("x".repeat(SERVER.refText)).success).toBe(true);
    expect(field.safeParse("x".repeat(SERVER.refText + 1)).success).toBe(false);
  });

  it("codeText matches the server's character class exactly", () => {
    const field = codeText("A code");
    expect(field.safeParse("LOYALTY_ENROL").success).toBe(true);
    expect(field.safeParse("A1.b-c_d").success).toBe(true);
    // Must start with a letter or digit: a leading separator breaks a URL path
    // and a CSV column on the same day.
    expect(field.safeParse("_leading").success).toBe(false);
    expect(field.safeParse("-leading").success).toBe(false);
    expect(field.safeParse("has space").success).toBe(false);
    expect(field.safeParse("has/slash").success).toBe(false);
    expect(field.safeParse("x".repeat(SERVER.codeText + 1)).success).toBe(false);
  });

  it("httpUrl permits only schemes a person can follow", () => {
    const field = httpUrl("The withdrawal URL");
    expect(field.safeParse("https://example.org/withdraw").success).toBe(true);
    expect(field.safeParse("http://example.org/withdraw").success).toBe(true);
    expect(field.safeParse("javascript:alert(1)").success).toBe(false);
    expect(field.safeParse("data:text/html,<script>").success).toBe(false);
    expect(field.safeParse("ftp://example.org/f").success).toBe(false);
  });

  it("mobile accepts the ways people actually write Indian numbers", () => {
    // Deliberately permissive. A number we cannot reach is worse than a number
    // stored with a space in it, and a data subject's mobile is how they sign
    // in - rejecting a real one locks them out of their own consent record.
    for (const value of ["+91 98765 43210", "9876543210", "+91-98765-43210"]) {
      expect(mobile.safeParse(value).success).toBe(true);
    }
    expect(mobile.safeParse("98765".slice(0, SERVER.mobileMin - 2)).success).toBe(false);
    expect(mobile.safeParse("1".repeat(SERVER.mobileMax + 1)).success).toBe(false);
    expect(mobile.safeParse("+91 (987) 654-3210").success).toBe(false);
  });

  it("password is bounded at both ends, and the maximum is the DoS control", () => {
    // Argon2id is deliberately expensive. Hashing an unbounded password is a
    // way to make the server do unbounded work per request.
    expect(password.safeParse("x".repeat(SERVER.passwordMin - 1)).success).toBe(false);
    expect(password.safeParse("x".repeat(SERVER.passwordMin)).success).toBe(true);
    expect(password.safeParse("x".repeat(SERVER.passwordMax)).success).toBe(true);
    expect(password.safeParse("x".repeat(SERVER.passwordMax + 1)).success).toBe(false);
  });

  it("password imposes no composition rules", () => {
    // A twelve-character passphrase resists guessing better than P@ss1! and
    // people can remember it, so they do not write it on a card.
    expect(password.safeParse("correct horse battery staple").success).toBe(true);
  });

  it("upload sizes match the server's", () => {
    expect(PROOF.maxBytes).toBe(SERVER.proofBytes);
    expect(MANIFEST.maxBytes).toBe(SERVER.manifestBytes);
  });
});

describe("primitives", () => {
  it("optional turns a blank box into null, not an empty string", () => {
    // `""` is a value the column holds and a NOT NULL check passes, so it
    // becomes a stored blank that renders as an empty cell nobody can explain.
    const field = optional(shortText("Anything"));
    expect(field.parse("")).toBeNull();
    expect(field.parse(undefined)).toBeNull();
    expect(field.parse(null)).toBeNull();
    expect(field.parse("a value")).toBe("a value");
  });

  it("optional still validates a value that is present", () => {
    const field = optional(shortText("A name"));
    expect(field.safeParse("x".repeat(201)).success).toBe(false);
  });

  it("dateOnly rejects a well-shaped date that does not exist", () => {
    const field = dateOnly("The approval date");
    expect(field.safeParse("2026-02-28").success).toBe(true);
    expect(field.safeParse("2026-02-31").success).toBe(false);
    expect(field.safeParse("2026-13-01").success).toBe(false);
    expect(field.safeParse("28-02-2026").success).toBe(false);
  });

  it("pastOrToday refuses an approval dated tomorrow", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    expect(pastOrToday("The approval date").safeParse(today).success).toBe(true);
    expect(pastOrToday("The approval date").safeParse(tomorrow).success).toBe(false);
  });

  it("future refuses a link that expires in the past", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    expect(future("The expiry").safeParse(nextWeek).success).toBe(true);
    expect(future("The expiry").safeParse(yesterday).success).toBe(false);
  });

  it("uuid refuses an integer id", () => {
    // There is no integer-id type in this package for the same reason there is
    // none in the server's.
    expect(uuid().safeParse("42").success).toBe(false);
    expect(uuid().safeParse("22222222-2222-4222-8222-222222222222").success).toBe(true);
  });

  it("messages say what the field is for", () => {
    // A Zod default reads "String must contain at most 200 character(s)", which
    // describes the rule and not what to do about it.
    const result = shortText("A project name").safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("A project name is required");
    }
  });
});

describe("credentials", () => {
  it("otpCode is digits only, so a phone opens a numeric keyboard", () => {
    expect(otpCode.safeParse("123456").success).toBe(true);
    expect(otpCode.safeParse("12 34 56").success).toBe(false);
    expect(otpCode.safeParse("abcdef").success).toBe(false);
  });

  it("a mismatched confirmation is reported on the confirmation field", () => {
    // Not on the form root, which is not where the user is looking.
    const result = passwordWithConfirmation.safeParse({
      password: "correct horse battery staple",
      confirm_password: "correct horse battery stapler",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["confirm_password"]);
    }
  });

  it("sign-in stays loose about the shape of a credential", () => {
    // Refusing "that is not a valid email address" before the request is sent
    // confirms to an unauthenticated visitor which strings are shaped like
    // accounts here. The server answers the same way either way, and so does
    // this form.
    expect(passwordSignInSchema.safeParse({ login: "asha", password: "x" }).success).toBe(true);
    expect(
      passwordSignInSchema.safeParse({ login: "not-an-email", password: "short" }).success,
    ).toBe(true);
    expect(contact.safeParse("+91 98765 43210").success).toBe(true);
    expect(email.safeParse("asha@organisation.example").success).toBe(true);
  });
});

describe("purpose cross-field rules", () => {
  const base = {
    purpose_code: "LOYALTY_ENROL",
    name: "Loyalty enrolment",
    description: "Enrolling a customer in the loyalty programme.",
    uses: "Issuing a membership number and applying member pricing.",
    lawful_basis: "consent_s6",
    s7_clause: null,
    data_categories: ["contact.name"],
    retention_days: 365,
    retention_basis: "Membership term.",
    erasure_trigger: "withdrawal",
    consent_validity_days: null,
    cross_border_permitted: false,
    permitted_for_minors: false,
    lapse_behaviour: "stop_processing",
  };

  it("requires at least one data category", () => {
    // Rule 3(b)(i): a notice has to itemise them, so a purpose with none
    // cannot appear in one.
    expect(purposeSchema.safeParse({ ...base, data_categories: [] }).success).toBe(false);
  });

  it("requires an s.7 purpose to name its clause", () => {
    const result = purposeSchema.safeParse({
      ...base,
      lawful_basis: "legitimate_use_s7",
      s7_clause: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("s7_clause"))).toBe(true);
    }
  });

  it("refuses an s.7 clause on a consent purpose", () => {
    expect(
      purposeSchema.safeParse({ ...base, lawful_basis: "consent_s6", s7_clause: "s7_a" })
        .success,
    ).toBe(false);
  });

  it("refuses cross-border transfer on a purpose permitted for minors", () => {
    // s.9 turns on this, and it should be a decision somebody makes rather than
    // one that happens by leaving two switches on.
    expect(
      purposeSchema.safeParse({
        ...base,
        permitted_for_minors: true,
        cross_border_permitted: true,
      }).success,
    ).toBe(false);
  });

  it("accepts a well-formed consent purpose", () => {
    expect(purposeSchema.safeParse(base).success).toBe(true);
  });
});

describe("uploads", () => {
  function file(name: string, type: string, size: number): File {
    const f = new File(["x"], name, { type });
    Object.defineProperty(f, "size", { value: size });
    return f;
  }

  it("accepts a manifest whose MIME type the browser got wrong", () => {
    // Chrome sends text/csv; a machine with Excel installed sends
    // application/vnd.ms-excel; some send nothing. Refusing on MIME alone would
    // reject a good manifest depending on what the user has installed, which is
    // not a rule anybody can act on.
    const schema = fileSchema(MANIFEST);
    expect(schema.safeParse(file("rows.csv", "application/vnd.ms-excel", 1024)).success).toBe(
      true,
    );
    expect(schema.safeParse(file("rows.csv", "", 1024)).success).toBe(true);
  });

  it("refuses a file that is too large before it is uploaded", () => {
    const schema = fileSchema(PROOF);
    expect(schema.safeParse(file("scan.pdf", "application/pdf", PROOF.maxBytes)).success).toBe(
      true,
    );
    expect(
      schema.safeParse(file("scan.pdf", "application/pdf", PROOF.maxBytes + 1)).success,
    ).toBe(false);
  });

  it("refuses an empty file", () => {
    expect(fileSchema(PROOF).safeParse(file("scan.pdf", "application/pdf", 0)).success).toBe(
      false,
    );
  });

  it("refuses a type neither the MIME nor the suffix vouches for", () => {
    expect(
      fileSchema(PROOF).safeParse(file("payload.exe", "application/octet-stream", 1024)).success,
    ).toBe(false);
  });

  it("describes a size in units a person reads", () => {
    expect(describeSize(25 * 1024 * 1024)).toBe("25 MB");
    expect(describeSize(400 * 1024)).toBe("400 KB");
  });
});

describe("a validator matches the input that feeds it", () => {
  /**
   * Two bugs shipped from this mismatch, so it gets its own block.
   *
   * `<input type="date">` produces `YYYY-MM-DD`; `<input type="datetime-local">`
   * produces `YYYY-MM-DDTHH:mm`. A date-only validator behind a datetime input
   * rejects *every* value a user can enter, and says "has to be a date" — which
   * it is, in the sense the person meant.
   *
   * These assert the pairing at the schema level, where it is cheap, rather
   * than leaving it to a browser test nobody runs before shipping.
   */

  it("dateOnly refuses a datetime — it is behind type=date", () => {
    expect(dateOnly("The date").safeParse("2027-02-06").success).toBe(true);
    expect(dateOnly("The date").safeParse("2027-02-06T14:24").success).toBe(false);
  });

  it("dateTimeLocal accepts what a datetime-local input produces", () => {
    const field = dateTimeLocal("The expiry");
    expect(field.safeParse("2027-02-06T14:24").success).toBe(true);
    // Browsers append seconds when the input has a sub-minute step. A validator
    // that refused this would fail on some machines and not others.
    expect(field.safeParse("2027-02-06T14:24:30").success).toBe(true);
    expect(field.safeParse("2027-02-06").success).toBe(false);
    expect(field.safeParse("06-02-2027 14:24").success).toBe(false);
  });

  it("futureDateTime compares against now, not against today", () => {
    // A link expiring at 09:00 today is already dead by the afternoon, so a
    // date-level comparison would mint something unusable.
    const field = futureDateTime("The expiry");
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const local = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

    expect(field.safeParse(local(soon)).success).toBe(true);
    expect(field.safeParse(local(past)).success).toBe(false);
  });

  it("the agent link form accepts a real datetime-local value", () => {
    // The exact shape the reported failure used.
    const inOneYear = new Date(Date.now() + 365 * 86_400_000);
    const value = new Date(inOneYear.getTime() - inOneYear.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);

    const result = agentSchema.safeParse({
      expires_at: value,
      max_uses: null,
      agent_ref: "",
    });

    expect(result.success, JSON.stringify(result.success ? {} : result.error.issues)).toBe(true);
  });

  it("the approval form accepts today, and needs its proof", () => {
    const today = new Date().toISOString().slice(0, 10);
    const proof = new File(["x"], "FLOW.png", { type: "image/png" });
    Object.defineProperty(proof, "size", { value: 1_500_000 });

    const complete = approvalSchema.safeParse({
      approval_type: "security",
      reference_no: "xzc",
      approved_on: today,
      proof,
    });
    expect(complete.success, JSON.stringify(complete.success ? {} : complete.error.issues)).toBe(
      true,
    );

    // The proof is what makes the approval count, so its absence is a failure
    // on `proof` — which is only useful if a control is bound to that error.
    const noProof = approvalSchema.safeParse({
      approval_type: "security",
      reference_no: "xzc",
      approved_on: today,
    });
    expect(noProof.success).toBe(false);
    if (!noProof.success) {
      expect(noProof.error.issues.some((i) => i.path.includes("proof"))).toBe(true);
    }
  });

  it("the processor form takes a date, not a datetime", () => {
    expect(
      processorSchema.safeParse({
        legal_name: "Acme Vision Ltd",
        type: "vendor",
        contract_ref: "C-2026-1",
        security_confirmed_at: new Date().toISOString().slice(0, 10),
      }).success,
    ).toBe(true);
  });

  it("a processor is third-party unless somebody says otherwise", () => {
    // The direction of the default is the assertion. An unanswered question
    // routes the project through a DCO Admin, which is the path with the extra
    // pair of eyes; flipping it would send projects straight back to their own
    // author on a field nobody filled in.
    const parsed = processorSchema.safeParse({
      legal_name: "Acme Vision Ltd",
      type: "vendor",
      contract_ref: "C-2026-1",
      security_confirmed_at: new Date().toISOString().slice(0, 10),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.is_in_house).toBe(false);
  });
});
