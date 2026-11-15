export function isStrongPassword(password: string) {
  return password.length >= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password);
}
export function matchesStudentRecord(record: { registration_number: string; last_name: string; year_of_study: number }, input: { registration: string; lastName: string; year: number }) {
  return record.registration_number === input.registration.trim() && record.last_name.trim().replace(/\s+/g, " ").toLowerCase() === input.lastName.trim().replace(/\s+/g, " ").toLowerCase() && record.year_of_study === input.year;
}
export function matchesLecturerRecord(record: { phone_number: string; last_name: string }, input: { phone: string; lastName: string }) {
  return record.phone_number === input.phone.trim() && record.last_name.trim().replace(/\s+/g, " ").toLowerCase() === input.lastName.trim().replace(/\s+/g, " ").toLowerCase();
}
export function canAccessDashboard(actualRole: string, requestedRole: string) {
  return actualRole === requestedRole && ["student", "cr", "lecturer", "admin"].includes(actualRole);
}
export function effectiveDashboardRole(profileRole: string, administratorAuthorizedCr: boolean) {
  if (profileRole === "admin" || profileRole === "lecturer") return profileRole;
  if (profileRole === "student" || profileRole === "cr") return administratorAuthorizedCr ? "cr" : "student";
  return "invalid";
}
export function canRegisterCr(authorized: boolean, claimedBy: string | null) {
  return authorized && claimedBy === null;
}
export function isRecordAvailable(claimedBy: string | null) {
  return claimedBy === null;
}
