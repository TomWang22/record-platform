#!/usr/bin/env bash
# Synthetic dataset loader for quick search/stat benchmarks
set -euo pipefail

NS="${1:-record-platform}"
USER_ID="${2:-}"
N="${3:-}"

DEFAULT_USER_ID="4ad36240-c1ad-4638-ab1b-4c8cfb04a553"
DEFAULT_N="10000"

if [[ -z "${USER_ID}" ]]; then
  USER_ID="$DEFAULT_USER_ID"
fi

if [[ -z "${N}" ]]; then
  N="$DEFAULT_N"
fi

tmp_csv="$(mktemp /tmp/records.XXXXXX.csv)"
trap 'rm -f "$tmp_csv"' EXIT

python3 - "$USER_ID" "$N" "$tmp_csv" <<'PY'
import csv, random, sys, uuid, datetime

user_id = sys.argv[1]
count = int(sys.argv[2])
path = sys.argv[3]

artists = [
    ("Teresa Teng", ["Teresa Teng", "鄧麗君", "邓丽君", "テレサ・テン"]),
    ("Anita Mui", ["Anita Mui", "梅艷芳", "梅艳芳", "アニタ・ムイ"]),
    ("Faye Wong", ["Faye Wong", "王菲", "ワン・フェイ"]),
    ("Leslie Cheung", ["Leslie Cheung", "張國榮", "张国荣", "レスリー・チャン"]),
]
formats = ["LP", "EP", "12in", "7in", "CD"]
labels = ["Polydor", "PolyGram", "Trio", "CBS", "Warner", "EMI"]
grades = ["NM", "EX", "VG+", "VG"]

def random_date(start_year=1970, end_year=2015):
    year = random.randint(start_year, end_year)
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    return f"{year:04d}-{month:02d}-{day:02d}", year

with open(path, "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow([
        "artist", "name", "format", "catalog_number", "notes",
        "purchased_at", "price_paid", "record_grade", "sleeve_grade",
        "release_year", "release_date", "pressing_year", "label",
        "label_code", "user_id"
    ])
    # deterministic first row for quick sanity checks
    writer.writerow([
        "Teresa Teng", "Best Hits", "LP", "HK-123", "classic",
        "2023-05-01", "19.99", "NM", "EX", "1983", "1983-04-10",
        "1983", "Polydor", "PD-001", user_id
    ])
    for i in range(count):
        base_artist, aliases = random.choice(artists)
        artist = random.choice(aliases)
        name = f"Album {i}"
        fmt = random.choice(formats)
        catalog = f"{random.choice(['HK','TW','JP','CN','US'])}-{random.randint(1,999):03d}"
        notes = random.choice(["", "great", "first press", "promo"])
        purchased = f"202{random.randint(0,4)}-{random.randint(1,12):02d}-{random.randint(1,28):02d}"
        price = f"{random.randint(5,40)}.{random.randint(0,99):02d}"
        record_grade = random.choice(grades)
        sleeve_grade = random.choice(grades)
        release_date, release_year = random_date()
        label = random.choice(labels)
        label_code = f"{label[:2].upper()}-{random.randint(1,999):03d}"
        writer.writerow([
            artist, name, fmt, catalog, notes, purchased, price,
            record_grade, sleeve_grade, release_year, release_date,
            release_year, label, label_code, user_id
        ])
PY

# Bulk load via COPY
kubectl -n "$NS" exec -i deploy/postgres -- psql -U postgres -d records -c \
  "COPY records.records(
     artist, name, format, catalog_number, notes, purchased_at, price_paid,
     record_grade, sleeve_grade, release_year, release_date, pressing_year,
     label, label_code, user_id
   ) FROM STDIN WITH (FORMAT csv, HEADER true);" <"$tmp_csv"

# Normalize + analyze (fast)
kubectl -n "$NS" exec -i deploy/postgres -- psql -U postgres -d records -Atc \
  "UPDATE records.records SET artist=artist WHERE search_norm IS NULL; ANALYZE records.records;"
