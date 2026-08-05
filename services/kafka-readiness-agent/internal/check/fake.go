package check

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// FakeChecker is a test double implementing BrokerChecker.
type FakeChecker struct {
	mu        sync.Mutex
	result    Result
	creations atomic.Int64
	checks    atomic.Int64
	resets    atomic.Int64
	// OnCheck optionally mutates/overrides result per call.
	OnCheck func() Result
	// CreateClientOnCheck increments creations once on first check after reset.
	lazyClient bool
	hasClient  bool
}

// NewFake returns a FakeChecker that starts with a successful result.
func NewFake(nodeID int32) *FakeChecker {
	f := &FakeChecker{
		result: Result{OK: true, ObservedNodeID: nodeID, Message: "ok"},
		lazyClient: true,
	}
	return f
}

// SetResult updates the next check outcome.
func (f *FakeChecker) SetResult(r Result) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.result = r
}

// Check implements BrokerChecker.
func (f *FakeChecker) Check(ctx context.Context) Result {
	f.checks.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.lazyClient && !f.hasClient {
		f.creations.Add(1)
		f.hasClient = true
	}
	if f.OnCheck != nil {
		return f.OnCheck()
	}
	select {
	case <-ctx.Done():
		return Result{OK: false, Reason: "METADATA_FAILURE", Message: "context done"}
	default:
	}
	r := f.result
	r.Duration = time.Millisecond
	return r
}

// Reset implements BrokerChecker.
func (f *FakeChecker) Reset() {
	f.resets.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hasClient = false
}

// Reconnect implements BrokerChecker.
func (f *FakeChecker) Reconnect() { f.Reset() }

// ClientCreations implements BrokerChecker.
func (f *FakeChecker) ClientCreations() int64 { return f.creations.Load() }

// CheckCount returns total Check invocations.
func (f *FakeChecker) CheckCount() int64 { return f.checks.Load() }

// ResetCount returns total Reset/Reconnect invocations.
func (f *FakeChecker) ResetCount() int64 { return f.resets.Load() }
