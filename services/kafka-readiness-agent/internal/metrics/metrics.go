package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Registry holds bounded Prometheus metrics for the readiness agent.
type Registry struct {
	Ready              prometheus.Gauge
	CheckLatency       prometheus.Histogram
	LastSuccessAge     prometheus.Gauge
	ReasonTotal        *prometheus.CounterVec
	CheckTotal         prometheus.Counter
	ClientCreations    prometheus.Gauge
}

// New creates metrics registered on the default registerer.
func New() *Registry {
	return &Registry{
		Ready: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "kafka_readiness_ready",
			Help: "1 if agent considers local broker READY, else 0",
		}),
		CheckLatency: promauto.NewHistogram(prometheus.HistogramOpts{
			Name:    "kafka_readiness_check_latency_seconds",
			Help:    "Latency of background broker checks",
			Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
		}),
		LastSuccessAge: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "kafka_readiness_last_success_age_seconds",
			Help: "Seconds since last successful broker check (-1 if never)",
		}),
		ReasonTotal: promauto.NewCounterVec(prometheus.CounterOpts{
			Name: "kafka_readiness_reason_total",
			Help: "Count of NOT_READY reason observations from poller",
		}, []string{"reason"}),
		CheckTotal: promauto.NewCounter(prometheus.CounterOpts{
			Name: "kafka_readiness_check_total",
			Help: "Total background checks executed",
		}),
		ClientCreations: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "kafka_readiness_client_creations",
			Help: "Number of franz-go clients created (should stay near 1)",
		}),
	}
}
