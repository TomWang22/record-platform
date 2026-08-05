package check

import (
	"context"
	"time"
)

// Result is the outcome of one broker readiness check.
type Result struct {
	OK             bool
	Reason         string // empty when OK
	Message        string // non-secret human detail
	ObservedNodeID int32
	Duration       time.Duration
}

// BrokerChecker performs authenticated Kafka protocol checks against the local broker.
// Implementations must keep a reusable client and reconnect only via Reset/Reconnect.
type BrokerChecker interface {
	Check(ctx context.Context) Result
	// Reset drops the reusable client so the next Check reconnects.
	Reset()
	// Reconnect forces a fresh dial (same as Reset for most implementations).
	Reconnect()
	// ClientCreations returns how many protocol clients have been constructed.
	ClientCreations() int64
}
