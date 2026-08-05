// Package reasons defines readiness reason codes exposed on /readyz and /status.
package reasons

// Stable reason codes for NOT_READY responses. Do not rename without updating
// reports/kafka/gate5-pre-v10-readiness-agent-contract.json.
const (
	TLSChainFailure          = "TLS_CHAIN_FAILURE"
	TLSHostnameFailure       = "TLS_HOSTNAME_FAILURE"
	TLSClientIdentityFailure = "TLS_CLIENT_IDENTITY_FAILURE"
	TCPConnectFailure        = "TCP_CONNECT_FAILURE"
	ApiVersionsFailure       = "APIVERSIONS_FAILURE"
	MetadataFailure          = "METADATA_FAILURE"
	LocalNodeIDMismatch      = "LOCAL_NODE_ID_MISMATCH"
	StaleLastSuccess         = "STALE_LAST_SUCCESS"
	AgentInternalFailure     = "AGENT_INTERNAL_FAILURE"
)

// All lists every reason code for contract/docs validation.
func All() []string {
	return []string{
		TLSChainFailure,
		TLSHostnameFailure,
		TLSClientIdentityFailure,
		TCPConnectFailure,
		ApiVersionsFailure,
		MetadataFailure,
		LocalNodeIDMismatch,
		StaleLastSuccess,
		AgentInternalFailure,
	}
}
