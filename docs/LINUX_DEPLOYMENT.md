# Panduan Menjalankan & Deploy BaliCall di Linux (SSH Environment)

Panduan lengkap untuk menjalankan dan mendeploy **BaliCall** pada server Linux (Ubuntu / Debian / RHEL / CentOS) melalui koneksi SSH.

---

## 1. Prasyarat Sistem Linux

Sebelum menjalankan aplikasi, pastikan dependency berikut telah terinstal pada server:

### A. Node.js (v22.18+ atau v24 LTS)
```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# Cek versi
node -v   # Pastikan >= v22.18.0
npm -v
```

### B. LiveKit SFU Server untuk Linux
Di Windows, `start.bat` menggunakan `bin/livekit-server.exe`. Di Linux, binary yang digunakan adalah `livekit-server` untuk arsitektur Linux (`amd64` atau `arm64`).

**Opsi 1 (Otomatis via setup script):**
```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```
Script ini akan secara otomatis mendeteksi arsitektur server (`x86_64` atau `aarch64`), mengunduh binary resmi LiveKit ke `bin/livekit-server`, dan menginstal seluruh dependensi.

**Opsi 2 (Instal global resmi):**
```bash
curl -sSL https://get.livekit.io | bash
```

---

## 2. Port & Firewall yang Harus Dibuka

Jika server berada di balik firewall (UFW / iptables / AWS Security Group):

| Port | Protokol | Keterangan |
|---|---|---|
| **3001** | TCP | BaliCall Web App & Backend API |
| **7880** | TCP | LiveKit SFU (Signaling WebSocket & HTTP) |
| **7881** | TCP | LiveKit WebRTC TCP fallback |
| **50000 - 60000** | UDP | LiveKit WebRTC Media Traffic (Audio/Video RTP) |

Contoh membuka port dengan `ufw`:
```bash
sudo ufw allow 3001/tcp
sudo ufw allow 7880/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 50000:60000/udp
sudo ufw reload
```

---

## 3. Konfigurasi Lingkungan (`server/.env`)

Salin file konfigurasi dan sesuaikan:
```bash
cp server/.env.example server/.env
nano server/.env
```

Poin penting konfigurasi di server Linux:
1. **`LIVEKIT_URL`**:
   - Jika diakses dari PC lain melalui jaringan: isi dengan IP server Linux atau domain Anda, contoh: `ws://192.168.1.100:7880` atau `wss://meet.balitower.co.id:7880`.
   - Jika menggunakan SSH Port Forwarding: biarkan `ws://127.0.0.1:7880`.
2. **`DATABASE_URL`**:
   - Pastikan URL database PostgreSQL dapat dijangkau dari server Linux tersebut (contoh `postgresql://jds3:jds-magang@10.17.101.232:5432/jds3_db`).
3. **`CORS_ORIGINS`**:
   - Masukkan alamat IP / domain server Anda, dipisahkan koma.

---

## 4. Cara Menjalankan Aplikasi

Tersedia beberapa metode sesuai kebutuhan:

### Metode 1: Menggunakan `start.sh` (Paling Praktis)
File `start.sh` adalah padanan resmi dari `start.bat` untuk Linux.

```bash
chmod +x start.sh
```

- **Mode Development** (menjalankan LiveKit + Backend + Vite dev server secara bersamaan):
  ```bash
  ./start.sh
  ```
- **Mode Production** (otomatis build client dan menyajikan via port 3001):
  ```bash
  ./start.sh prod
  ```
*Tekan `Ctrl + C` untuk menghentikan semua service secara bersih.*

---

### Metode 2: Deploy Production Latar Belakang (PM2)
Jika Anda menutup sesi SSH, proses biasa akan mati. Gunakan **PM2** agar aplikasi tetap berjalan 24/7 dan otomatis restart jika server reboot.

1. **Instal PM2 & Build Client**:
   ```bash
   sudo npm install -g pm2
   npm run build
   ```

2. **Jalankan dengan konfigurasi `ecosystem.config.cjs`**:
   ```bash
   pm2 start ecosystem.config.cjs
   ```

3. **Cek Status & Log**:
   ```bash
   pm2 status
   pm2 logs
   ```

4. **Aktifkan Auto-Start saat Server Reboot**:
   ```bash
   pm2 save
   pm2 startup
   ```

5. **Menghentikan Service**:
   ```bash
   pm2 stop ecosystem.config.cjs
   ```

---

### Metode 3: Menjalankan Manual per Terminal (atau via `tmux`)
Jika ingin menjalankan service satu per satu untuk debugging:

```bash
# Terminal / Tab 1: LiveKit SFU
./bin/livekit-server --config livekit.yaml --dev

# Terminal / Tab 2: Backend & Web App
cd server
npm run dev

# Terminal / Tab 3 (Jika mode dev frontend terpisah):
cd client
npm run dev -- --host 0.0.0.0
```

---

## 5. Catatan Penting: Izin Mikrofon & Kamera (HTTPS)

> [!IMPORTANT]
> Browser modern (Chrome, Edge, Firefox, Safari) **memblokir akses mikrofon dan kamera** (`getUserMedia`) pada alamat IP jarak jauh (`http://192.168.x.x:3001`) karena dianggap *Insecure Context*. Izin hanya dibuka otomatis pada `localhost` atau **HTTPS**.

### Solusi A: SSH Port Forwarding (Paling Mudah untuk Testing)
Jalankan SSH dari laptop lokal Anda dengan flag `-L`:
```bash
ssh -L 3001:localhost:3001 -L 7880:localhost:7880 user@ip-server-linux
```
Lalu buka browser di laptop Anda di `http://localhost:3001`. Browser akan menganggap koneksi ini sebagai `localhost` (Secure Context) sehingga mikrofon dan kamera langsung diizinkan!

### Solusi B: Mengaktifkan Flag di Google Chrome (Untuk Akses IP LAN)
Buka di browser Chrome Anda:
`chrome://flags/#unsafely-treat-insecure-origin-as-secure`
- Masukkan URL server: `http://<IP_SERVER_LINUX>:3001`
- Pilih **Enabled** dan klik **Relaunch**.

### Solusi C: Pasang Nginx Reverse Proxy dengan SSL (Untuk Produksi)
Gunakan Nginx dan sertifikat SSL gratis (Let's Encrypt / Certbot):
```nginx
server {
    listen 80;
    server_name meet.balitower.co.id;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name meet.balitower.co.id;

    ssl_certificate /etc/letsencrypt/live/meet.balitower.co.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/meet.balitower.co.id/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```
