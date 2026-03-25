#!/bin/bash
# Cleanup helper for sanity tests

cleanup_sanity_outputs() {
  rm -f /tmp/sanity-*.json
}

cleanup_docker() {
  docker compose -f test/sanity/docker-compose.yml down --volumes --remove-orphans 2>/dev/null
}
