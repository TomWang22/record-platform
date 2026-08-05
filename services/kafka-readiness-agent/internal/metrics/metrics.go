package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

// Registry holds bounded Prometheus metrics for the readiness agent.
type Registry struct {
	Ready           prometheus.Gauge
	CheckLatency    prometheus.Histogram
	LastSuccessAge  prometheus.Gauge
	ReasonTotal     *prometheus.CounterVec
	CheckTotal      prometheus.Counter
	ClientCreations prometheus.Gauge
	registerer      prometheus.Registerer
}

// AllowedReasonLabels is the closed set of reason label values (no unbounded cardinality).
var AllowedReasonLabels = map[string]struct{}{
	"TLS_CHAIN_FAILURE":           {},
	"TLS_HOSTNAME_FAILURE":        {},
	"TLS_CLIENT_IDENTITY_FAILURE": {},
	"TCP_CONNECT_FAILURE":         {},
	"APIVERSIONS_FAILURE":         {},
	"METADATA_FAILURE":            {},
	"LOCAL_NODE_ID_MISMATCH":      {},
	"STALE_LAST_SUCCESS":          {},
	"AGENT_INTERNAL_FAILURE":      {},
}

// ForbiddenLabelKeys must never appear on agent metrics.
var ForbiddenLabelKeys = []string{
	"client_id", "pod_uid", "certificate_serial", "fingerprint", "request_id",
	"trace_id", "event_id", "exception", "endpoint", "user", "password",
}

// ExpectedMetricFamilies documents the stable metric set.
var ExpectedMetricFamilies = []string{
	"kafka_readiness_ready",
	"kafka_readiness_check_latency_seconds",
	"kafka_readiness_last_success_age_seconds",
	"kafka_readiness_reason_total",
	"kafka_readiness_check_total",
	"kafka_readiness_client_creations",
}

// SteadyStateSeriesBound is the documented upper bound on time-series after steady state
// (gauges/counters + histogram buckets/sum/count + reason label cardinality).
const SteadyStateSeriesBound = 64

// New creates metrics on the default registerer.
func New() *Registry {
	return NewWithRegisterer(prometheus.DefaultRegisterer)
}

// NewWithRegisterer creates metrics on the provided registerer (tests should use a private one).
func NewWithRegisterer(reg prometheus.Registerer) *Registry {
	r := &Registry{registerer: reg}
	r.Ready = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "kafka_readiness_ready",
		Help: "1 if agent considers local broker READY, else 0",
	})
	r.CheckLatency = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "kafka_readiness_check_latency_seconds",
		Help:    "Latency of background broker checks",
		Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
	})
	r.LastSuccessAge = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "kafka_readiness_last_success_age_seconds",
		Help: "Seconds since last successful broker check (-1 if never)",
	})
	r.ReasonTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "kafka_readiness_reason_total",
		Help: "Count of NOT_READY reason observations from poller",
	}, []string{"reason"})
	r.CheckTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "kafka_readiness_check_total",
		Help: "Total background checks executed",
	})
	r.ClientCreations = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "kafka_readiness_client_creations",
		Help: "Number of franz-go clients created (should stay near 1)",
	})
	reg.MustRegister(r.Ready, r.CheckLatency, r.LastSuccessAge, r.ReasonTotal, r.CheckTotal, r.ClientCreations)
	// Pre-register closed reason label set so cardinality is fixed.
	for reason := range AllowedReasonLabels {
		r.ReasonTotal.WithLabelValues(reason)
	}
	return r
}
