#!/usr/bin/env bash
# Deploy the web build to https://freditor.crypt0potam.us
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build:web
aws s3 sync dist-web s3://freditor.crypt0potam.us --delete --profile crypt0potamus
aws cloudfront create-invalidation \
  --distribution-id E3U4QH7J131MTE \
  --paths "/*" \
  --profile crypt0potamus \
  --query "Invalidation.{id:Id,status:Status}" --output json
echo "Deployed to https://freditor.crypt0potam.us"
