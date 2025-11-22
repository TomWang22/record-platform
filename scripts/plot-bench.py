#!/usr/bin/env python3
import argparse
import csv
import os
import sys
from collections import defaultdict

try:
    import matplotlib.pyplot as plt
except ImportError:
    print("❌ Error: matplotlib is not installed.", file=sys.stderr)
    print("", file=sys.stderr)
    print("Install it with:", file=sys.stderr)
    print("  pip3 install matplotlib", file=sys.stderr)
    print("", file=sys.stderr)
    print("Or on macOS with Homebrew:", file=sys.stderr)
    print("  brew install python3", file=sys.stderr)
    print("  pip3 install matplotlib", file=sys.stderr)
    sys.exit(1)


def load_data(path, include_trgm_simple=False):
    data = defaultdict(list)
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            variant = row.get("variant")
            if not variant:
                continue

            if not include_trgm_simple and variant == "trgm_simple":
                continue

            # Parse fields we care about; skip rows with missing TPS
            try:
                tps = float(row["tps"]) if row.get("tps") else None
            except (ValueError, TypeError):
                tps = None
            if not tps or tps <= 0:
                continue

            try:
                clients = int(row["clients"])
            except (ValueError, TypeError):
                continue

            def f(name):
                v = row.get(name)
                if v in (None, "", "NaN"):
                    return None
                try:
                    return float(v)
                except ValueError:
                    return None

            lat_est = f("lat_est_ms")
            p95 = f("p95_ms")
            p99 = f("p99_ms")

            data[variant].append(
                {
                    "clients": clients,
                    "tps": tps,
                    "lat_est_ms": lat_est,
                    "p95_ms": p95,
                    "p99_ms": p99,
                }
            )

    # Sort each variant by clients
    for v in data:
        data[v].sort(key=lambda r: r["clients"])
    return data


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def plot_tps_all(data, outdir):
    plt.figure(figsize=(8, 5))
    for variant, rows in sorted(data.items()):
        xs = [r["clients"] for r in rows]
        ys = [r["tps"] for r in rows]
        plt.plot(xs, ys, marker="o", label=variant)

    plt.title("TPS vs Clients")
    plt.xlabel("Clients")
    plt.ylabel("TPS")
    plt.grid(True, linestyle="--", alpha=0.4)
    plt.legend()
    out = os.path.join(outdir, "tps_vs_clients_all.png")
    plt.tight_layout()
    plt.savefig(out, dpi=150)
    plt.close()
    print(f"✅ wrote {out}")


def plot_latency_all(data, outdir, field="lat_est_ms", label="lat_est_ms"):
    plt.figure(figsize=(8, 5))
    for variant, rows in sorted(data.items()):
        xs = [r["clients"] for r in rows if r.get(field) is not None]
        ys = [r[field] for r in rows if r.get(field) is not None]
        if not xs:
            continue
        plt.plot(xs, ys, marker="o", label=variant)

    plt.title(f"{label} vs Clients")
    plt.xlabel("Clients")
    plt.ylabel(f"{label} (ms)")
    plt.grid(True, linestyle="--", alpha=0.4)
    plt.legend()
    out = os.path.join(outdir, f"{field}_vs_clients_all.png")
    plt.tight_layout()
    plt.savefig(out, dpi=150)
    plt.close()
    print(f"✅ wrote {out}")


def plot_per_variant(data, outdir):
    for variant, rows in sorted(data.items()):
        xs = [r["clients"] for r in rows]
        tps = [r["tps"] for r in rows]
        lat = [r["lat_est_ms"] for r in rows]
        p95 = [r["p95_ms"] for r in rows]
        p99 = [r["p99_ms"] for r in rows]

        # TPS plot
        plt.figure(figsize=(8, 5))
        plt.plot(xs, tps, marker="o")
        plt.title(f"TPS vs Clients ({variant})")
        plt.xlabel("Clients")
        plt.ylabel("TPS")
        plt.grid(True, linestyle="--", alpha=0.4)
        out = os.path.join(outdir, f"tps_vs_clients_{variant}.png")
        plt.tight_layout()
        plt.savefig(out, dpi=150)
        plt.close()
        print(f"✅ wrote {out}")

        # Latency plot
        plt.figure(figsize=(8, 5))
        if any(lat):
            plt.plot(
                xs,
                lat,
                marker="o",
                label="lat_est_ms",
            )
        if any(p95):
            plt.plot(xs, p95, marker="o", label="p95_ms")
        if any(p99):
            plt.plot(xs, p99, marker="o", label="p99_ms")

        plt.title(f"Latency vs Clients ({variant})")
        plt.xlabel("Clients")
        plt.ylabel("Latency (ms)")
        plt.grid(True, linestyle="--", alpha=0.4)
        plt.legend()
        out = os.path.join(outdir, f"latency_vs_clients_{variant}.png")
        plt.tight_layout()
        plt.savefig(out, dpi=150)
        plt.close()
        print(f"✅ wrote {out}")


def main():
    parser = argparse.ArgumentParser(description="Plot Postgres bench sweep results")
    parser.add_argument(
        "--input",
        "-i",
        default="bench_export.csv",
        help="Input CSV (bench_export*.csv or bench_sweep*.csv)",
    )
    parser.add_argument(
        "--outdir",
        "-o",
        default="bench_plots",
        help="Directory to write PNGs into",
    )
    parser.add_argument(
        "--include-trgm-simple",
        action="store_true",
        help="Include trgm_simple variant in plots",
    )
    args = parser.parse_args()

    ensure_dir(args.outdir)
    data = load_data(args.input, include_trgm_simple=args.include_trgm_simple)

    if not data:
        print(f"❌ No data loaded from {args.input}")
        return

    plot_tps_all(data, args.outdir)
    plot_latency_all(data, args.outdir, field="lat_est_ms", label="lat_est_ms")
    plot_latency_all(data, args.outdir, field="p95_ms", label="p95_ms")
    plot_latency_all(data, args.outdir, field="p99_ms", label="p99_ms")
    plot_per_variant(data, args.outdir)


if __name__ == "__main__":
    main()

