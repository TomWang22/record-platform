"""Unit tests for python-ai peer authorization helpers."""
from __future__ import annotations

import os
import unittest

from app.peer_auth import (
    authorize_peer,
    identities_from_auth_context,
    is_health_or_reflection_method,
    normalize_peer_identity,
)


class PeerAuthHelpersTest(unittest.TestCase):
    def test_normalize_dns_and_fqdn(self):
        self.assertEqual(normalize_peer_identity("DNS:api-gateway"), "api-gateway")
        self.assertEqual(
            normalize_peer_identity("api-gateway.record-platform.svc.cluster.local"),
            "api-gateway",
        )
        self.assertEqual(
            normalize_peer_identity(
                "spiffe://record-platform.local/ns/record-platform/sa/listings-service"
            ),
            "listings-service",
        )

    def test_health_bypass_paths(self):
        self.assertTrue(is_health_or_reflection_method("/grpc.health.v1.Health/Check"))
        self.assertFalse(
            is_health_or_reflection_method("/python_ai.PythonAIService/AuctionHeat")
        )

    def test_identities_from_auth_context(self):
        ctx = {
            b"x509_subject_alternative_name": [
                b"DNS:api-gateway",
                b"DNS:api-gateway.record-platform.svc.cluster.local",
            ]
        }
        ids = identities_from_auth_context(ctx)
        self.assertIn("api-gateway", ids)

    def test_authorize_allow_and_deny(self):
        os.environ.pop("RP_MTLS_PEER_AUTH_DISABLE", None)
        allow_ctx = {b"x509_subject_alternative_name": [b"DNS:api-gateway"]}
        deny_ctx = {b"x509_subject_alternative_name": [b"DNS:auth-service"]}
        ok, reason = authorize_peer(
            method="/python_ai.PythonAIService/AuctionHeat",
            auth_context=allow_ctx,
        )
        self.assertTrue(ok)
        self.assertEqual(reason, "allow")
        bad, reason2 = authorize_peer(
            method="/python_ai.PythonAIService/AuctionHeat",
            auth_context=deny_ctx,
        )
        self.assertFalse(bad)
        self.assertEqual(reason2, "deny_unauthorized")


if __name__ == "__main__":
    unittest.main()
