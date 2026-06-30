#!/bin/bash
set -e

TARGET="/var/www/greenhouse-lucor"

echo "Building Tatufa..."
npm run build

echo "Deploying to $TARGET ..."
mkdir -p "$TARGET"
rm -rf "$TARGET"/*
cp -r dist/* "$TARGET/"

cp greenhouse-lucor.nginx.conf /etc/nginx/sites-available/greenhouse-lucor
ln -sf /etc/nginx/sites-available/greenhouse-lucor /etc/nginx/sites-enabled/greenhouse-lucor

nginx -t && kill -HUP $(pgrep -f "nginx: master") 2>/dev/null || nginx

echo ""
echo "Deployed successfully."
echo ""
echo "  http://localhost:8085"
echo ""
echo "Backend (if not running):"
echo "  cd api && MQTT_MODE=mock python3 -m uvicorn server:app --host 0.0.0.0 --port 6001 &"
