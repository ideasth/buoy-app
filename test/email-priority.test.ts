import { describe, expect, it } from "vitest";
import {
  evaluateEmailPriority,
  extractSenderEmail,
  PRIORITY_DOMAINS,
  PRIORITY_KEYWORDS,
  PRIORITY_SENDERS,
} from "../shared/email-priority";

describe("extractSenderEmail", () => {
  it("returns lower-cased email from a bare address", () => {
    expect(extractSenderEmail("Justin.Daly@MonashHealth.org")).toBe("justin.daly@monashhealth.org");
  });
  it("extracts the address from \"Name <addr>\" form", () => {
    expect(extractSenderEmail("Hannah Silby <Hannah.Silby@monashhealth.org>")).toBe(
      "hannah.silby@monashhealth.org",
    );
  });
  it("returns empty string for null/undefined/empty", () => {
    expect(extractSenderEmail(null)).toBe("");
    expect(extractSenderEmail(undefined)).toBe("");
    expect(extractSenderEmail("")).toBe("");
  });
  it("falls back to raw input when no email is recognised", () => {
    expect(extractSenderEmail("not-an-address")).toBe("not-an-address");
  });
});

describe("evaluateEmailPriority — domain matches", () => {
  it("flags Monash Health domain", () => {
    const r = evaluateEmailPriority({
      sender: "Hannah.Silby@monashhealth.org",
      subject: "Re: roster",
      bodyPreview: "",
    });
    expect(r.isPriority).toBe(true);
    expect(r.reason).toBe("domain:monashhealth.org");
  });
  it("flags Safer Care Victoria", () => {
    const r = evaluateEmailPriority({
      sender: "tanya.hodgkinson@safercare.vic.gov.au",
      subject: "OFFICIAL: SVC email",
      bodyPreview: "",
    });
    expect(r.isPriority).toBe(true);
  });
  it("flags AUPFHS / Elgin House", () => {
    const r = evaluateEmailPriority({
      sender: "someone@aupfhs.com.au",
      subject: "x",
      bodyPreview: "",
    });
    expect(r.isPriority).toBe(true);
  });
  it("flags Epworth main domain", () => {
    const r = evaluateEmailPriority({
      sender: "EpworthChiefMedicalOfficer@epworth.org.au",
      subject: "CE Forum",
      bodyPreview: "",
    });
    expect(r.isPriority).toBe(true);
  });
  it("flags Epworth Healthcare alt domain", () => {
    expect(
      evaluateEmailPriority({
        sender: "x@epworthhealthcare.org.au",
        subject: "y",
        bodyPreview: "",
      }).isPriority,
    ).toBe(true);
  });
  it("flags school (alia.vic.edu.au)", () => {
    expect(
      evaluateEmailPriority({
        sender: "office@alia.vic.edu.au",
        subject: "newsletter",
        bodyPreview: "",
      }).isPriority,
    ).toBe(true);
  });
  it("flags medicolegal assessments group by domain even without keyword in subject/body", () => {
    const r = evaluateEmailPriority({
      sender: "medneg@medicolegalassessmentsgroup.com.au",
      subject: "Booking CM: Karinna Evans",
      bodyPreview: "Specialist: Dr Justin Daly",
    });
    expect(r.isPriority).toBe(true);
    expect(r.reason).toBe("domain:medicolegalassessmentsgroup.com.au");
  });
  it("matches subdomains of priority domains", () => {
    expect(
      evaluateEmailPriority({
        sender: "alerts@mail.epworth.org.au",
        subject: "x",
        bodyPreview: "",
      }).isPriority,
    ).toBe(true);
  });
});

describe("evaluateEmailPriority — sender matches", () => {
  it("flags Marieke", () => {
    expect(
      evaluateEmailPriority({
        sender: "mariekedench@yahoo.com.au",
        subject: "hi",
        bodyPreview: "",
      }).isPriority,
    ).toBe(true);
  });
  it("flags Kathryn Daly via gmail", () => {
    expect(
      evaluateEmailPriority({
        sender: "kathrynsdaly@gmail.com",
        subject: "x",
        bodyPreview: "",
      }).isPriority,
    ).toBe(true);
  });
  it("flags Tilly Daly via icloud", () => {
    expect(
      evaluateEmailPriority({
        sender: "tillydaly@icloud.com",
        subject: "x",
        bodyPreview: "",
      }).isPriority,
    ).toBe(true);
  });
  it("does not flag a random gmail address", () => {
    expect(
      evaluateEmailPriority({
        sender: "stranger@gmail.com",
        subject: "x",
        bodyPreview: "",
      }).isPriority,
    ).toBe(false);
  });
});

describe("evaluateEmailPriority — keyword matches", () => {
  for (const kw of ["medicolegal", "medico-legal", "ranzcog", "theatre list", "iuga", "ugsa", "peninsula health"]) {
    it(`flags subject containing "${kw}"`, () => {
      const r = evaluateEmailPriority({
        sender: "stranger@example.com",
        subject: `Subject mentioning ${kw} matter`,
        bodyPreview: "",
      });
      expect(r.isPriority).toBe(true);
      expect(r.reason).toMatch(/^keyword:/);
    });
  }
  it("flags body preview containing 'theatre lists'", () => {
    expect(
      evaluateEmailPriority({
        sender: "x@example.com",
        subject: "FYI",
        bodyPreview: "Updated theatre lists for Friday",
      }).isPriority,
    ).toBe(true);
  });
  it("matches keywords case-insensitively", () => {
    expect(
      evaluateEmailPriority({
        sender: "x@example.com",
        subject: "RANZCOG update",
        bodyPreview: "",
      }).isPriority,
    ).toBe(true);
  });
  it("does NOT flag unrelated subjects/body from non-priority senders", () => {
    expect(
      evaluateEmailPriority({
        sender: "ads@example.com",
        subject: "Limited time offer",
        bodyPreview: "Click here",
      }).isPriority,
    ).toBe(false);
  });
});

describe("evaluateEmailPriority — no-reply rejection", () => {
  it("rejects no-reply@epworth.org.au even though the domain is a priority domain", () => {
    const r = evaluateEmailPriority({
      sender: "no-reply@epworth.org.au",
      subject: "Auto: Roster",
      bodyPreview: "",
    });
    expect(r.isPriority).toBe(false);
    expect(r.reason).toBe("no-reply rejected");
  });
  it("rejects noreply@... (no hyphen)", () => {
    expect(
      evaluateEmailPriority({
        sender: "noreply@monashhealth.org",
        subject: "x",
        bodyPreview: "",
      }).isPriority,
    ).toBe(false);
  });
  it("rejects newsletter@... even with priority keyword in subject", () => {
    expect(
      evaluateEmailPriority({
        sender: "newsletter@example.com",
        subject: "RANZCOG bulletin",
        bodyPreview: "",
      }).isPriority,
    ).toBe(false);
  });
  it("rejects mailer-daemon", () => {
    expect(
      evaluateEmailPriority({
        sender: "mailer-daemon@example.com",
        subject: "Undeliverable",
        bodyPreview: "",
      }).isPriority,
    ).toBe(false);
  });
  it("does NOT reject senders whose DOMAIN coincidentally contains 'newsletter'", () => {
    // Rule should match the local-part only, not the full address.
    const r = evaluateEmailPriority({
      sender: "alerts@newsletter-host.com",
      subject: "Theatre list update",
      bodyPreview: "",
    });
    // alerts@... is a clean local-part, subject contains keyword "theatre list".
    expect(r.isPriority).toBe(true);
  });
});

describe("evaluateEmailPriority — empty / malformed input", () => {
  it("returns false for empty sender", () => {
    expect(
      evaluateEmailPriority({ sender: "", subject: "x", bodyPreview: "y" }).isPriority,
    ).toBe(false);
  });
  it("returns false for null sender", () => {
    expect(
      evaluateEmailPriority({ sender: null, subject: "x", bodyPreview: "y" }).isPriority,
    ).toBe(false);
  });
  it("tolerates null subject and body", () => {
    expect(
      evaluateEmailPriority({
        sender: "Justin.Daly@monashhealth.org",
        subject: null,
        bodyPreview: null,
      }).isPriority,
    ).toBe(true);
  });
});

describe("constants — sanity checks", () => {
  it("PRIORITY_DOMAINS contains every CONTEXT.md-listed domain", () => {
    for (const d of [
      "aupfhs.com.au",
      "monashhealth.org",
      "safercare.vic.gov.au",
      "epworth.org.au",
      "epworthhealthcare.org.au",
      "alia.vic.edu.au",
      "medicolegalassessmentsgroup.com.au",
    ]) {
      expect(PRIORITY_DOMAINS).toContain(d);
    }
  });
  it("PRIORITY_SENDERS covers Marieke, Kathryn, Tilly, Poppy", () => {
    expect(PRIORITY_SENDERS.some((s) => s.includes("marieke"))).toBe(true);
    expect(PRIORITY_SENDERS.some((s) => s.includes("kathryn") || s.includes("spikyred"))).toBe(true);
    expect(PRIORITY_SENDERS.some((s) => s.includes("tilly") || s.includes("matilda"))).toBe(true);
    expect(PRIORITY_SENDERS.some((s) => s.includes("poppy") || s.includes("penelope"))).toBe(true);
  });
  it("PRIORITY_KEYWORDS contains the canonical set", () => {
    for (const k of [
      "medicolegal",
      "medico-legal",
      "ranzcog",
      "theatre list",
      "epworth",
      "iuga",
      "ugsa",
      "peninsula health",
    ]) {
      expect(PRIORITY_KEYWORDS).toContain(k);
    }
  });
});
