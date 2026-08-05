package httpapi_test

import (
	"net"
	"strings"
	"testing"
)

func TestContractLoopbackBindPrefix(t *testing.T) {
	// Production default must be loopback-only; non-loopback requires explicit ops override.
	defaultAddr := "127.0.0.1:8099"
	host, _, err := net.SplitHostPort(defaultAddr)
	if err != nil {
		t.Fatal(err)
	}
	if host != "127.0.0.1" && host != "::1" {
		t.Fatalf("default bind host %q is not loopback", host)
	}
	if strings.HasPrefix(host, "0.0.0.0") {
		t.Fatal("0.0.0.0 forbidden as default")
	}
}
