"""Serverless endpoint: entry-level Associate Software Engineer / AI-ML jobs.

Two buckets, both limited to listings posted in the last 72 hours:
  - lahore_onsite:     on-site roles in Lahore, Pakistan
  - worldwide_remote:  remote roles anywhere

Runs from a Vercel cron job (GET /api/scraper with the CRON_SECRET bearer
token), upserts the results into Postgres (DATABASE_URL), and returns a small
summary. The frontend reads the stored jobs via /api/jobs.

Locally: `python api/scraper.py` prints the JSON, `--save` also stores it.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

import pandas as pd
import psycopg
from jobspy import scrape_jobs

HOURS_OLD = 72
RESULTS_PER_QUERY = 30
SITES = ["linkedin", "indeed"]

SEARCH_TERMS = [
    "associate software engineer",
    "junior software engineer",
    "software engineer new grad",
    "junior python developer",
    "entry level AI engineer",
    "junior machine learning engineer",
]

# Titles must look like a software / AI-ML role and must not be senior-level.
TITLE_INCLUDE = re.compile(
    r"software|engineer|developer|machine learning|data scien|\bml\b|\bai\b|\bllm\b",
    re.I,
)
TITLE_EXCLUDE = re.compile(
    r"senior|\bsr\b|\blead\b|principal|staff|manager|director|\bhead\b|architect"
    r"|\b(ii|iii|iv|v)\b|industrial|telecom|voip|mechanical|electrical|civil"
    r"|\d+\s*[-–]\s*\d+\s*years?|\b[3-9]\+?\s*years?",
    re.I,
)

COLUMNS = [
    "title", "company", "location", "is_remote", "job_type", "date_posted",
    "min_amount", "max_amount", "currency", "site", "job_url",
]


def _scrape(term: str, remote: bool) -> pd.DataFrame:
    common = dict(
        search_term=term,
        results_wanted=RESULTS_PER_QUERY,
        hours_old=HOURS_OLD,
        linkedin_fetch_description=False,
    )
    if not remote:
        return scrape_jobs(
            site_name=SITES, location="Lahore, Pakistan",
            country_indeed="Pakistan", **common,
        )
    # Indeed's location="Remote" returns jobs it flags as remote. LinkedIn's
    # remote filter is ignored when hours_old is set, so its results are only
    # kept below if the title/location says remote.
    frames = [
        scrape_jobs(site_name=["indeed"], location="Remote", **common),
        scrape_jobs(
            site_name=["linkedin"], location="Worldwide",
            **{**common, "search_term": f"{term} remote"},
        ),
    ]
    return pd.concat([f.dropna(axis=1, how="all") for f in frames if not f.empty], ignore_index=True)


def _fetch(remote: bool) -> pd.DataFrame:
    frames = []
    for term in SEARCH_TERMS:
        try:
            df = _scrape(term, remote)
        except Exception as exc:  # one failing query shouldn't sink the rest
            print(f"scrape failed for {term!r} (remote={remote}): {exc}", file=sys.stderr)
            continue
        if df is not None and not df.empty:
            frames.append(df.dropna(axis=1, how="all"))

    if not frames:
        return pd.DataFrame(columns=COLUMNS)

    df = pd.concat(frames, ignore_index=True)

    flagged = df["is_remote"].fillna(False).astype(bool)
    if remote:
        in_text = (df["title"].fillna("") + " " + df["location"].fillna("")).str.contains(
            r"remote|work from home|anywhere", case=False
        )
        df = df[flagged | in_text].assign(is_remote=True)
    else:  # Lahore bucket is on-site only
        df = df[~flagged]

    title = df["title"].fillna("")
    df = df[title.str.contains(TITLE_INCLUDE) & ~title.str.contains(TITLE_EXCLUDE)]

    # Same posting is often listed once per location/site; keep the first.
    df = df.drop_duplicates(subset="job_url")
    df = df.drop_duplicates(subset=["title", "company"])
    df = df.sort_values("date_posted", ascending=False, na_position="last")

    for col in COLUMNS:
        if col not in df.columns:
            df[col] = None
    return df[COLUMNS]


def _to_records(df: pd.DataFrame) -> list:
    # Round-trip through to_json so NaN/NaT -> null and dates -> ISO strings.
    return json.loads(df.to_json(orient="records", date_format="iso"))


def build_payload() -> dict:
    lahore = _fetch(remote=False)
    remote = _fetch(remote=True)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "hours_old": HOURS_OLD,
        "counts": {"lahore_onsite": len(lahore), "worldwide_remote": len(remote)},
        "lahore_onsite": _to_records(lahore),
        "worldwide_remote": _to_records(remote),
    }


SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    job_url     TEXT PRIMARY KEY,
    bucket      TEXT NOT NULL,
    title       TEXT,
    company     TEXT,
    location    TEXT,
    is_remote   BOOLEAN,
    job_type    TEXT,
    date_posted TIMESTAMPTZ,
    min_amount  DOUBLE PRECISION,
    max_amount  DOUBLE PRECISION,
    currency    TEXT,
    site        TEXT,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_bucket_posted ON jobs (bucket, date_posted DESC);
"""

UPSERT = """
INSERT INTO jobs (job_url, bucket, title, company, location, is_remote, job_type,
                  date_posted, min_amount, max_amount, currency, site)
VALUES (%(job_url)s, %(bucket)s, %(title)s, %(company)s, %(location)s, %(is_remote)s,
        %(job_type)s, %(date_posted)s, %(min_amount)s, %(max_amount)s, %(currency)s, %(site)s)
ON CONFLICT (job_url) DO UPDATE SET
    bucket = EXCLUDED.bucket, title = EXCLUDED.title, company = EXCLUDED.company,
    location = EXCLUDED.location, is_remote = EXCLUDED.is_remote,
    job_type = EXCLUDED.job_type, date_posted = EXCLUDED.date_posted,
    min_amount = EXCLUDED.min_amount, max_amount = EXCLUDED.max_amount,
    currency = EXCLUDED.currency, site = EXCLUDED.site, last_seen = now()
"""


def save_jobs(payload: dict) -> int:
    rows = [
        {**job, "bucket": bucket}
        for bucket in ("lahore_onsite", "worldwide_remote")
        for job in payload[bucket]
    ]
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.execute(SCHEMA)
        with conn.cursor() as cur:
            cur.executemany(UPSERT, rows)
    return len(rows)


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        # Scraping takes ~90s, so only the cron job (or someone holding the
        # secret) may trigger it. Vercel sends "Authorization: Bearer $CRON_SECRET".
        secret = os.environ.get("CRON_SECRET")
        if not secret or self.headers.get("Authorization") != f"Bearer {secret}":
            return self._send(401, {"error": "unauthorized"})
        try:
            payload = build_payload()
            saved = save_jobs(payload)
            self._send(200, {"saved": saved, "counts": payload["counts"],
                             "generated_at": payload["generated_at"]})
        except Exception as exc:
            self._send(500, {"error": str(exc)})


if __name__ == "__main__":
    result = build_payload()
    if "--save" in sys.argv:
        print(f"saved {save_jobs(result)} jobs", file=sys.stderr)
    print(json.dumps(result, indent=2))
