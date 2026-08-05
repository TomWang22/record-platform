package check

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/kmsg"

	"record-platform/kafka-readiness-agent/internal/config"
	"record-platform/kafka-readiness-agent/internal/reasons"
)

// KafkaChecker performs ApiVersions + Metadata against a single local broker
// using one reusable franz-go client.
type KafkaChecker struct {
	cfg       config.Config
	tlsConfig *tls.Config

	mu       sync.Mutex
	client   *kgo.Client
	creations atomic.Int64
}

// NewKafkaChecker builds a checker. TLS material is loaded once at construction;
// the Kafka client is created lazily and reused.
func NewKafkaChecker(cfg config.Config) (*KafkaChecker, error) {
	tlsCfg, err := BuildTLSConfig(cfg)
	if err != nil {
		return nil, err
	}
	return &KafkaChecker{cfg: cfg, tlsConfig: tlsCfg}, nil
}

// ClientCreations implements BrokerChecker.
func (k *KafkaChecker) ClientCreations() int64 { return k.creations.Load() }

// Reset implements BrokerChecker.
func (k *KafkaChecker) Reset() { k.closeClient() }

// Reconnect implements BrokerChecker.
func (k *KafkaChecker) Reconnect() { k.closeClient() }

func (k *KafkaChecker) closeClient() {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.client != nil {
		k.client.Close()
		k.client = nil
	}
}

func (k *KafkaChecker) getClient() (*kgo.Client, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.client != nil {
		return k.client, nil
	}
	cl, err := kgo.NewClient(
		kgo.SeedBrokers(k.cfg.BrokerAddr),
		kgo.DialTLSConfig(k.tlsConfig.Clone()),
		kgo.ClientID(fmt.Sprintf("record-platform.kafka.readiness-agent.%s", k.cfg.PodName)),
		kgo.RequestRetries(0),
		kgo.RetryTimeout(0),
		kgo.ConnIdleTimeout(90*time.Second),
	)
	if err != nil {
		return nil, err
	}
	k.creations.Add(1)
	k.client = cl
	return cl, nil
}

// Check implements BrokerChecker.
func (k *KafkaChecker) Check(ctx context.Context) Result {
	start := time.Now()
	res := Result{}
	defer func() { res.Duration = time.Since(start) }()

	if err := k.preflightTLSDial(ctx); err != nil {
		res.Reason = classifyDialError(err)
		res.Message = sanitizeErr(err)
		k.Reset()
		return res
	}

	cl, err := k.getClient()
	if err != nil {
		res.Reason = reasons.AgentInternalFailure
		res.Message = sanitizeErr(err)
		return res
	}

	apiReq := kmsg.NewPtrApiVersionsRequest()
	apiResp, err := apiReq.RequestWith(ctx, cl)
	if err != nil {
		res.Reason = mapProtocolError(err, reasons.ApiVersionsFailure)
		res.Message = sanitizeErr(err)
		k.Reset()
		return res
	}
	if apiResp == nil || len(apiResp.ApiKeys) == 0 {
		res.Reason = reasons.ApiVersionsFailure
		res.Message = "empty ApiVersions response"
		k.Reset()
		return res
	}

	metaReq := kmsg.NewPtrMetadataRequest()
	metaResp, err := metaReq.RequestWith(ctx, cl)
	if err != nil {
		res.Reason = mapProtocolError(err, reasons.MetadataFailure)
		res.Message = sanitizeErr(err)
		k.Reset()
		return res
	}
	if metaResp == nil {
		res.Reason = reasons.MetadataFailure
		res.Message = "nil Metadata response"
		k.Reset()
		return res
	}

	found := false
	var observed int32 = -1
	for _, b := range metaResp.Brokers {
		if b.NodeID == k.cfg.NodeID {
			found = true
			observed = b.NodeID
			break
		}
	}
	if !found {
		// Surface first broker id if any for diagnostics (non-secret).
		if len(metaResp.Brokers) > 0 {
			observed = metaResp.Brokers[0].NodeID
		}
		res.Reason = reasons.LocalNodeIDMismatch
		res.Message = fmt.Sprintf("expected node_id=%d not in metadata", k.cfg.NodeID)
		res.ObservedNodeID = observed
		return res
	}

	res.OK = true
	res.ObservedNodeID = observed
	res.Message = "ok"
	return res
}

func (k *KafkaChecker) preflightTLSDial(ctx context.Context) error {
	d := &net.Dialer{Timeout: 5 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", k.cfg.BrokerAddr)
	if err != nil {
		return err
	}
	tlsConn := tls.Client(conn, k.tlsConfig.Clone())
	defer tlsConn.Close()
	deadline, ok := ctx.Deadline()
	if ok {
		_ = tlsConn.SetDeadline(deadline)
	} else {
		_ = tlsConn.SetDeadline(time.Now().Add(5 * time.Second))
	}
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		return err
	}
	return nil
}

func mapProtocolError(err error, fallback string) string {
	if err == nil {
		return fallback
	}
	msg := strings.ToLower(err.Error())
	if r := TLSFailure(err); r == reasons.TLSChainFailure || r == reasons.TLSHostnameFailure || r == reasons.TLSClientIdentityFailure {
		return r
	}
	if strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline") {
		return fallback
	}
	if strings.Contains(msg, "eof") || strings.Contains(msg, "broken pipe") || strings.Contains(msg, "connection reset") {
		return fallback
	}
	if dialReason := TLSFailure(err); dialReason == reasons.TCPConnectFailure {
		return reasons.TCPConnectFailure
	}
	return fallback
}

func classifyDialError(err error) string {
	if err == nil {
		return reasons.AgentInternalFailure
	}
	if r := ClassifyVerifyError(err); r != "" {
		// Prefer specific TLS classification from verify errors.
		if _, ok := err.(interface{ Unwrap() error }); ok || strings.Contains(strings.ToLower(err.Error()), "x509") || strings.Contains(strings.ToLower(err.Error()), "tls") || strings.Contains(strings.ToLower(err.Error()), "certificate") {
			return r
		}
	}
	return TLSFailure(err)
}

func sanitizeErr(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	// Strip anything that looks like a password or PEM blob.
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "password") || strings.Contains(msg, "-----BEGIN") {
		return "redacted error"
	}
	if len(msg) > 240 {
		return msg[:240]
	}
	return msg
}
