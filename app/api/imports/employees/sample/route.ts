/**
 * GET /api/imports/employees/sample
 *
 * Returns a tiny but illustrative employee CSV: one manager + four
 * reports, mixed regions/roles, demonstrating the optional columns
 * (managerEmail, status). Inline in this handler — kept short on
 * purpose so an operator can copy-paste-modify rather than navigate
 * GitHub for the format.
 */

const SAMPLE = `email,displayName,roleTag,region,managerEmail,status
priya.sharma@example.com,Priya Sharma,ENG_MGR,APAC,,ACTIVE
arjun.iyer@example.com,Arjun Iyer,ENG,APAC,priya.sharma@example.com,ACTIVE
maya.lee@example.com,Maya Lee,DS,APAC,priya.sharma@example.com,ACTIVE
nikhil.rao@example.com,Nikhil Rao,ENG,APAC,priya.sharma@example.com,ON_LEAVE
sara.koh@example.com,Sara Koh,PM,APAC,priya.sharma@example.com,ACTIVE
`;

export async function GET() {
  return new Response(SAMPLE, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="wdts-employees.sample.csv"',
    },
  });
}
