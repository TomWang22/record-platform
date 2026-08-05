package metrics_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	dto "github.com/prometheus/client_model/go"

	"record-platform/kafka-readiness-agent/internal/agent"
	"record-platform/kafka-readiness-agent/internal/check"
	"record-platform/kafka-readiness-agent/internal/config"
	"record-platform/kafka-readiness-agent/internal/httpapi"
	"record-platform/kafka-readiness-agent/internal/metrics"
	"record-platform/kafka-readiness-agent/internal/reasons"
	"context"
	"time"
)

func scrapeFamilies(t *testing.T, gatherer prometheus.Gatherer) map[string]*dto.MetricFamily {
	t.Helper()
	mfs, err := gatherer.Gather()
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]*dto.MetricFamily{}
	for _, mf := range mfs {
		out[mf.GetName()] = mf
	}
	return out
}

func seriesCount(mfs map[string]*dto.MetricFamily) int {
	n := 0
	for _, mf := range mfs {
		n += len(mf.Metric)
	}
	return n
}

func TestPrometheusMetricBoundsProof(t *testing.T) {
	reg := prometheus.NewRegistry()
	m := metrics.NewWithRegisterer(reg)

	cfg := config.Config{
		PodName:            "kafka-0",
		Namespace:          "record-platform",
		NodeID:             0,
		BrokerAddr:         "kafka-0.kafka.record-platform.svc.cluster.local:9093",
		BrokerServerName:   "kafka-0.kafka.record-platform.svc.cluster.local",
		HTTPAddr:           "127.0.0.1:0",
		PollInterval:       time.Hour,
		FreshnessThreshold: 30 * time.Second,
		ReconnectGrace:     60 * time.Second,
		CheckTimeout:       2 * time.Second,
	}
	fake := check.NewFake(0)
	ag := agent.New(cfg, fake, m)
	mux := http.NewServeMux()
	api := httpapi.New("127.0.0.1:0", ag)
	mux.Handle("/", api.Handler())
	mux.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))

	// Vary outcomes / reasons / reconnect / HTTP paths.
	reasonCycle := []string{
		reasons.TLSChainFailure,
		reasons.TLSHostnameFailure,
		reasons.TLSClientIdentityFailure,
		reasons.TCPConnectFailure,
		reasons.ApiVersionsFailure,
		reasons.MetadataFailure,
		reasons.LocalNodeIDMismatch,
		reasons.StaleLastSuccess,
		reasons.AgentInternalFailure,
	}
	for i := 0; i < 50; i++ {
		r := reasonCycle[i%len(reasonCycle)]
		fake.SetResult(check.Result{OK: false, Reason: r, Message: "x", ObservedNodeID: int32(i % 3)})
		ag.ForcePoll(context.Background())
		fake.SetResult(check.Result{OK: true, ObservedNodeID: 0, Message: "ok"})
		ag.ForcePoll(context.Background())
		for _, path := range []string{"/readyz", "/status", "/livez", "/metrics"} {
			rr := httptest.NewRecorder()
			mux.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, path, nil))
		}
	}

	mfs := scrapeFamilies(t, reg)
	// Expected families present
	for _, name := range metrics.ExpectedMetricFamilies {
		if _, ok := mfs[name]; !ok {
			t.Fatalf("metric_families missing %s", name)
		}
	}
	// No duplicate family names (map keys unique by construction)
	steady := seriesCount(mfs)
	if steady > metrics.SteadyStateSeriesBound {
		t.Fatalf("series_count_after_steady_state=%d bound=%d", steady, metrics.SteadyStateSeriesBound)
	}

	// Repeat identical failures — series must not grow.
	for i := 0; i < 100; i++ {
		fake.SetResult(check.Result{OK: false, Reason: reasons.ApiVersionsFailure, Message: "same"})
		ag.ForcePoll(context.Background())
	}
	mfs2 := scrapeFamilies(t, reg)
	if seriesCount(mfs2) > steady {
		t.Fatalf("series_growth_after_repeated_identical_failures=%d→%d", steady, seriesCount(mfs2))
	}

	// Label key/value bounds
	for name, mf := range mfs2 {
		for _, metric := range mf.Metric {
			for _, lp := range metric.Label {
				key := lp.GetName()
				val := lp.GetValue()
				for _, bad := range metrics.ForbiddenLabelKeys {
					if key == bad {
						t.Fatalf("unbounded_or_forbidden_label_key=%s on %s", key, name)
					}
				}
				low := strings.ToLower(val)
				for _, tok := range []string{"password", "-----begin", "private_key", "trace-", "uid:"} {
					if strings.Contains(low, tok) {
						t.Fatalf("secret_values_present on %s{%s=%s}", name, key, val)
					}
				}
				if key == "reason" {
					if _, ok := metrics.AllowedReasonLabels[val]; !ok {
						t.Fatalf("unbounded_label_values reason=%s", val)
					}
				}
			}
		}
	}

	// Scrape body must not contain secrets
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body, _ := io.ReadAll(rr.Body)
	s := strings.ToLower(string(body))
	for _, tok := range []string{"password", "-----begin", "private_key", "truststore_password"} {
		if strings.Contains(s, tok) {
			t.Fatalf("secret_values_present in /metrics: %s", tok)
		}
	}
}
