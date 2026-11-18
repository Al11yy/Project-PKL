# Product Requirements Document (PRD)

> ## ⚠️ Status Implementasi — baca sebelum mengutip dokumen ini
>
> **Dokumen ini adalah visi produk dan rencana model bisnis. Ia BUKAN deskripsi kode yang
> ada sekarang.**
>
> Untuk fase MVP saat ini, **integrasi payment gateway dan billing belum diimplementasikan
> dan sengaja ditunda** — fokusnya adalah membuat fungsionalitas inti berjalan lebih dulu.
> Konsekuensi yang harus dipatuhi saat membangun:
>
> | Bagian PRD | Status MVP |
> |---|---|
> | Sistem Saldo Koin, top-up QRIS/VA, Midtrans, pemotongan per panggilan | **Ditunda** — tidak ada kode, tidak ada tabel, tidak ada endpoint. Kuota dan biaya sepenuhnya ditanggung akun LLM-Kita. |
> | Backend "Express.js atau NestJS" | **Diganti.** Backend adalah **Hono di Cloudflare Workers** (`apps/orchestrator/`). Tidak ada dan tidak akan ada `apps/api/`. |
> | Autentikasi pengguna | **Belum ada.** `owner_id` masih placeholder, jadi API belum aman diekspos publik. |
> | Provisioning D1/Workers otomatis, publish | **Belum ada.** Publish masih simulasi; `packages/generator/` belum ada. |
>
> Arahan arsitektur yang mengikat ada di `CLAUDE.md`; keadaan kode yang sebenarnya ada di
> `KNOWLEDGE_BASE.md`. Bila keduanya berbeda dengan dokumen ini, **keduanya yang menang.**
>
> Billing tetap bagian dari visi produk dan akan dikerjakan pada fase berikutnya. Saat itu
> terjadi, bagian §3 dan §5 di bawah adalah rujukannya — bukan dihapus.

**Project Name:** [Nama Platform/Codename] – AI-First App Builder for Indonesia  
**Document Status:** Draft v1.0  
**Tech Stack:** Node.js, React, Tailwind CSS (Impeccable Style), Cloudflare (Pages, Workers, D1), API LLM-Kita  
**Monetization Strategy:** Usage-Based Pricing (Koin Prabayar) — *belum diimplementasikan; lihat banner di atas*  

---

## 1. Executive Summary
Platform *low-code/no-code* berbasis kecerdasan buatan (AI) yang dirancang khusus untuk memenuhi kebutuhan pasar Indonesia. Sistem ini menghilangkan kurva belajar *drag-and-drop* tradisional dengan memanfaatkan *pipeline* "PRD-to-UI". Pengguna cukup mendeskripsikan kebutuhan aplikasi, dan AI akan merancang skema *database* serta menyusun antarmuka aplikasi secara otomatis. Platform ini mengunggulkan kecepatan latensi lokal (Cloudflare Edge), desain yang konsisten (Impeccable Style), dan model penetapan harga prabayar (*pay-as-you-go*) yang ramah untuk UMKM dan *freelancer* lokal.

## 2. Target Personas
| Persona | Latar Belakang | Titik Nyeri (*Pain Points*) | Nilai Jual (*Value Proposition*) |
| :--- | :--- | :--- | :--- |
| **Tech-Savvy UMKM** | Pemilik bisnis (toko, klinik) yang butuh digitalisasi. | Biaya langganan bulanan platform luar negeri (USD) terlalu mahal. | Sistem koin/saldo prabayar (Rupiah via QRIS); tidak ada biaya bulanan tetap. |
| **Siswa SMK / Mahasiswa IT** | Pelajar yang sedang mengerjakan tugas akhir atau proyek *freelance*. | Sering mengalami *blank canvas paralysis* saat memulai desain dari nol. | *Prompt-to-UI* yang langsung menghasilkan aplikasi *full-stack* siap *deploy*. |
| **Freelancer Web Lokal** | *Developer* yang menerima banyak pesanan aplikasi sederhana. | Waktu habis untuk *styling* CSS dan *setup server* atau *database*. | Komponen standar Impeccable Style yang langsung rapi; *auto-provisioning* ke Cloudflare. |

## 3. User Journey: The "PRD-to-App" Pipeline
1. **Initiation:** Pengguna mengetik ide aplikasi (*prompt* mentah).
2. **PRD & Schema Generation:** *Node.js Orchestrator* mengirimkan *prompt* ke API LLM-Kita untuk menghasilkan struktur PRD sederhana dan *schema database* berformat JSON.
3. **UI Rendering:** Frontend (React) membaca *output* JSON dan memetakan struktur tersebut ke komponen-komponen statis dari *library* Impeccable Style.
4. **Iterative Refinement:** Pengguna mengedit hasil *generate* AI menggunakan *fallback visual editor* (mengganti teks, gambar, atau warna dasar) tanpa harus menggunakan kuota AI.
5. **Instant Deployment:** Pengguna menekan tombol "Publish", dan sistem mengkompilasi kode untuk di-*deploy* langsung ke Cloudflare Pages (Frontend) dan Cloudflare D1/Workers (Backend).

## 4. Core Features & Functional Requirements

### A. Generative UI Engine (Frontend)
* **Strict Component Library:** Rangkaian komponen UI (Navbar, Hero, Data Table, Form, Card) yang dibangun menggunakan React dan Tailwind CSS, merujuk ketat pada panduan desain Impeccable Style.
* **JSON-to-Component Mapper:** Logika yang bertugas menerjemahkan *output* JSON dari AI menjadi susunan komponen React yang valid.
* **Visual Fallback Editor:** Antarmuka *click-to-edit* ringan untuk penyesuaian teks, warna (*brand color*), dan pengaturan *margin* tanpa perlu *prompt* tambahan.

### B. AI Orchestrator (Backend Node.js)
* **Context Manager:** Menyimpan riwayat percakapan dan struktur *database* sementara (sesi aktif) agar revisi UI dari pengguna tetap sinkron dengan skema yang sudah dibuat.
* **Prompt Engineering System:** Instruksi sistem khusus yang memaksa model LLM-Kita untuk hanya menggunakan daftar komponen Impeccable Style yang diizinkan dan menghasilkan JSON valid tanpa *hallucination* tag HTML eksternal.

### C. Infrastruktur Edge & Database (Cloudflare Ecosystem)
* **D1 Auto-Provisioning:** Saat *user* menyetujui skema, Node.js mengeksekusi *script* DDL untuk membuat tabel secara otomatis di Cloudflare D1 untuk proyek tersebut.
* **Serverless Backend:** Node.js men-*generate endpoint* REST API standar (CRUD) yang dibungkus dan di-*deploy* sebagai Cloudflare Workers.

### D. Billing & Ekosistem Lokal
* **Sistem Saldo Koin:** Dompet digital internal di mana pengguna harus mengisi saldo (via Midtrans QRIS/Virtual Account) sebelum menggunakan fitur AI *generator* atau saat mempublikasikan aplikasi.
* **Micro-Transactions:** Pemotongan koin terjadi pada dua *trigger* utama: setiap kali Node.js melakukan *request* (API call) ke LLM-Kita, dan setiap kali *database* D1 milik pengguna melampaui batas *free-tier*.

## 5. Technical Architecture
* **Frontend Editor:** React.js, Tailwind CSS, Zustand (untuk *state management drag-and-drop* dan pemetaan JSON).
* **Backend Core:** Express.js atau NestJS (untuk *user auth*, manajemen saldo, dan *orchestrator* API LLM-Kita).
* **AI Engine:** API LLM-Kita (dioptimalkan untuk *strict JSON output*).
* **Hosting & DB Pengguna:** Cloudflare Pages (untuk *hosting* statis hasil *build* pengguna), Cloudflare D1 (Serverless SQLite), Cloudflare Workers.

## 6. MVP Development Milestones

**Fase 1: Setup Foundation & UI Constraints**
* Membangun *repository* komponen React standar berdasarkan Impeccable Style.
* Membuat server Node.js dasar untuk autentikasi *user*.

**Fase 2: AI Orchestration (Core Value)**
* Menghubungkan Node.js dengan API LLM-Kita.
* Menulis dan menguji *system prompt* agar AI bisa secara konsisten menghasilkan *output* JSON yang *mapping*-nya cocok dengan komponen di Fase 1.

**Fase 3: Cloudflare Integration & Visual Editor**
* Menyambungkan fungsi pembuatan tabel dinamis ke Cloudflare D1.
* Membangun *fallback editor* agar *user* bisa mengedit teks tanpa AI.

**Fase 4: Monetization (Billing)**
* Integrasi Midtrans untuk sistem *top-up* koin.
* Pembatasan akses jika koin nol.