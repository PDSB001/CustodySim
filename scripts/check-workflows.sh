#!/usr/bin/env bash
set -euo pipefail
# Official release, pinned version and checksum; no package manager mutation.
tools="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/custodysim-actionlint.XXXXXX")"
trap 'rm -rf -- "$tools"' EXIT
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz \
  -o "$tools/actionlint.tar.gz"
printf '%s  %s\n' '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8' \
  "$tools/actionlint.tar.gz" | sha256sum --check --status
tar -xzf "$tools/actionlint.tar.gz" -C "$tools" actionlint
"$tools/actionlint" -pyflakes= .github/workflows/*.yml
