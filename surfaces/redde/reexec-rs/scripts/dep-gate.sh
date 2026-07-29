#!/bin/sh
set -eu

tree="$(cargo tree --locked -e normal --prefix none)"
revm_versions="$(printf '%s\n' "$tree" | sed -n 's/^revm v\([0-9.]*\).*/\1/p' | sort -u)"

if [ "$revm_versions" != "38.0.0" ]; then
    printf 'expected only revm v38.0.0, found: %s\n' "$revm_versions" >&2
    exit 1
fi

if printf '%s\n' "$tree" | grep -Eq '^(native-tls|openssl) v'; then
    printf 'native TLS/OpenSSL is forbidden in the runtime graph\n' >&2
    exit 1
fi

printf 'dependency gate passed: revm v38.0.0 only; no native-tls or openssl\n'
