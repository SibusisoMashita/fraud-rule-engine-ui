#!/bin/sh
set -eu

# Configuration is operator-owned, never taken from a browser request.
case "${API_UPSTREAM:-app:8080}" in
  app:8080|load-balancer:8080) ;;
  *) printf '%s\n' 'API_UPSTREAM must be app:8080 or load-balancer:8080.' >&2; exit 1 ;;
esac
export API_UPSTREAM="${API_UPSTREAM:-app:8080}"
envsubst '${API_UPSTREAM}' < /etc/nginx/nginx.conf.template > /tmp/nginx.conf
nginx -t -c /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
