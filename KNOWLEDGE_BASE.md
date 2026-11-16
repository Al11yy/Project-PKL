# Knowledge Base — Rakit.ai

Ringkasan arsitektur aplikasi: pipeline PRD-to-UI, sistem desain Impeccable Style, dan
sistem saldo koin. Ditulis dari kode yang ada di `apps/editor/`, bukan dari rencana.

> **Status:** ini implementasi front-end yang berjalan penuh dengan data seed sintetis.
> Belum ada backend (Express), panggilan LLM sungguhan, Cloudflare D1/Workers, maupun
> Midtrans. Semua efek jaringan disimulasikan dengan `setTimeout` di store.

---

## 1. Gambaran Umum

Rakit.ai adalah app builder yang mengubah satu kalimat deskripsi menjadi skema database
plus aplikasi full-stack yang berjalan, lalu diterbitkan ke Cloudflare. Pengguna tidak
menulis kode dan tidak mengonfigurasi infrastruktur.

Tiga hal yang membedakannya dan harus tetap berjalan bersama:

1. **PRD-to-UI pipeline** — satu prompt menghasilkan skema + layar, bukan kanvas kosong.
2. **Edit visual gratis** — jalur keluar yang tidak pernah menyentuh saldo.
3. **Koin prabayar berbasis ledger** — setiap koin yang keluar punya baris yang bisa
   direkonsiliasi pengguna sendiri.

Sasaran pengguna tersebar lebar: pemilik UMKM yang belum pernah menyentuh database sampai
freelancer yang menyentuhnya tiap minggu. Rentang literasi teknis itulah batasan utama
antarmuka.

### Struktur repository

```
D:\PKL\Project
├── apps/editor/          # Frontend editor (Vite + React + Tailwind + Zustand)
│   ├── src/
│   │   ├── App.tsx           # Komposisi shell + routing berbasis state
│   │   ├── components/
│   │   │   ├── shell/        # TopBar, Pipeline, PromptRow, Rail
│   │   │   ├── preview/      # Preview — kanvas hasil generate
│   │   │   ├── inspector/    # Inspector — editor visual gratis
│   │   │   ├── views/        # SchemaView, LedgerView
│   │   │   └── ui/           # Button, Icons, Toasts
│   │   ├── lib/
│   │   │   ├── types.ts      # Kontrak domain + COIN_COST
│   │   │   └── seed.ts       # Data demo sintetis
│   │   ├── store/useBuilder.ts  # Seluruh state + aksi
│   │   └── index.css         # Token turunan Tailwind + base layer
│   ├── .shots/           # Harness verifikasi Playwright + screenshot
│   └── tailwind.config.js    # Token desain
├── .claude/              # Slash commands, skills, agents
├── .amanah/              # Atlas (peta arsitektur) + blueprint
├── CLAUDE.md             # Instruksi agen + aturan non-negosiabel
├── PRODUCT.md            # Definisi produk
└── prd_ai_first_app_builder.md   # Sumber kebenaran kebutuhan
```

**Tidak ada router.** Navigasi sepenuhnya lewat field `view` di store
(`'builder' | 'schema' | 'ledger'`). Konsekuensi praktis: tidak ada URL langsung ke satu
view, dan state tidak bertahan setelah reload.

---

## 2. Pipeline PRD-to-UI

### Tahapan

Didefinisikan di `src/lib/types.ts` sebagai `PIPELINE`, dirender oleh `Pipeline.tsx`:

| # | Stage | Arti | Biaya |
|---|-------|------|-------|
| 1 | `prompt` | Deskripsi diterima | — |
| 2 | `schema` | Tabel & kolom diturunkan | 20 (generate) |
| 3 | `ui` | Layar & blok disusun | termasuk generate |
| 4 | `edit` | Sunting teks/warna manual | **0** |
| 5 | `publish` | Deploy ke Cloudflare | 50 |

### Alur `runGeneration` (`store/useBuilder.ts:118`)

```
prompt masuk
  ├─ saldo < 20?  → toast "Koin tidak cukup", BERHENTI (tidak ada baris ledger)
  ├─ prompt < 12 karakter?
  │     → tulis debit -20 (outcome: failed)
  │     → tulis refund +20 (outcome: refunded)   ← pasangan, refId sama
  │     → toast gagal, BERHENTI
  └─ jalur normal
        → tulis debit -20 SEBELUM kerja dimulai (outcome: spent)
        → 5 langkah progres via setTimeout (700 ms × i)
        → langkah terakhir: detail baris diisi jumlah tabel/layar, toast sukses
```

Dua hal yang disengaja di sini:

**Biaya ditulis sebelum kerja dimulai.** Kalau proses gagal di tengah, sudah ada baris
debit yang bisa direfund. Tidak ada jendela waktu di mana kerja berjalan tanpa catatan.

**Kegagalan yang bisa dicapai pengguna.** Prompt di bawah 12 karakter adalah kegagalan
nyata yang ditolak *setelah* debit ditulis, lalu direfund penuh. Ini membuat jalur refund
sesuatu yang benar-benar bisa dipicu dan diverifikasi, bukan klaim di teks pemasaran.

### Jalur revisi & terbit

- `runRevision` (`:231`) — biaya 5 koin, satu langkah 1600 ms. Catatan: revisi saat ini
  **tidak** punya jalur gagal/refund seperti generate.
- `runPublish` (`:272`) — biaya 50 koin, tiga langkah (database → Worker → Pages), lalu
  status proyek jadi `'live'` dan detail baris diisi `'Pages · D1 · Worker'`.

### Bentuk data hasil generate

`Project` → `Screen[]` → `UIBlock[]`. Blok adalah node JSON, **bukan markup**:

```ts
type BlockKind = 'navbar' | 'stat' | 'table' | 'form' | 'card' | 'chart'
interface UIBlock {
  id: string
  kind: BlockKind
  title?: string   // teks yang boleh diedit inspector
  body?: string    // baris copy, urut baca
  accent?: string  // aksen dari palet
}
```

`Preview.tsx` memetakan `kind` ke komponen lewat `ScreenView`, dengan `StatBlock`,
`TableBlock`, `NavBlock`, plus `GeneratingState` dan `FailedState`.

**Aturan non-negosiabel (dari `CLAUDE.md`):** LLM tidak pernah mengeluarkan HTML atau JS.
Ia mengembalikan JSON yang divalidasi Zod lalu dipetakan **hanya** ke komponen
whitelist. Komponen tak dikenal ditolak. Saat ini validasi Zod belum ada karena LLM belum
disambungkan — `SEED_PROJECTS` mengisi peran itu.

---

## 3. Komponen Impeccable Style

Bukan pustaka eksternal. "Impeccable Style" di repo ini adalah sistem desain internal
yang ditegakkan lewat token Tailwind dan aturan di `.claude/skills/impeccable/`.

### Token desain (`tailwind.config.js`)

**Warna** — semua semantik, tidak ada nama warna mentah di komponen:

| Grup | Token | Nilai | Dipakai untuk |
|------|-------|-------|---------------|
| Teks | `ink` | `#111827` | Judul, angka utama |
| | `ink-body` | `#374151` | Paragraf |
| | `ink-muted` | `#4B5563` | Sekunder |
| | `ink-meta` | `#6B7280` | Label, timestamp |
| Latar | `ground` | `#FFFFFF` | Kanvas |
| | `ground-panel` | `#FAFAFA` | Rail, inspector |
| | `ground-sunken` | `#F9FAFB` | Header tabel |
| Garis | `rule` / `rule-soft` / `rule-strong` | `#E5E7EB` / `#F3F4F6` / `#D1D5DB` | Hairline |
| Aksi | `action` / `action-hover` / `action-soft` | `#2563EB` / `#1D4ED8` / `#EFF6FF` | Satu warna aksi saja |
| Status | `ok` / `warn` / `danger` | `#047857` / `#B45309` / `#B91C1C` | Outcome ledger, toast |

**Skala teks** — 5 tingkat, semuanya disetel untuk UI padat:

| Token | Ukuran / line-height | Dipakai |
|-------|---------------------|---------|
| `micro` | 11.5 / 16 | Label uppercase, badge |
| `meta` | 12.5 / 18 | Keterangan, sel tabel |
| `body` | 13.5 / 20 | Teks utama, judul panel |
| `title` | 21 / 28, `-0.02em` | Judul halaman |
| `figure` | 22 / 26, `-0.02em` | Angka besar |

**Font** — `Inter` untuk UI, `JetBrains Mono` untuk semua angka dan ID. Kelas `.tnum`
(`font-variant-numeric: tabular-nums`) wajib pada kolom angka agar tidak bergoyang saat
nilai berubah.

### Konvensi yang ditegakkan

- **Satu warna aksi.** Hanya `action` (biru) yang menandakan tindakan. Status memakai
  keluarga `ok`/`warn`/`danger`, tidak pernah biru.
- **Tekan, bukan bersinar.** Kelas `.press` (`index.css:73`) memberi translasi 0,5px saat
  `:active` dengan easing 90 ms. Tidak ada glow atau scale.
- **Garis rambut, bukan bayangan.** Pemisahan memakai `border-rule`, bukan `box-shadow`.
- **Angka monospace + tabular.** Saldo, koin, dan waktu selalu `font-mono tnum`.
- **Permukaan browser ikut didesain.** `::selection`, `:focus-visible` (cincin 2px
  `#2563EB`, offset 2px), caret, dan scrollbar ditata di `index.css`.
- **Editor visual menyebut dirinya gratis.** `Inspector.tsx` menulis "gratis" di panelnya
  sendiri karena itu inti janjinya, bukan detail tersembunyi.

### Komponen UI

`ui/Button.tsx` mengekspor `ActionButton` (variant `primary`/`secondary`, size
`sm`/`md`, slot `icon`) dan `IconButton`. `ui/Icons.tsx` berisi ikon SVG inline tanpa
dependensi ikon eksternal. `ui/Toasts.tsx` merender `tone: 'ok' | 'warn' | 'danger'`.

---

## 4. Sistem Saldo Koin

### Prinsip

Saldo **diturunkan** dari ledger, tidak pernah disimpan sebagai angka yang bisa berubah
sendiri:

```ts
// useBuilder.ts:20
const STARTER_BALANCE_BASE = STARTER_BALANCE - SEED_LEDGER.reduce((s, e) => s + e.coins, 0)
// useBuilder.ts:35
const balanceOf = (ledger) => ledger.reduce((sum, e) => sum + e.coins, STARTER_BALANCE_BASE)
```

`STARTER_BALANCE_BASE` adalah saldo pembuka sebelum baris pertama, dihitung agar ledger
contoh rekonsiliasi tepat ke **128**. Untuk menambah riwayat contoh, basis ini menyesuaikan
sendiri — tidak ada angka yang perlu diedit tangan.

Ini menerjemahkan aturan produk: *ledger-based, jangan pernah kolom saldo yang bisa
melenceng*. Di backend nanti bentuknya transaksi atomik dengan update kondisional; di
front-end bentuknya `reduce` atas sumber kebenaran tunggal.

### Harga (`COIN_COST`, `lib/types.ts:1`)

```ts
generate: 20, revise: 5, manualEdit: 0, publish: 50
```

Harga dirujuk lewat konstanta ini di seluruh kode dan di `seed.ts` — tidak ada angka
hardcoded yang bisa menyimpang dari daftar harga.

### Bentuk baris ledger

```ts
interface LedgerEntry {
  id: string
  at: string          // "HH:MM" lokal id-ID
  label: string       // "Generate PRD & UI"
  detail: string      // "12 tabel · 8 layar" | "gagal — deskripsi terlalu pendek"
  coins: number       // negatif = keluar, positif = masuk/kembali
  outcome: 'spent' | 'free' | 'refunded' | 'failed'
  refId: string       // mengikat debit ke refund-nya (gen_0001, dep_51ee07)
}
```

`refId` adalah kunci rekonsiliasi. Debit dan refund untuk satu percobaan berbagi `refId`
yang sama, sehingga barisnya bisa dipasangkan. `LedgerView.tsx` memetakan `outcome` ke
warna dan label: `spent` → "terpakai", `free` → "gratis", `refunded` → "dikembalikan",
`failed` → "gagal".

### Invarian yang harus dijaga

1. Setiap `refunded` punya `spent`/`failed` berpasangan dengan `refId` sama, dan nominalnya
   sama besar.
2. `manualEdit` selalu 0 dan tidak pernah menulis baris ledger (lihat `updateBlock`,
   `useBuilder.ts:102` — hanya menyentuh `projects`, tidak menyentuh `ledger`).
3. Saldo tidak pernah negatif: setiap aksi memeriksa `balance() < cost` lebih dulu dan
   berhenti dengan toast sebelum menulis apa pun.
4. Kegagalan setelah debit meninggalkan jejak — tidak ada kegagalan senyap.

### Pembayaran (belum diimplementasi)

`topUp()` saat ini langsung menambah baris ledger dengan detail "QRIS terverifikasi".
Di produksi, koin hanya boleh masuk setelah **webhook Midtrans terverifikasi**, bukan
setelah halaman redirect. Ini tertulis di UI (`LedgerView.tsx`) dan harus dipertahankan.

---

## 5. Verifikasi

Harness Playwright di `apps/editor/.shots/`:

```bash
cd apps/editor
npm run dev                 # port 5180, strictPort
node .shots/verify.mjs      # overflow + error konsol di 1440/1280/1024px
node .shots/flow.mjs        # jalur inspector gratis, gagal+refund, publish
```

`flow.mjs` mencetak `BALANCE_AFTER_REFUND` — nilai yang harus tetap **128**. Screenshot
hasilnya (`*.png`) di-ignore git; skripnya (`*.mjs`) tetap dilacak.

### Batasan yang perlu diketahui

- **Tidak ada test unit.** Tidak ada Vitest/Jest. Verifikasi masih end-to-end lewat
  Playwright dan pembacaan screenshot.
- **Semua state hilang saat reload.** Tidak ada persistensi, tidak ada backend.
- **Tidak ada autentikasi** — ini prototipe antarmuka, bukan produk yang bisa diekspos.
- **`dist/` di-ignore git** dan dibangun ulang lewat `npm run build`.
