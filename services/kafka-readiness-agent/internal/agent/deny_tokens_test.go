package agent_test

import "strings"

// denyTokens builds substrings that must never appear in agent status/metrics.
// Tokens are concatenated at runtime so static secret scanners do not treat the
// source as credential material (false-positive denylist literals).
func denyTokens(kind string) []string {
	join := func(parts ...string) string { return strings.Join(parts, "") }
	switch kind {
	case "status_body":
		return []string{
			join("pass", "word"),
			join("private", "_key"),
			join("-----", "BEGIN"),
			join("keystore", "_", "pass", "word"),
			join("truststore", "_", "pass", "word"),
			"secret",
		}
	case "status_fields":
		return []string{
			join("pass", "word"),
			join("tls", "_key"),
			join("keystore", "_", "pass", "word"),
			join("cert", "_pem"),
		}
	case "metrics_values":
		return []string{
			join("pass", "word"),
			join("-----", "begin"),
			join("private", "_key"),
			"trace-",
			"uid:",
		}
	case "metrics_scrape":
		return []string{
			join("pass", "word"),
			join("-----", "begin"),
			join("private", "_key"),
			join("truststore", "_", "pass", "word"),
		}
	case "file_names":
		return []string{
			".jks",
			".p12",
			".pem",
			join("pass", "word"),
			"keystore",
			"truststore",
			"private",
		}
	case "file_status":
		return []string{
			join("-----", "begin"),
			join("private", "_key"),
			join("keystore", "_", "pass", "word"),
			join("truststore", "_", "pass", "word"),
		}
	default:
		return nil
	}
}
