import test from "node:test";
import assert from "node:assert/strict";
import { canAccessDashboard, canRegisterCr, isRecordAvailable, isStrongPassword, matchesLecturerRecord, matchesStudentRecord } from "../lib/auth/policy.ts";

const student = { registration_number: "TEST-ID", last_name: "LAST", year_of_study: 2 };
test("student verification requires registration, last name, and year from one exact record", () => {
  assert.equal(matchesStudentRecord(student, { registration: "TEST-ID", lastName: "LAST", year: 2 }), true);
  assert.equal(matchesStudentRecord(student, { registration: "TEST-ID", lastName: "last", year: 2 }), true);
  assert.equal(matchesStudentRecord(student, { registration: "OTHER-ID", lastName: "LAST", year: 2 }), false);
  assert.equal(matchesStudentRecord(student, { registration: "TEST-ID", lastName: "OTHER", year: 2 }), false);
  assert.equal(matchesStudentRecord(student, { registration: "TEST-ID", lastName: "LAST", year: 3 }), false);
});
test("lecturer verification requires the imported phone and last name", () => {
  assert.equal(matchesLecturerRecord({ phone_number: "0000000000", last_name: "LAST" }, { phone: "0000000000", lastName: "LAST" }), true);
  assert.equal(matchesLecturerRecord({ phone_number: "0000000000", last_name: "LAST" }, { phone: "1111111111", lastName: "LAST" }), false);
});
test("password validation rejects weak passwords", () => {
  assert.equal(isStrongPassword("weak"), false);
  assert.equal(isStrongPassword("Upperlower1234"), true);
});
test("dashboard permissions require exact valid role match", () => {
  assert.equal(canAccessDashboard("student", "admin"), false);
  assert.equal(canAccessDashboard("nobody", "nobody"), false);
  assert.equal(canAccessDashboard("admin", "admin"), true);
});
test("duplicate claims and self assigned CR privileges are rejected", () => {
  assert.equal(isRecordAvailable("claimed-user-id"), false);
  assert.equal(canRegisterCr(false, null), false);
  assert.equal(canRegisterCr(true, "claimed-user-id"), false);
  assert.equal(canRegisterCr(true, null), true);
});
