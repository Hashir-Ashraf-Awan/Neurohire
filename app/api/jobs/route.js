import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

const HOURS_OLD = 72;
const BUCKETS = ["lahore_onsite", "worldwide_remote"];

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT bucket, title, company, location, is_remote, job_type, date_posted,
             min_amount, max_amount, currency, site, job_url, emails, last_seen
      FROM jobs
      WHERE date_posted > now() - make_interval(hours => ${HOURS_OLD})
      ORDER BY date_posted DESC NULLS LAST`;

    const body = { hours_old: HOURS_OLD, generated_at: null, counts: {} };
    for (const b of BUCKETS) {
      body[b] = rows.filter((r) => r.bucket === b).map(({ bucket, last_seen, ...job }) => job);
      body.counts[b] = body[b].length;
    }
    const seen = await sql`SELECT max(last_seen) AS t FROM jobs`;
    body.generated_at = seen[0].t ?? new Date().toISOString();

    return Response.json(body, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=3600" },
    });
  } catch (e) {
    // Table doesn't exist until the scraper has run once.
    if (String(e.message).includes('relation "jobs" does not exist')) {
      return Response.json({
        hours_old: HOURS_OLD, generated_at: new Date().toISOString(),
        counts: { lahore_onsite: 0, worldwide_remote: 0 }, lahore_onsite: [], worldwide_remote: [],
      });
    }
    return Response.json({ error: e.message }, { status: 500 });
  }
}
