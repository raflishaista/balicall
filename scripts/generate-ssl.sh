#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS_DIR="$ROOT/certs"
mkdir -p "$CERTS_DIR"

# Dapatkan IP server otomatis jika tidak disediakan
SERVER_IP="${1:-$(hostname -I | awk '{print $1}')}"
if [ -z "$SERVER_IP" ]; then
  SERVER_IP="10.17.101.232"
fi

echo "========================================================"
echo "  BaliCall Local SSL Certificate Generator"
echo "  Target IP: $SERVER_IP"
echo "========================================================"

# 1. Buat Root CA lokal (jika belum ada)
if [ ! -f "$CERTS_DIR/ca.crt" ] || [ ! -f "$CERTS_DIR/ca.key" ]; then
  echo "[1/3] Membuat Root CA lokal..."
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$CERTS_DIR/ca.key" -out "$CERTS_DIR/ca.crt" \
    -subj "/CN=BaliCall Local Root CA/O=Bali Tower/OU=Internal IT"
  chmod 600 "$CERTS_DIR/ca.key"
  echo "      ✅ Root CA selesai: certs/ca.crt"
else
  echo "[1/3] Menggunakan Root CA yang sudah ada: certs/ca.crt"
fi

# 2. Buat Private Key & CSR untuk Server
echo "[2/3] Membuat Server Key & CSR..."
openssl req -newkey rsa:2048 -nodes \
  -keyout "$CERTS_DIR/server.key" -out "$CERTS_DIR/server.csr" \
  -subj "/CN=$SERVER_IP/O=Bali Tower/OU=Sentra Meeting"
chmod 600 "$CERTS_DIR/server.key"

# 3. Tandatangani Sertifikat Server dengan Subject Alternative Name (SAN)
echo "[3/3] Menandatangani Sertifikat Server dengan SAN..."
openssl x509 -req -in "$CERTS_DIR/server.csr" \
  -CA "$CERTS_DIR/ca.crt" -CAkey "$CERTS_DIR/ca.key" -CAcreateserial \
  -out "$CERTS_DIR/server.crt" -days 825 \
  -extfile <(printf "subjectAltName=IP:%s,IP:127.0.0.1,DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth" "$SERVER_IP")

rm -f "$CERTS_DIR/server.csr" "$CERTS_DIR/ca.srl"

echo ""
echo "========================================================"
echo "  ✅ Sertifikat SSL berhasil dibuat di folder certs/:"
echo "  - certs/ca.crt     -> Bagikan dan install di browser/perangkat klien"
echo "  - certs/server.crt -> Sertifikat HTTPS untuk server"
echo "  - certs/server.key -> Kunci rahasia server"
echo "========================================================"

