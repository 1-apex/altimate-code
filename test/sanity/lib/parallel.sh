#!/bin/bash
# Machine-aware parallelism for sanity tests

detect_parallelism() {
  local cores=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "2")

  # Try multiple methods for RAM detection
  local ram_gb=""
  # Linux: free
  ram_gb=$(free -g 2>/dev/null | awk '/Mem:/{print $2}')
  # Linux fallback: /proc/meminfo
  if [ -z "$ram_gb" ] || [ "$ram_gb" = "0" ]; then
    ram_gb=$(awk '/MemTotal/{printf "%d", $2/1048576}' /proc/meminfo 2>/dev/null)
  fi
  # macOS: sysctl
  if [ -z "$ram_gb" ] || [ "$ram_gb" = "0" ]; then
    ram_gb=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%d", $1/1073741824}')
  fi
  # Final fallback
  ram_gb="${ram_gb:-8}"

  local parallel=2  # safe default

  if [ "$cores" -ge 16 ] && [ "$ram_gb" -ge 64 ]; then
    # Beefy Linux server (like this machine: 20 cores, 119GB)
    parallel=6
  elif [ "$cores" -ge 8 ] && [ "$ram_gb" -ge 16 ]; then
    # Good workstation or Mac with decent specs
    parallel=4
  elif [ "$cores" -ge 4 ] && [ "$ram_gb" -ge 8 ]; then
    # Modest machine or Mac laptop
    parallel=3
  fi

  # Cap by LLM API rate limits — too many concurrent requests = throttling
  if [ "$parallel" -gt 6 ]; then
    parallel=6
  fi

  echo "$parallel"
}

# Run commands in parallel batches
# Usage: run_parallel <max_parallel> <cmd1> <cmd2> <cmd3> ...
# Each cmd is a string that gets eval'd
run_parallel() {
  local max_parallel="$1"; shift
  local pids=()
  local results=()
  local batch=0

  for cmd in "$@"; do
    eval "$cmd" &
    pids+=($!)

    if [ ${#pids[@]} -ge "$max_parallel" ]; then
      # Wait for this batch
      for pid in "${pids[@]}"; do
        wait "$pid"
        results+=($?)
      done
      pids=()
      batch=$((batch + 1))
    fi
  done

  # Wait for remaining
  for pid in "${pids[@]}"; do
    wait "$pid"
    results+=($?)
  done

  # Return non-zero if any failed
  for r in "${results[@]}"; do
    if [ "$r" -ne 0 ]; then
      return 1
    fi
  done
  return 0
}
