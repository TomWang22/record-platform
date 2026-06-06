#!/usr/bin/env bash
# Post-reset runtime :dev image note (cold-bootstrap — builds happen in E.build_images).
# shellcheck shell=bash

rp_print_runtime_image_state() {
  local tag="${1:-dev}" reason="${2:-after factory reset}"
  echo ""
  echo "ℹ️  Runtime :${tag} images (${reason}): local Docker was wiped — expected empty until E.build_images."
  echo "   E.build_images builds missing targets; E.image_freshness verifies labeled hashes (14/14)."
  echo ""
}
