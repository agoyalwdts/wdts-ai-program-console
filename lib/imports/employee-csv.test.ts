import { describe, expect, it } from "vitest";
import { parseCsv, validate, KNOWN_COLUMNS } from "./employee-csv";

describe("parseCsv", () => {
  it("accepts a minimal valid CSV with all required columns", () => {
    const csv = [
      "email,displayName,roleTag,region",
      "alice@wdts.com,Alice,ENG,APAC",
      "bob@wdts.com,Bob,PM,NA",
    ].join("\n");

    const { rows, parseErrors, unknownColumns } = parseCsv(csv);
    expect(parseErrors).toEqual([]);
    expect(unknownColumns).toEqual([]);
    expect(rows).toEqual([
      { email: "alice@wdts.com", displayName: "Alice", roleTag: "ENG", region: "APAC" },
      { email: "bob@wdts.com", displayName: "Bob", roleTag: "PM", region: "NA" },
    ]);
  });

  it("trims values, drops blank cells, and tolerates BOM + CRLF", () => {
    const csv =
      "\uFEFFemail,displayName,roleTag,region,managerEmail\r\n" +
      "  alice@wdts.com  ,  Alice  , ENG ,APAC,   \r\n" +
      "bob@wdts.com,Bob,PM,NA,alice@wdts.com\r\n";

    const { rows, parseErrors } = parseCsv(csv);
    expect(parseErrors).toEqual([]);
    expect(rows[0]).toEqual({
      email: "alice@wdts.com",
      displayName: "Alice",
      roleTag: "ENG",
      region: "APAC",
      // managerEmail was whitespace-only -> dropped
    });
    expect(rows[1]?.managerEmail).toBe("alice@wdts.com");
  });

  it("preserves quoted commas in displayName", () => {
    const csv = [
      "email,displayName,roleTag,region",
      'jane@wdts.com,"Doe, Jane",ENG,APAC',
    ].join("\n");
    const { rows } = parseCsv(csv);
    expect(rows[0]?.displayName).toBe("Doe, Jane");
  });

  it("flags unknown columns but doesn't reject the file", () => {
    const csv = [
      "email,displayName,roleTag,region,department,salary",
      "alice@wdts.com,Alice,ENG,APAC,Platform,200000",
    ].join("\n");
    const { rows, unknownColumns } = parseCsv(csv);
    expect(unknownColumns.sort()).toEqual(["department", "salary"]);
    // Known columns still parse; unknown columns are dropped from the row.
    expect(rows[0]).toEqual({
      email: "alice@wdts.com",
      displayName: "Alice",
      roleTag: "ENG",
      region: "APAC",
    });
    for (const k of Object.keys(rows[0]!)) {
      expect(KNOWN_COLUMNS).toContain(k);
    }
  });

  it("skips fully blank lines but keeps rows with some blanks", () => {
    const csv = [
      "email,displayName,roleTag,region",
      "alice@wdts.com,Alice,ENG,APAC",
      "",
      ",,,",
      "bob@wdts.com,Bob,PM,NA",
    ].join("\n");
    const { rows } = parseCsv(csv);
    // The fully-empty line is skipped; the all-commas line yields a row of
    // empties (caught later by validate()).
    const nonEmptyRows = rows.filter((r) => Object.keys(r).length > 0);
    expect(nonEmptyRows).toHaveLength(2);
  });
});

describe("validate", () => {
  const okHeaders = {
    email: "alice@wdts.com",
    displayName: "Alice",
    roleTag: "ENG",
    region: "APAC",
  };

  it("accepts the happy path with no existing users", () => {
    const { valid, errors } = validate([okHeaders], []);
    expect(errors).toEqual([]);
    expect(valid).toEqual([
      { ...okHeaders, managerEmail: null, status: "ACTIVE" },
    ]);
  });

  it("defaults status to ACTIVE when omitted, accepts ALLOWED_STATUSES", () => {
    const { valid, errors } = validate(
      [
        { ...okHeaders, email: "a@x.com" },
        { ...okHeaders, email: "b@x.com", status: "LEFT" },
        { ...okHeaders, email: "c@x.com", status: "ON_LEAVE" },
      ],
      [],
    );
    expect(errors).toEqual([]);
    expect(valid.map((r) => r.status)).toEqual(["ACTIVE", "LEFT", "ON_LEAVE"]);
  });

  it("rejects unknown status values", () => {
    const { valid, errors } = validate(
      [{ ...okHeaders, status: "TERMINATED" }],
      [],
    );
    expect(valid).toHaveLength(0);
    expect(errors[0]?.field).toBe("status");
    expect(errors[0]?.message).toMatch(/not a valid status/i);
  });

  it("flags missing required fields, one error per missing field", () => {
    const { valid, errors } = validate(
      [{ email: "alice@wdts.com" }],
      [],
    );
    expect(valid).toHaveLength(0);
    const missingFields = errors.map((e) => e.field).sort();
    expect(missingFields).toEqual(["displayName", "region", "roleTag"]);
  });

  it("flags malformed email addresses", () => {
    const { errors } = validate(
      [{ ...okHeaders, email: "not-an-email" }],
      [],
    );
    expect(errors.find((e) => e.field === "email")?.message).toMatch(
      /not a valid email/i,
    );
  });

  it("flags duplicate emails inside the file (case-insensitive)", () => {
    const { errors } = validate(
      [
        { ...okHeaders, email: "Alice@wdts.com" },
        { ...okHeaders, email: "alice@wdts.com" },
      ],
      [],
    );
    expect(errors.some((e) => e.message.match(/appears more than once/i))).toBe(
      true,
    );
  });

  it("flags self-referential manager (direct cycle)", () => {
    const { errors } = validate(
      [{ ...okHeaders, managerEmail: "alice@wdts.com" }],
      [],
    );
    expect(errors[0]?.field).toBe("managerEmail");
    expect(errors[0]?.message).toMatch(/own email/i);
  });

  it("resolves manager listed BELOW report in the file", () => {
    const { valid, errors } = validate(
      [
        { ...okHeaders, email: "report@wdts.com", managerEmail: "boss@wdts.com" },
        { ...okHeaders, email: "boss@wdts.com" },
      ],
      [],
    );
    expect(errors).toEqual([]);
    expect(valid).toHaveLength(2);
  });

  it("resolves manager already in the existing DB", () => {
    const { errors } = validate(
      [{ ...okHeaders, managerEmail: "existing.boss@wdts.com" }],
      ["existing.boss@wdts.com"],
    );
    expect(errors).toEqual([]);
  });

  it("rejects managerEmail that resolves to neither file nor DB", () => {
    const { errors } = validate(
      [{ ...okHeaders, managerEmail: "ghost@wdts.com" }],
      ["someoneelse@wdts.com"],
    );
    expect(errors[0]?.field).toBe("managerEmail");
    expect(errors[0]?.message).toMatch(/not in this file and not in the existing/i);
  });

  it("treats existing-email comparison as case-insensitive", () => {
    const { errors } = validate(
      [{ ...okHeaders, managerEmail: "Boss@WDTS.com" }],
      ["boss@wdts.com"],
    );
    expect(errors).toEqual([]);
  });
});
