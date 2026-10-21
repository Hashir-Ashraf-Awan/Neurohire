"""Serverless endpoint: entry-level Associate Software Engineer / AI-ML jobs.

Two buckets, both limited to listings posted in the last 72 hours:
  - lahore_onsite:     on-site roles in Lahore, Pakistan
  - worldwide_remote:  remote roles anywhere

GET /api/scraper -> JSON {"lahore_onsite": [...], "worldwide_remote": [...], ...}
"""
import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

import pandas as pd
from jobspy import scrape_jobs

HOURS_OLD = 72
RESULTS_PER_QUERY = 30
SITES = ["linkedin", "indeed"]

SEARCH_TERMS = [
    "associate software engineer",
    "junior software engineer",
    "entry level AI engineer",
    "junior machine learning engineer",
]

COLUMNS = [
    "title", "company", "location", "is_remote", "job_type", "date_posted",
    "min_amount", "max_amount", "currency", "site", "job_url",
]


def _fetch(location: str, remote: bool) -> pd.DataFrame:
    frames = []
    for term in SEARCH_TERMS:
        try:
            df = scrape_jobs(
                site_name=SITES,
                search_term=f"{term} remote" if remote else term,
                location=location,
                results_wanted=RESULTS_PER_QUERY,
                hours_old=HOURS_OLD,
                country_indeed="Pakistan" if not remote else "worldwide",
                linkedin_fetch_description=False,
            )
        except Exception as exc:  # one failing query shouldn't sink the rest
            print(f"scrape failed for {term!r} @ {location!r}: {exc}")
            continue
        if df is not None and not df.empty:
            frames.append(df)

    if not frames:
        return pd.DataFrame(columns=COLUMNS)

    df = pd.concat(frames, ignore_index=True)

    # Indeed can't combine hours_old with is_remote, so split by flag here.
    is_remote = df["is_remote"].fillna(False).astype(bool)
    df = df[is_remote] if remote else df[~is_remote]

    df = df.drop_duplicates(subset="job_url")
    df = df.drop_duplicates(subset=["title", "company", "location"])
    df = df.sort_values("date_posted", ascending=False, na_position="last")

    for col in COLUMNS:
        if col not in df.columns:
            df[col] = None
    return df[COLUMNS]


def _to_records(df: pd.DataFrame) -> list:
    # Round-trip through to_json so NaN/NaT -> null and dates -> ISO strings.
    return json.loads(df.to_json(orient="records", date_format="iso"))


def build_payload() -> dict:
    lahore = _fetch("Lahore, Pakistan", remote=False)
    remote = _fetch("Worldwide", remote=True)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "hours_old": HOURS_OLD,
        "counts": {"lahore_onsite": len(lahore), "worldwide_remote": len(remote)},
        "lahore_onsite": _to_records(lahore),
        "worldwide_remote": _to_records(remote),
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            body, status = build_payload(), 200
        except Exception as exc:
            body, status = {"error": str(exc)}, 500
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        # Cache at the edge for an hour; scraping is slow.
        self.send_header("Cache-Control", "s-maxage=3600, stale-while-revalidate")
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print(json.dumps(build_payload(), indent=2))
