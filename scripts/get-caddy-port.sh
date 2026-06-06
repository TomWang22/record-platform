#!/usr/bin/env bash
# Helper script to get the correct port for Caddy based on which node pods are on

# Get pod nodes
POD1_NODE=$(kubectl get pod -n ingress-nginx -l app=caddy-h3 -o jsonpath='{.items[0].spec.nodeName}' 2>/dev/null || echo "")
POD2_NODE=$(kubectl get pod -n ingress-nginx -l app=caddy-h3 -o jsonpath='{.items[1].spec.nodeName}' 2>/dev/null || echo "")

# Map nodes to ports
case "$POD1_NODE" in
  *control-plane*) echo "8444" ;;
  *worker) echo "8445" ;;
  *worker2) echo "8446" ;;
  *) echo "8444" ;; # Default
esac

