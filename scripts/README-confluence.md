# Sinkronisasi Dokumentasi ke Confluence

Dua jalur: skrip otomatis (`sync-confluence.mjs`) atau langkah manual dengan `curl`.
Skripnya tidak punya dependensi — Node 18+ sudah punya `fetch` global, jadi tidak ada
`npm install`.

---

## A. Menyiapkan akses

### 1. Buat API token

1. Buka <https://id.atlassian.com/manage-profile/security/api-tokens>
2. **Create API token** → beri nama, misalnya `rakit-docs-sync`
3. Salin tokennya sekarang. Atlassian hanya menampilkannya sekali.

> API token menggantikan password Anda. Jangan pernah di-commit. Token ini bukan
> kredensial berbagi — ia mewakili akun Anda dan mewarisi seluruh izinnya.

### 2. Cari Space Key

Buka space tujuan di Confluence. Key-nya ada di URL:

```
https://your-tenant.atlassian.net/wiki/spaces/RAKIT/overview
                                          ^^^^^ = space key
```

### 3. (Opsional) Siapkan halaman induk

Buat satu halaman kosong, misalnya **"Rakit.ai Docs"**. Ambil ID-nya dari URL:

```
https://your-tenant.atlassian.net/wiki/spaces/RAKIT/pages/123456789/Rakit.ai+Docs
                                                            ^^^^^^^^^ = page id
```

Dengan induk, kedua dokumen tersusun rapi di bawahnya. Tanpa induk, keduanya dibuat di
akar space.

### 4. Set environment variable

**Git Bash / macOS / Linux:**

```bash
export CONFLUENCE_BASE_URL="https://your-tenant.atlassian.net/wiki"
export CONFLUENCE_EMAIL="anda@perusahaan.com"
export CONFLUENCE_API_TOKEN="token-dari-langkah-1"
export CONFLUENCE_SPACE_KEY="RAKIT"
export CONFLUENCE_PARENT_ID="123456789"   # opsional
```

**PowerShell:**

```powershell
$env:CONFLUENCE_BASE_URL = "https://your-tenant.atlassian.net/wiki"
$env:CONFLUENCE_EMAIL    = "anda@perusahaan.com"
$env:CONFLUENCE_API_TOKEN = "token-dari-langkah-1"
$env:CONFLUENCE_SPACE_KEY = "RAKIT"
$env:CONFLUENCE_PARENT_ID = "123456789"
```

`CONFLUENCE_BASE_URL` **wajib** menyertakan `/wiki` untuk Confluence Cloud.

---

## B. Menjalankan skrip

```bash
# 1. Dry run dulu — tidak menulis apa pun, hanya melaporkan rencananya
node scripts/sync-confluence.mjs

# 2. Kalau rencananya sudah benar, baru terbitkan
node scripts/sync-confluence.mjs --apply

# 3. Satu dokumen saja
node scripts/sync-confluence.mjs --apply --file TODO.md
```

Dry run adalah default dengan sengaja: menerbitkan ke Confluence terlihat oleh seluruh
tim, jadi itu harus diminta secara eksplisit, bukan terjadi karena lupa memberi flag.

### Perilaku yang perlu diketahui

| Situasi | Yang dilakukan skrip |
|---------|---------------------|
| Halaman belum ada | Dibuat baru dengan judul dari konstanta `DOCS` |
| Halaman sudah ada | Diperbarui; nomor versi dinaikkan otomatis |
| Judul diubah di `DOCS` | Halaman baru dibuat; yang lama tertinggal — hapus manual |
| `--file` tidak cocok | Keluar dengan daftar file yang dikenal |
| Env var kurang | Keluar sebelum menyentuh jaringan, menyebut yang hilang |
| Request > 20 detik | Dibatalkan (setiap panggilan punya timeout eksplisit) |

Pencocokan dilakukan **berdasarkan judul**, bukan ID, agar ID tidak perlu disimpan di
repo. Konsekuensinya: mengganti judul akan menghasilkan halaman duplikat.

### Konversi Markdown

Skrip membawa konverter kecil Markdown → Confluence Storage Format (XHTML) yang mendukung
heading, paragraf, daftar, tabel, blok kode, blockquote, kode inline, bold, italic, dan
link. Ini bukan mesin Markdown umum — konstruksi di luar itu diteruskan sebagai teks
ter-escape, tidak dibuang diam-diam.

---

## C. Alternatif: manual dengan curl

Kalau tidak ingin menjalankan skrip, ini urutan mentahnya.

### 1. Cek halaman yang sudah ada

```bash
curl -s -u "$CONFLUENCE_EMAIL:$CONFLUENCE_API_TOKEN" \
  "$CONFLUENCE_BASE_URL/api/v2/pages?title=Rakit.ai%20%E2%80%94%20Knowledge%20Base&space-key=$CONFLUENCE_SPACE_KEY&status=current" \
  | jq '.results[] | {id, title, version}'
```

Kosong berarti belum ada.

### 2. Buat halaman baru

```bash
# Ubah Markdown menjadi storage HTML dulu
node -e "
import('./scripts/sync-confluence.mjs').then(async m => {
  const fs = await import('node:fs/promises')
  const md = await fs.readFile('KNOWLEDGE_BASE.md','utf8')
  await fs.writeFile('/tmp/kb.html', m.markdownToStorage(md))
})"

# Lalu kirim
jq -n --arg title "Rakit.ai — Knowledge Base" \
      --arg space "$CONFLUENCE_SPACE_KEY" \
      --rawfile body /tmp/kb.html \
      '{type:"page", title:$title, space:{key:$space},
        body:{storage:{value:$body, representation:"storage"}}}' \
| curl -s -X POST \
    -u "$CONFLUENCE_EMAIL:$CONFLUENCE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data @- \
    "$CONFLUENCE_BASE_URL/rest/api/content" | jq '{id, title}'
```

### 3. Perbarui halaman yang ada

Update **wajib** menyertakan `version.number` yang lebih tinggi, kalau tidak Confluence
menolak dengan `409 Conflict`.

```bash
PAGE_ID=123456789
NEXT=$(( $(curl -s -u "$CONFLUENCE_EMAIL:$CONFLUENCE_API_TOKEN" \
  "$CONFLUENCE_BASE_URL/rest/api/content/$PAGE_ID?expand=version" | jq '.version.number') + 1 ))

jq -n --arg id "$PAGE_ID" --arg title "Rakit.ai — Knowledge Base" \
      --argjson ver "$NEXT" --rawfile body /tmp/kb.html \
      '{id:$id, type:"page", title:$title, version:{number:$ver},
        body:{storage:{value:$body, representation:"storage"}}}' \
| curl -s -X PUT \
    -u "$CONFLUENCE_EMAIL:$CONFLUENCE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data @- \
    "$CONFLUENCE_BASE_URL/rest/api/content/$PAGE_ID" | jq '{id, version}'
```

---

## D. Memasukkan ke CI

Simpan kredensial sebagai **secret**, jangan pernah sebagai variabel biasa di file
workflow yang ter-commit.

```yaml
# .github/workflows/sync-docs.yml
name: Sync docs to Confluence

on:
  push:
    branches: [main]
    paths: ['KNOWLEDGE_BASE.md', 'TODO.md']
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: Sync
        env:
          CONFLUENCE_BASE_URL: ${{ secrets.CONFLUENCE_BASE_URL }}
          CONFLUENCE_EMAIL: ${{ secrets.CONFLUENCE_EMAIL }}
          CONFLUENCE_API_TOKEN: ${{ secrets.CONFLUENCE_API_TOKEN }}
          CONFLUENCE_SPACE_KEY: ${{ secrets.CONFLUENCE_SPACE_KEY }}
          CONFLUENCE_PARENT_ID: ${{ secrets.CONFLUENCE_PARENT_ID }}
        run: node scripts/sync-confluence.mjs --apply
```

Tambahkan dulu ke **Settings → Secrets and variables → Actions**.

---

## E. Kalau gagal

| Gejala | Penyebab umum |
|--------|---------------|
| `401 Unauthorized` | Email salah, atau token sudah dicabut/di-regenerate |
| `403 Forbidden` | Akun tidak punya izin tulis di space itu |
| `404 Not Found` | `CONFLUENCE_BASE_URL` tidak menyertakan `/wiki`, atau space key salah |
| `409 Conflict` | Nomor versi tidak dinaikkan (hanya pada update manual) |
| `400 Bad Request` | Storage format tidak valid — biasanya tabel atau blok kode cacat |
| `aborted` | Request melewati timeout 20 detik; periksa koneksi atau ukuran halaman |

Untuk melihat pesan asli dari Atlassian, jalankan dengan `NODE_DEBUG=undici` atau
tambahkan sementara `console.error(text)` di helper `api()`.

---

## Catatan keamanan

- Token Atlassian mewakili **akun Anda** dan seluruh izinnya. Perlakukan seperti
  password, bukan seperti kunci API berlingkup sempit.
- Jangan pernah menaruh token di `.env` yang ter-commit. `.gitignore` repo ini sudah
  mengecualikan `.env` dan `.env.*`.
- Halaman Confluence yang diterbitkan akan terlihat oleh siapa pun yang punya akses ke
  space tersebut. Pastikan `KNOWLEDGE_BASE.md` dan `TODO.md` tidak memuat detail internal
  yang tidak boleh dibaca seluruh tim.
