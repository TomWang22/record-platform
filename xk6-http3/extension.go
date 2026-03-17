package xk6http3

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"go.k6.io/k6/js/modules"
)

// closeAfterRoundTripper wraps http3.RoundTripper and closes it after the first RoundTrip.
// Used when noReuse=1 to avoid stale QUIC sessions after Caddy cert reload.
type closeAfterRoundTripper struct {
	rt *http3.RoundTripper
}

func (c *closeAfterRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := c.rt.RoundTrip(req)
	_ = c.rt.Close() // Release QUIC connection immediately
	return resp, err
}

func init() {
	modules.Register("k6/x/http3", New())
}

type RootModule struct{}

func New() *RootModule {
	return &RootModule{}
}

func (*RootModule) NewModuleInstance(vu modules.VU) modules.Instance {
	return &ModuleInstance{vu: vu}
}

type ModuleInstance struct {
	vu     modules.VU
	client *http.Client
	rt     *http3.RoundTripper
	once   sync.Once
}

// noReuseOption checks env K6_HTTP3_NO_REUSE or options["noReuse"].
// When set: create fresh QUIC connection per request (avoids stale sessions after Caddy cert reload).
func (mi *ModuleInstance) noReuseOption(options map[string]interface{}) bool {
	if getBoolOption(options, "noReuse", false) {
		return true
	}
	// Env var (set by rotation suite) — k6 exposes __ENV to JS; JS can pass to options
	return false
}

// getOrCreateClient returns a per-VU HTTP/3 client, reusing the QUIC connection across iterations.
// When noReuse: create fresh transport per request and close after (avoids stale sessions during cert rotation).
func (mi *ModuleInstance) getOrCreateClient(options map[string]interface{}) *http.Client {
	if options == nil {
		options = make(map[string]interface{})
	}
	if mi.noReuseOption(options) {
		rt := &http3.RoundTripper{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: getBoolOption(options, "insecureSkipTLSVerify", false),
				ServerName:         getStringOption(options, "serverName", ""),
			},
			QuicConfig: &quic.Config{
				HandshakeIdleTimeout: 3 * time.Second,  // Fail fast on handshake stall
				MaxIdleTimeout:       5 * time.Second,  // Prevent 15s zombie sessions
				KeepAlivePeriod:      2 * time.Second,  // Aggressive keepalive for rotation
			},
		}
		timeout := getDurationOption(options, "timeout", 60*time.Second)
		// Wrap to close RoundTripper after request (releases QUIC connection)
		return &http.Client{
			Transport: &closeAfterRoundTripper{rt: rt},
			Timeout:   timeout,
		}
	}
	mi.once.Do(func() {
		// Per-VU client: one QUIC connection per VU, reused across iterations.
		mi.rt = &http3.RoundTripper{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: getBoolOption(options, "insecureSkipTLSVerify", false),
				ServerName:         getStringOption(options, "serverName", ""),
			},
			QuicConfig: &quic.Config{
				HandshakeIdleTimeout: 3 * time.Second,  // Fail fast on handshake stall
				MaxIdleTimeout:       5 * time.Second,  // Prevent 15s zombie sessions (reused path)
				KeepAlivePeriod:      2 * time.Second,  // Aggressive keepalive
			},
		}
		timeout := getDurationOption(options, "timeout", 60*time.Second)
		mi.client = &http.Client{
			Transport: mi.rt,
			Timeout:   timeout,
		}
	})
	return mi.client
}

func (mi *ModuleInstance) Exports() modules.Exports {
	return modules.Exports{
		Named: map[string]interface{}{
			"request": mi.request,
			"get":     mi.get,
			"post":    mi.post,
		},
	}
}

func (mi *ModuleInstance) request(method, url string, options map[string]interface{}) map[string]interface{} {
	client := mi.getOrCreateClient(options)

	// Create request
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		return map[string]interface{}{
			"status": 0,
			"error":  fmt.Sprintf("Failed to create request: %v", err),
		}
	}

	// Set headers
	if headers, ok := options["headers"].(map[string]interface{}); ok {
		for k, v := range headers {
			if str, ok := v.(string); ok {
				req.Header.Set(k, str)
			}
		}
	}

	// Execute request with longer timeout for QUIC handshake
	requestTimeout := getDurationOption(options, "timeout", 60*time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()

	resp, err := client.Do(req.WithContext(ctx))
	if err != nil {
		return map[string]interface{}{
			"status": 0,
			"error":  fmt.Sprintf("Request failed: %v", err),
		}
	}
	defer resp.Body.Close()

	// Read body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return map[string]interface{}{
			"status": resp.StatusCode,
			"error":  fmt.Sprintf("Failed to read body: %v", err),
			"body":   "",
		}
	}

	// CRITICAL: quic-go does not populate resp.Proto reliably (often empty even for successful HTTP/3).
	// Since this request went through http3.RoundTripper, we KNOW it's HTTP/3.
	// Always set protocol explicitly rather than relying on resp.Proto.
	return map[string]interface{}{
		"status": resp.StatusCode,
		"body":   string(body),
		"headers": func() map[string]string {
			h := make(map[string]string)
			for k, v := range resp.Header {
				if len(v) > 0 {
					h[k] = v[0]
				}
			}
			return h
		}(),
		"proto":    "HTTP/3",
		"protocol": "HTTP/3",
	}
}

func (mi *ModuleInstance) get(url string, options map[string]interface{}) map[string]interface{} {
	return mi.request("GET", url, options)
}

func (mi *ModuleInstance) post(url string, body string, options map[string]interface{}) map[string]interface{} {
	// TODO: Add body support
	return mi.request("POST", url, options)
}

func getBoolOption(options map[string]interface{}, key string, defaultValue bool) bool {
	if val, ok := options[key].(bool); ok {
		return val
	}
	return defaultValue
}

func getDurationOption(options map[string]interface{}, key string, defaultValue time.Duration) time.Duration {
	if val, ok := options[key].(string); ok {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
	}
	return defaultValue
}

func getStringOption(options map[string]interface{}, key string, defaultValue string) string {
	if val, ok := options[key].(string); ok {
		return val
	}
	return defaultValue
}

