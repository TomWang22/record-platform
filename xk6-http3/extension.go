package xk6http3

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"go.k6.io/k6/js/modules"
)

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
	vu modules.VU
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
	// Create HTTP/3 client with proper configuration
	roundTripper := &http3.RoundTripper{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: getBoolOption(options, "insecureSkipTLSVerify", true), // Default to true for dev
			ServerName:         getStringOption(options, "serverName", ""),
		},
		QuicConfig: &quic.Config{
			HandshakeIdleTimeout: 10 * time.Second, // Increased for QUIC handshake
			MaxIdleTimeout:        60 * time.Second, // Increased for connection reuse
			KeepAlivePeriod:       10 * time.Second, // Keep connection alive
		},
	}
	defer roundTripper.Close()

	timeout := getDurationOption(options, "timeout", 60*time.Second) // Increased default for QUIC
	client := &http.Client{
		Transport: roundTripper,
		Timeout:   timeout,
	}

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
		"proto": "HTTP/3",
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

