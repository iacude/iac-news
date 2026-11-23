#!/usr/bin/env python3
"""
Fetch publication metadata from ORCID and write a static JSON file for GitHub Pages.

Typical use:
    python fetch_publications.py \
      --orcid-file orcids.txt \
      --out docs/data/publications.json \
      --with-details --detail-count 80 \
      --with-crossref --with-pubmed --with-s2

Output format: a JSON array. This intentionally stays compatible with the Imperia
widget: [{title, authors, journal, abstract, abstract_source, doi, url, date, orcid, put_code}, ...]
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote

import requests

API_BASE = "https://pub.orcid.org/v3.0"
ORCID_RE = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$", re.IGNORECASE)
DEFAULT_USER_AGENT = "iac-publications-widget/1.0 (static GitHub Pages publication news)"


Publication = Dict[str, Any]


@dataclass(frozen=True)
class FetchConfig:
    user_agent: str = DEFAULT_USER_AGENT
    timeout: int = 20
    pause_seconds: float = 0.15
    mailto: Optional[str] = None

    @property
    def headers(self) -> Dict[str, str]:
        ua = self.user_agent
        if self.mailto and "mailto:" not in ua.lower():
            ua = f"{ua} (mailto:{self.mailto})"
        return {"Accept": "application/json", "User-Agent": ua}


def load_orcid_ids(path: Path) -> List[str]:
    ids: List[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if not ORCID_RE.match(line):
            print(f"[WARN] Ignoring invalid ORCID iD: {line}", file=sys.stderr)
            continue
        if line not in ids:
            ids.append(line)
    return ids


def fetch_json(session: requests.Session, url: str, cfg: FetchConfig) -> Optional[Dict[str, Any]]:
    try:
        response = session.get(url, headers=cfg.headers, timeout=cfg.timeout)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        print(f"[WARN] Request failed: {url}: {exc}", file=sys.stderr)
    except ValueError as exc:
        print(f"[WARN] JSON parse failed: {url}: {exc}", file=sys.stderr)
    return None


def safe_value(node: Optional[Dict[str, Any]]) -> Optional[int]:
    if not node:
        return None
    try:
        return int(node.get("value"))
    except (TypeError, ValueError):
        return None


def format_publication_date(pub_date: Optional[Dict[str, Any]]) -> Optional[str]:
    if not pub_date:
        return None
    year = safe_value(pub_date.get("year"))
    month = safe_value(pub_date.get("month"))
    day = safe_value(pub_date.get("day"))
    if not year:
        return None
    if month and day:
        return f"{year:04d}-{month:02d}-{day:02d}"
    if month:
        return f"{year:04d}-{month:02d}"
    return f"{year:04d}"


def parse_date_parts(date_str: Optional[str]) -> Tuple[int, int, int]:
    if not date_str:
        return (0, 0, 0)
    match = re.match(r"^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$", str(date_str).strip())
    if not match:
        return (0, 0, 0)
    year = int(match.group(1))
    month = int(match.group(2) or 0)
    day = int(match.group(3) or 0)
    return (year, month, day)


def sort_key(pub: Publication) -> Tuple[int, int, int, str]:
    return (*parse_date_parts(pub.get("date")), (pub.get("title") or "").lower())


def strip_html_tags(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text)


def compact_text(text: str) -> str:
    return " ".join(html.unescape(text).split())


def clean_text(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    cleaned = compact_text(strip_html_tags(str(text))).strip()
    cleaned = re.sub(r"^abstract\s*[:\-–—]?\s*", "", cleaned, flags=re.IGNORECASE)
    return cleaned or None


def normalize_doi(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    doi = str(value).strip()
    doi = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", doi, flags=re.IGNORECASE)
    doi = re.sub(r"^doi:\s*", "", doi, flags=re.IGNORECASE)
    doi = doi.strip().rstrip(".")
    return doi or None


def doi_to_url(doi: Optional[str]) -> Optional[str]:
    return f"https://doi.org/{doi}" if doi else None


def extract_external_ids(node: Dict[str, Any]) -> Dict[str, str]:
    result: Dict[str, str] = {}
    ext_list = ((node.get("external-ids") or {}).get("external-id") or [])
    for ext in ext_list:
        ext_type = (ext.get("external-id-type") or "").strip().lower()
        ext_value = (ext.get("external-id-value") or "").strip()
        if ext_type and ext_value and ext_type not in result:
            result[ext_type] = ext_value
    if "doi" in result:
        normalized = normalize_doi(result["doi"])
        if normalized:
            result["doi"] = normalized
    return result


def extract_title(node: Dict[str, Any]) -> Optional[str]:
    return clean_text((((node.get("title") or {}).get("title") or {}).get("value")))


def extract_journal(node: Dict[str, Any]) -> Optional[str]:
    return clean_text((node.get("journal-title") or {}).get("value"))


def extract_authors_from_detail(detail: Dict[str, Any]) -> Optional[str]:
    contributors = ((detail.get("contributors") or {}).get("contributor") or [])
    names: List[str] = []
    for contrib in contributors:
        credit_name = clean_text((contrib.get("credit-name") or {}).get("value"))
        if credit_name:
            names.append(credit_name)
            continue
        orcid_name = contrib.get("contributor-orcid-name") or {}
        given = clean_text((orcid_name.get("given-names") or {}).get("value"))
        family = clean_text((orcid_name.get("family-name") or {}).get("value"))
        full = " ".join(part for part in [given, family] if part).strip()
        if full:
            names.append(full)
    # Preserve order while removing duplicate names.
    seen = set()
    unique = []
    for name in names:
        key = name.lower()
        if key not in seen:
            unique.append(name)
            seen.add(key)
    return ", ".join(unique) if unique else None


def is_bibtex(text: str) -> bool:
    return text.lstrip().startswith("@") and "{" in text[:50]


def extract_abstract_from_detail(detail: Dict[str, Any]) -> Optional[str]:
    short_description = clean_text(detail.get("short-description"))
    if short_description:
        return short_description
    citation = (detail.get("citation") or {}).get("citation-value")
    if citation and not is_bibtex(citation):
        return clean_text(citation)
    return None


def parse_work_summary(orcid: str, summary: Dict[str, Any]) -> Publication:
    ext_ids = extract_external_ids(summary)
    doi = ext_ids.get("doi")
    url = (summary.get("url") or {}).get("value") or doi_to_url(doi)
    return {
        "title": extract_title(summary),
        "authors": "",
        "journal": extract_journal(summary),
        "abstract": "",
        "abstract_source": "none",
        "doi": doi,
        "url": url,
        "date": format_publication_date(summary.get("publication-date")),
        "orcid": orcid,
        "put_code": summary.get("put-code"),
        "type": summary.get("type"),
    }


def iter_work_summaries(works_json: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    for group in works_json.get("group", []):
        summaries = group.get("work-summary") or []
        if summaries:
            yield summaries[0]


def dedupe_key(pub: Publication) -> str:
    doi = normalize_doi(pub.get("doi"))
    if doi:
        return f"doi:{doi.lower()}"
    title = re.sub(r"\s+", " ", (pub.get("title") or "").strip().lower())
    return f"title:{title}"


def merge_publication(existing: Publication, new: Publication) -> Publication:
    # Prefer existing order but fill missing fields from duplicate record.
    merged = dict(existing)
    for field in ["title", "authors", "journal", "abstract", "doi", "url", "date", "type"]:
        if not merged.get(field) and new.get(field):
            merged[field] = new[field]
    if existing.get("abstract_source") == "none" and new.get("abstract_source") != "none":
        merged["abstract_source"] = new.get("abstract_source")
    existing_orcids = [x for x in str(merged.get("orcid") or "").split(";") if x]
    new_orcid = new.get("orcid")
    if new_orcid and new_orcid not in existing_orcids:
        existing_orcids.append(new_orcid)
        merged["orcid"] = ";".join(existing_orcids)
    return merged


def collect_publications(orcid_ids: Sequence[str], cfg: FetchConfig) -> List[Publication]:
    by_key: Dict[str, Publication] = {}
    with requests.Session() as session:
        for orcid in orcid_ids:
            url = f"{API_BASE}/{orcid}/works"
            data = fetch_json(session, url, cfg)
            time.sleep(cfg.pause_seconds)
            if not data:
                continue
            for summary in iter_work_summaries(data):
                pub = parse_work_summary(orcid, summary)
                if not pub.get("title"):
                    continue
                key = dedupe_key(pub)
                if key in by_key:
                    by_key[key] = merge_publication(by_key[key], pub)
                else:
                    by_key[key] = pub
    pubs = list(by_key.values())
    pubs.sort(key=sort_key, reverse=True)
    return pubs


def fetch_work_detail(session: requests.Session, orcid: str, put_code: Any, cfg: FetchConfig) -> Optional[Dict[str, Any]]:
    return fetch_json(session, f"{API_BASE}/{orcid}/work/{put_code}", cfg)


def fetch_crossref_work(session: requests.Session, doi: Optional[str], cfg: FetchConfig) -> Dict[str, Any]:
    doi = normalize_doi(doi)
    if not doi:
        return {}
    data = fetch_json(session, f"https://api.crossref.org/works/{quote(doi, safe='')}", cfg)
    return (data or {}).get("message") or {}


def needs_author_metadata(authors: Optional[str]) -> bool:
    if not authors or not authors.strip():
        return True
    parts = [part.strip() for part in authors.split(",")]
    return len(parts) > 1 and all(
        re.fullmatch(r"(?:[A-Z][.\s-]*){1,4}", part) for part in parts[1::2]
    )


def crossref_author_names(work: Dict[str, Any]) -> Optional[str]:
    names = []
    for author in work.get("author") or []:
        full_name = " ".join(
            value for field in ("given", "family") if (value := clean_text(author.get(field)))
        )
        name = full_name or clean_text(author.get("name"))
        if name:
            names.append(name.replace(",", ""))
    return ", ".join(names) or None


def crossref_online_date(work: Dict[str, Any]) -> Optional[str]:
    dates = (work.get("published-online") or {}).get("date-parts") or []
    if not dates:
        return None
    parts = dates[0]
    if not isinstance(parts, list) or not 1 <= len(parts) <= 3:
        return None
    if any(type(part) is not int for part in parts):
        return None
    try:
        date = dt.date(*(parts + [1] * (3 - len(parts))))
    except ValueError:
        return None
    return date.isoformat()[: (4, 7, 10)[len(parts) - 1]]


def load_date_overrides(path: Path) -> Dict[str, str]:
    overrides = {}
    for doi, value in json.loads(path.read_text(encoding="utf-8")).items():
        key = normalize_doi(doi)
        if not key:
            raise ValueError(f"Invalid DOI in {path}: {doi}")
        date = dt.date.fromisoformat(value)
        if date.isoformat() != value:
            raise ValueError(f"Expected YYYY-MM-DD for {doi} in {path}")
        overrides[key.lower()] = value
    return overrides


def fetch_semantic_scholar_abstract(session: requests.Session, doi: Optional[str], cfg: FetchConfig) -> Optional[str]:
    doi = normalize_doi(doi)
    if not doi:
        return None
    url = f"https://api.semanticscholar.org/graph/v1/paper/DOI:{quote(doi, safe='')}?fields=abstract"
    data = fetch_json(session, url, cfg)
    if not data:
        return None
    return clean_text(data.get("abstract"))


def fetch_europe_pmc_abstract(session: requests.Session, doi: Optional[str], cfg: FetchConfig) -> Optional[str]:
    doi = normalize_doi(doi)
    if not doi:
        return None
    url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
    params = f"?query=DOI:{quote(doi, safe='')}&resulttype=core&format=json&pageSize=5"
    data = fetch_json(session, url + params, cfg)
    if not data:
        return None
    hits = ((data.get("resultList") or {}).get("result") or [])
    for hit in hits:
        abstract = clean_text(hit.get("abstractText"))
        if abstract:
            return abstract
    return None


def enrich_publications(
    pubs: List[Publication],
    cfg: FetchConfig,
    detail_count: int,
    with_crossref: bool,
    with_pubmed: bool,
    with_s2: bool,
    date_overrides: Dict[str, str],
) -> None:
    with requests.Session() as session:
        for index, pub in enumerate(pubs):
            enrich_details = index < detail_count
            orcid = str(pub.get("orcid") or "").split(";", 1)[0]
            put_code = pub.get("put_code") or pub.get("put-code")
            if enrich_details and orcid and put_code is not None:
                detail = fetch_work_detail(session, orcid, put_code, cfg)
                time.sleep(cfg.pause_seconds)
                if detail:
                    pub["title"] = extract_title(detail) or pub.get("title")
                    pub["journal"] = extract_journal(detail) or pub.get("journal")
                    detail_date = format_publication_date(detail.get("publication-date"))
                    if detail_date and len(detail_date) >= len(pub.get("date") or ""):
                        pub["date"] = detail_date
                    ext_ids = extract_external_ids(detail)
                    pub["doi"] = ext_ids.get("doi") or pub.get("doi")
                    pub["url"] = (detail.get("url") or {}).get("value") or doi_to_url(pub.get("doi")) or pub.get("url")
                    pub["authors"] = extract_authors_from_detail(detail) or pub.get("authors")
                    abstract = extract_abstract_from_detail(detail)
                    if abstract:
                        pub["abstract"] = abstract
                        pub["abstract_source"] = "orcid"

            doi = normalize_doi(pub.get("doi"))
            override = date_overrides.get(doi.lower()) if doi else None
            crossref = {}
            if with_crossref and doi:
                crossref = fetch_crossref_work(session, doi, cfg)
                time.sleep(max(0.25, cfg.pause_seconds))

            if crossref and needs_author_metadata(pub.get("authors")):
                author_names = crossref_author_names(crossref)
                if author_names:
                    pub["authors"] = author_names

            online_date = crossref_online_date(crossref)
            if override:
                pub["date"] = override
                pub["date_source"] = "manual"
            elif online_date and (len(online_date) == 10 or len(online_date) > len(pub.get("date") or "")):
                pub["date"] = online_date
                pub["date_source"] = "crossref_online"

            if not enrich_details or pub.get("abstract"):
                continue
            abstract = clean_text(crossref.get("abstract"))
            if abstract:
                pub["abstract"] = abstract
                pub["abstract_source"] = "crossref"
                continue
            for enabled, source_name, fn in [
                (with_pubmed, "europe_pmc", fetch_europe_pmc_abstract),
                (with_s2, "semantic_scholar", fetch_semantic_scholar_abstract),
            ]:
                if not enabled or pub.get("abstract"):
                    continue
                abstract = fn(session, doi, cfg)
                time.sleep(cfg.pause_seconds)
                if abstract:
                    pub["abstract"] = abstract
                    pub["abstract_source"] = source_name


def filter_year_window(
    pubs: List[Publication], years_back: int, years_forward: int, *, include_undated: bool = False
) -> List[Publication]:
    current_year = dt.date.today().year
    min_year = current_year - max(0, years_back)
    max_year = current_year + max(0, years_forward)
    filtered = []
    for pub in pubs:
        year, _, _ = parse_date_parts(pub.get("date"))
        if min_year <= year <= max_year or (include_undated and not year):
            filtered.append(pub)
    return filtered


def limit_fields(pub: Publication) -> Publication:
    # Keep the published JSON small and stable. Frontend ignores unknown fields, but this avoids leaking API clutter.
    keep = ["title", "authors", "journal", "abstract", "abstract_source", "doi", "url", "date", "orcid", "put_code", "type"]
    fields = {key: pub.get(key) if pub.get(key) is not None else "" for key in keep}
    if pub.get("date_source"):
        fields["date_source"] = pub["date_source"]
    return fields


def write_json(pubs: List[Publication], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cleaned = [limit_fields(pub) for pub in pubs]
    out_path.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch ORCID works and write publications JSON for a static website.")
    parser.add_argument("--orcid-file", type=Path, default=Path("orcids.txt"), help="Text file with one ORCID iD per line.")
    parser.add_argument("--date-overrides", type=Path, help="Optional JSON mapping DOI to a verified online date (YYYY-MM-DD).")
    parser.add_argument("--out", type=Path, default=Path("docs/data/publications.json"), help="Output JSON path.")
    parser.add_argument("--with-details", action="store_true", help="Fetch ORCID work details for richer author and abstract data.")
    parser.add_argument("--detail-count", type=int, default=80, help="How many newest works to enrich with detail calls.")
    parser.add_argument("--with-crossref", action="store_true", help="Use Crossref online publication dates and fallback abstracts via DOI.")
    parser.add_argument("--with-pubmed", action="store_true", help="Fallback: use Europe PMC/PubMed abstracts via DOI.")
    parser.add_argument("--with-s2", action="store_true", help="Fallback: use Semantic Scholar abstracts via DOI.")
    parser.add_argument("--years-back", type=int, default=2, help="Keep publications from current_year - N.")
    parser.add_argument("--years-forward", type=int, default=1, help="Keep publications until current_year + N.")
    parser.add_argument("--max-items", type=int, default=0, help="Optional maximum number of items in JSON; 0 means no limit.")
    parser.add_argument("--mailto", default=None, help="Optional contact email for API User-Agent etiquette.")
    parser.add_argument("--pause", type=float, default=0.15, help="Pause between API requests in seconds.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    orcids = load_orcid_ids(args.orcid_file)
    if not orcids:
        print(f"No valid ORCID iDs found in {args.orcid_file}", file=sys.stderr)
        return 2

    cfg = FetchConfig(mailto=args.mailto, pause_seconds=max(0.0, args.pause))
    date_overrides = load_date_overrides(args.date_overrides) if args.date_overrides else {}
    pubs = collect_publications(orcids, cfg)
    if args.with_details or args.with_crossref or args.with_pubmed or args.with_s2 or date_overrides:
        for pub in pubs:
            doi = normalize_doi(pub.get("doi"))
            if doi and doi.lower() in date_overrides:
                pub["date"] = date_overrides[doi.lower()]
        pubs = filter_year_window(pubs, args.years_back, args.years_forward, include_undated=True)
        enrich_publications(
            pubs,
            cfg,
            args.detail_count if args.with_details else 0,
            with_crossref=args.with_crossref,
            with_pubmed=args.with_pubmed,
            with_s2=args.with_s2,
            date_overrides=date_overrides,
        )

    pubs = filter_year_window(pubs, args.years_back, args.years_forward)
    pubs.sort(key=sort_key, reverse=True)
    if args.max_items and args.max_items > 0:
        pubs = pubs[: args.max_items]
    write_json(pubs, args.out)
    print(f"Wrote {len(pubs)} publications to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
