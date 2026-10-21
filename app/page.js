"use client";

import { useEffect, useMemo, useState } from "react";

const TABS = [
  { key: "lahore_onsite", label: "Lahore on-site", icon: "pin" },
  { key: "worldwide_remote", label: "Worldwide remote", icon: "globe" },
];
const SOURCES = [
  { id: "all", label: "All sources" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "indeed", label: "Indeed" },
];
const CACHE_KEY = "neurohire:v1";
const CACHE_MS = 60 * 60 * 1000;

const ICONS = {
  pin: <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Zm0-8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
  globe: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.5-2.4 3.8-5.4 3.8-9S14.5 5.4 12 3m0 18c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3M3 12h18" />,
  briefcase: <path d="M4 8h16v11H4V8Zm5 0V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16" />,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 1.5" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.5-3.5L4 9m0-5v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15m0 5v-5h-5" />,
  copy: <path d="M9 9h10v11H9V9Zm-4 6V4h10M" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  mail: <path d="M4 6h16v12H4V6Zm0 1 8 6 8-6" />,
};

function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function ageHours(iso) {
  return iso ? Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5) : null;
}

function timeAgo(iso) {
  const h = ageHours(iso);
  if (h === null) return "";
  if (h < 24) return "today";
  const d = Math.round(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

function salary(job) {
  if (!job.min_amount && !job.max_amount) return null;
  const fmt = (n) => (n ? Math.round(n).toLocaleString() : "?");
  return `${fmt(job.min_amount)} – ${fmt(job.max_amount)} ${job.currency || ""}`.trim();
}

function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (c && Date.now() - c.savedAt < CACHE_MS) return c.data;
  } catch {}
  return null;
}

function StatCard({ icon, title, value, loading, small }) {
  return (
    <div className="analytics-card">
      <div className="card-icon"><Icon name={icon} /></div>
      <div>
        <p className="card-title">{title}</p>
        {loading ? (
          <div className="shimmer" style={{ width: 60, height: 20 }} />
        ) : (
          <h3 className={`card-amount${small ? " small" : ""}`}>{value}</h3>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(TABS[0].key);
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(null);

  async function copyEmail(email) {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(email);
      setTimeout(() => setCopied((c) => (c === email ? null : c)), 1500);
    } catch {}
  }

  async function load(force = false) {
    setError(null);
    if (!force) {
      const cached = loadCache();
      if (cached) return setData(cached);
    }
    setData(null);
    try {
      const res = await fetch("/api/jobs");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setData(json);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: json })); } catch {}
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  const jobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.[tab] ?? []).filter(
      (j) =>
        (source === "all" || j.site === source) &&
        (!q || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q))
    );
  }, [data, tab, source, query]);

  const loading = !data && !error;
  const total = data ? data.counts.lahore_onsite + data.counts.worldwide_remote : 0;
  const postedToday = data
    ? [...data.lahore_onsite, ...data.worldwide_remote].filter((j) => ageHours(j.date_posted) < 24).length
    : 0;
  const activeTab = TABS.find((t) => t.key === tab);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="NeuroHire" />
          <img className="brand-mark-img" src="/mark.png" alt="NeuroHire" />
        </div>
        <div className="nav-label">Job feeds</div>
        {TABS.map((t) => (
          <button key={t.key} className={`nav-item${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} />
            {t.label}
            {data && <span className="badge">{data.counts[t.key]}</span>}
          </button>
        ))}
        <div className="sidebar-foot">Entry-level software &amp; AI/ML · last 72 hours</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <img className="topbar-mark" src="/mark.png" alt="" />
          <h1>NeuroHire</h1>
          <span className="spacer" />
          <input
            className="search"
            type="search"
            placeholder="Filter by title, company, location…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </header>

        <div className="page">
          <h2 className="welcome">Welcome <span className="rainbow">Hashir Ashraf</span></h2>

          <div className="page-header">
            <div className="period-filter">
              {SOURCES.map((s) => (
                <button key={s.id} className={`pill${source === s.id ? " active" : ""}`} onClick={() => setSource(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
            <button className="btn-refresh" onClick={() => load(true)} disabled={loading} title="Reload jobs">
              <span className={loading ? "spinning" : ""}><Icon name="refresh" size={15} /></span> Refresh
            </button>
          </div>

          <p className="range-note">
            <Icon name="clock" size={14} /> Showing: <strong>{activeTab.label}</strong> · posted in the last 72 hours
          </p>

          <div className="analytics-grid">
            <StatCard icon="briefcase" title="Total jobs" value={total} loading={loading} />
            <StatCard icon="pin" title="Lahore on-site" value={data?.counts.lahore_onsite} loading={loading} />
            <StatCard icon="globe" title="Worldwide remote" value={data?.counts.worldwide_remote} loading={loading} />
            <StatCard icon="spark" title="Posted today" value={postedToday} loading={loading} />
            <StatCard
              icon="clock"
              title="Last updated"
              value={data ? new Date(data.generated_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}
              loading={loading}
              small
            />
          </div>

          <div className="chart-tabs-bar" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`chart-tab-btn${tab === t.key ? " active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                <Icon name={t.icon} size={15} /> {t.label}
              </button>
            ))}
          </div>

          <div className="panel">
            {error && <p className="state error">Couldn’t load jobs: {error}</p>}
            {loading && (
              <div className="state">
                <img className="state-logo" src="/mark.png" alt="" />
                Loading jobs…
              </div>
            )}
            {data && jobs.length === 0 && (
              <div className="state">
                <img className="state-logo" src="/mark.png" alt="" />
                No matching jobs.
              </div>
            )}
            <ul className="jobs">
              {jobs.map((j, i) => (
                <li key={j.job_url}>
                  <div className="job" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                    <div className="job-body">
                      <h2>
                        <a href={j.job_url} target="_blank" rel="noopener noreferrer">{j.title}</a>
                      </h2>
                      <p className="company">{j.company}</p>
                      <p className="meta">
                        <span>{j.location}</span>
                        <span>{timeAgo(j.date_posted)}</span>
                        {salary(j) && <span>{salary(j)}</span>}
                      </p>
                      {j.emails && (
                        <p className="emails">
                          {j.emails.split(",").map((email) => (
                            <button key={email} className="email-chip" onClick={() => copyEmail(email)} title="Copy email">
                              <Icon name="mail" size={13} />
                              {email}
                              <Icon name={copied === email ? "check" : "copy"} size={13} />
                              {copied === email && <span className="copied">Copied</span>}
                            </button>
                          ))}
                        </p>
                      )}
                    </div>
                    {ageHours(j.date_posted) < 24 && <span className="tag today">New</span>}
                    <span className="tag">{j.site}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
