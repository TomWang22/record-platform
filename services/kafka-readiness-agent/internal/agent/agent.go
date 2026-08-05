package agent

import (
	"context"
	"sync"
	"time"

	"record-platform/kafka-readiness-agent/internal/check"
	"record-platform/kafka-readiness-agent/internal/config"
	"record-platform/kafka-readiness-agent/internal/metrics"
	"record-platform/kafka-readiness-agent/internal/reasons"
)

// Status is a snapshot of agent readiness state (no secrets).
type Status struct {
	Ready              bool      `json:"ready"`
	Reason             string    `json:"reason,omitempty"`
	Message            string    `json:"message,omitempty"`
	ExpectedNodeID     int32     `json:"expected_node_id"`
	ObservedNodeID     int32     `json:"observed_node_id,omitempty"`
	BrokerAddr         string    `json:"broker_addr"`
	BrokerServerName   string    `json:"broker_server_name"`
	LastSuccessUnixMs  int64     `json:"last_success_unix_ms,omitempty"`
	LastCheckUnixMs    int64     `json:"last_check_unix_ms,omitempty"`
	LastSuccessAgeSec  float64   `json:"last_success_age_sec,omitempty"`
	FreshnessThreshold string    `json:"freshness_threshold"`
	PollInterval       string    `json:"poll_interval"`
	ClientCreations    int64     `json:"client_creations"`
	ReconnectSinceMs   int64     `json:"reconnect_since_unix_ms,omitempty"`
	StuckReconnecting  bool      `json:"stuck_reconnecting"`
}

// Agent runs the background poller and serves readiness state.
type Agent struct {
	cfg     config.Config
	checker check.BrokerChecker
	metrics *metrics.Registry

	mu               sync.RWMutex
	ready            bool
	reason           string
	message          string
	observedNodeID   int32
	lastSuccess      time.Time
	lastCheck        time.Time
	reconnectSince   time.Time
	stuckReconnecting bool
}

// New creates an Agent. checker must be non-nil.
func New(cfg config.Config, checker check.BrokerChecker, m *metrics.Registry) *Agent {
	return &Agent{cfg: cfg, checker: checker, metrics: m}
}

// Run starts the poll loop until ctx is cancelled.
func (a *Agent) Run(ctx context.Context) {
	a.pollOnce(ctx)
	t := time.NewTicker(a.cfg.PollInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			a.pollOnce(ctx)
		}
	}
}

func (a *Agent) pollOnce(parent context.Context) {
	ctx, cancel := context.WithTimeout(parent, a.cfg.CheckTimeout)
	defer cancel()

	start := time.Now()
	res := a.checker.Check(ctx)
	elapsed := time.Since(start)

	if a.metrics != nil {
		a.metrics.CheckTotal.Inc()
		a.metrics.CheckLatency.Observe(elapsed.Seconds())
		a.metrics.ClientCreations.Set(float64(a.checker.ClientCreations()))
	}

	now := time.Now()
	a.mu.Lock()
	defer a.mu.Unlock()

	a.lastCheck = now
	a.observedNodeID = res.ObservedNodeID
	a.message = res.Message

	if res.OK {
		a.lastSuccess = now
		a.reconnectSince = time.Time{}
		a.stuckReconnecting = false
		a.ready = true
		a.reason = ""
	} else {
		if a.reconnectSince.IsZero() {
			a.reconnectSince = now
		}
		// Trigger reconnect on protocol/transport failures.
		switch res.Reason {
		case reasons.TCPConnectFailure, reasons.ApiVersionsFailure, reasons.MetadataFailure,
			reasons.TLSChainFailure, reasons.TLSHostnameFailure, reasons.TLSClientIdentityFailure:
			a.checker.Reconnect()
		}
		if a.cfg.ReconnectGrace > 0 && now.Sub(a.reconnectSince) > a.cfg.ReconnectGrace {
			a.stuckReconnecting = true
		}
		a.ready = false
		a.reason = res.Reason
		if a.reason == "" {
			a.reason = reasons.AgentInternalFailure
		}
		if a.metrics != nil {
			a.metrics.ReasonTotal.WithLabelValues(a.reason).Inc()
		}
	}

	// Apply freshness + stuck predicates even after a successful check ages out.
	a.applyPredicatesLocked(now)

	if a.metrics != nil {
		if a.ready {
			a.metrics.Ready.Set(1)
		} else {
			a.metrics.Ready.Set(0)
		}
		if a.lastSuccess.IsZero() {
			a.metrics.LastSuccessAge.Set(-1)
		} else {
			a.metrics.LastSuccessAge.Set(now.Sub(a.lastSuccess).Seconds())
		}
	}
}

func (a *Agent) applyPredicatesLocked(now time.Time) {
	if a.lastSuccess.IsZero() {
		a.ready = false
		if a.reason == "" {
			a.reason = reasons.StaleLastSuccess
		}
		return
	}
	age := now.Sub(a.lastSuccess)
	if age > a.cfg.FreshnessThreshold {
		a.ready = false
		a.reason = reasons.StaleLastSuccess
		a.message = "last success older than freshness threshold"
		return
	}
	if a.stuckReconnecting {
		a.ready = false
		if a.reason == "" {
			a.reason = reasons.AgentInternalFailure
		}
		a.message = "stuck reconnecting past grace"
		return
	}
	// If last check succeeded and fresh, ready stays true.
	if a.reason == "" && !a.lastSuccess.IsZero() && age <= a.cfg.FreshnessThreshold {
		a.ready = true
	}
}

// Live reports process liveness (always true while agent exists).
func (a *Agent) Live() bool { return true }

// Ready reports current readiness and reason.
func (a *Agent) Ready() (bool, string, string) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	now := time.Now()
	// Recompute freshness without mutating (read path).
	if a.ready {
		if a.lastSuccess.IsZero() || now.Sub(a.lastSuccess) > a.cfg.FreshnessThreshold {
			return false, reasons.StaleLastSuccess, "last success older than freshness threshold"
		}
		if a.stuckReconnecting {
			return false, reasons.AgentInternalFailure, "stuck reconnecting past grace"
		}
		return true, "", a.message
	}
	reason := a.reason
	if reason == "" {
		reason = reasons.StaleLastSuccess
	}
	return false, reason, a.message
}

// Snapshot returns a secret-free status document.
func (a *Agent) Snapshot() Status {
	a.mu.RLock()
	defer a.mu.RUnlock()
	now := time.Now()
	ready, reason, msg := a.ready, a.reason, a.message
	if ready {
		if a.lastSuccess.IsZero() || now.Sub(a.lastSuccess) > a.cfg.FreshnessThreshold {
			ready = false
			reason = reasons.StaleLastSuccess
			msg = "last success older than freshness threshold"
		}
	}
	s := Status{
		Ready:             ready,
		Reason:            reason,
		Message:           msg,
		ExpectedNodeID:    a.cfg.NodeID,
		ObservedNodeID:    a.observedNodeID,
		BrokerAddr:        a.cfg.BrokerAddr,
		BrokerServerName:  a.cfg.BrokerServerName,
		FreshnessThreshold: a.cfg.FreshnessThreshold.String(),
		PollInterval:      a.cfg.PollInterval.String(),
		ClientCreations:   a.checker.ClientCreations(),
		StuckReconnecting: a.stuckReconnecting,
	}
	if !a.lastSuccess.IsZero() {
		s.LastSuccessUnixMs = a.lastSuccess.UnixMilli()
		s.LastSuccessAgeSec = now.Sub(a.lastSuccess).Seconds()
	}
	if !a.lastCheck.IsZero() {
		s.LastCheckUnixMs = a.lastCheck.UnixMilli()
	}
	if !a.reconnectSince.IsZero() {
		s.ReconnectSinceMs = a.reconnectSince.UnixMilli()
	}
	return s
}

// ForcePoll runs one check (tests).
func (a *Agent) ForcePoll(ctx context.Context) {
	a.pollOnce(ctx)
}

// InjectSuccess sets last success for stale tests without a checker.
func (a *Agent) InjectSuccess(t time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.lastSuccess = t
	a.lastCheck = t
	a.ready = true
	a.reason = ""
	a.message = "injected"
	a.stuckReconnecting = false
	a.reconnectSince = time.Time{}
	a.applyPredicatesLocked(time.Now())
}
