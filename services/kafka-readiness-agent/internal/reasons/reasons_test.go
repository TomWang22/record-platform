package reasons_test

import (
	"testing"

	"record-platform/kafka-readiness-agent/internal/reasons"
)

func TestAllReasonCodes(t *testing.T) {
	want := []string{
		"TLS_CHAIN_FAILURE",
		"TLS_HOSTNAME_FAILURE",
		"TLS_CLIENT_IDENTITY_FAILURE",
		"TCP_CONNECT_FAILURE",
		"APIVERSIONS_FAILURE",
		"METADATA_FAILURE",
		"LOCAL_NODE_ID_MISMATCH",
		"STALE_LAST_SUCCESS",
		"AGENT_INTERNAL_FAILURE",
	}
	got := reasons.All()
	if len(got) != len(want) {
		t.Fatalf("len=%d", len(got))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%d: %s != %s", i, got[i], want[i])
		}
	}
}
