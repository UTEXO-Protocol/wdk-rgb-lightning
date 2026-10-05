#!/bin/sh
set -eu
[ "${1:-}" = get ] || exit 0
protocol= host= repository=
while IFS='=' read -r key value; do
  case "$key" in
    protocol) protocol=$value ;;
    host) host=$value ;;
    path) repository=${value%.git} ;;
  esac
done
[ "$protocol" = https ] && [ "$host" = github.com ] || exit 0
case "$repository" in
  UTEXO-Protocol/rgb-consensus-s-bfa|UTEXO-Protocol/rgb-ops-s-bfa|UTEXO-Protocol/rgb-schemas-s-bfa) ;;
  *) exit 0 ;;
esac
printf 'username=x-access-token\npassword=%s\n\n' "$(cat /run/secrets/org_read_token)"
