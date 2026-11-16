# TODO — Rakit.ai

Daftar tugas pengembangan berikutnya, diurutkan berdasarkan apa yang menghalangi langkah
selanjutnya. Setiap butir merujuk file nyata di repo ini.

**Legenda:** `[ ]` belum · `[~]` sebagian · `[x]` selesai
**Prioritas:** **P0** menghalangi · **P1** inti MVP · **P2** penting tapi bisa menyusul · **P3** pemolesan

---

## P0 — Fondasi yang belum ada

Tanpa ini, aplikasi masih prototipe antarmuka dan tidak bisa dipakai sungguhan.

- [ ] **Backend Express.js + TypeScript.** Sesuai `CLAUDE.md`, belum ada satu baris pun.
      Buat `apps/api/` dengan health check, konfigurasi env, dan graceful shutdown.
- [ ] **Skema database & migrasi** untuk `users`, `projects`, `ledger_entries`, `payments`.
      Ledger harus append-only; tidak ada kolom `balance` yang bisa di-`UPDATE`.
- [ ] **Integrasi LLM-Kita dengan output JSON ketat.** Endpoint generate & revise,
      timeout eksplisit di setiap panggilan (aturan non-negosiabel #6).
- [ ] **Validasi Zod atas output LLM.** Tolak komponen di luar whitelist `BlockKind`
      (`src/lib/types.ts:34`). Ini aturan #1 dan saat ini belum ditegakkan karena LLM
      belum tersambung.
- [ ] **Ganti `SEED_LEDGER` / `SEED_PROJECTS` dengan data server.** Keduanya data demo
      sintetis; `seed.ts` menyatakan sendiri harus diganti sebelum ditunjukkan ke publik.
- [ ] **Autentikasi.** Belum ada sama sekali. Tanpa ini aplikasi tidak boleh diekspos.

## P1 — Inti MVP

- [ ] **Debit koin atomik di backend.** Pindahkan `runGeneration` (`store/useBuilder.ts:118`)
      ke transaksi dengan update kondisional `WHERE balance >= cost`, supaya dua tab tidak
      bisa membelanjakan koin yang sama.
- [ ] **Idempotensi per `refId`.** `refId` sudah ada di setiap baris; pakai sebagai kunci
      unik agar retry tidak menagih dua kali.
- [ ] **Timeout & refund untuk revisi.** `runRevision` (`:231`) saat ini tidak punya jalur
      gagal. Samakan dengan `runGeneration`: tulis debit, refund penuh bila timeout LLM.
      Baris contohnya sudah ada di `seed.ts` ("gagal — batas waktu LLM").
- [ ] **Webhook Midtrans.** Koin hanya masuk setelah webhook terverifikasi dan signature
      valid — bukan setelah redirect. Ganti `topUp()` (`:331`) yang sekarang menambah saldo
      langsung.
- [ ] **Provisioning Cloudflare D1 + Workers** per proyek. `runPublish` (`:272`) masih
      simulasi `setTimeout`; sambungkan ke API Cloudflare sungguhan. Satu database per
      proyek (aturan #4).
- [ ] **Persistensi state editor.** Saat ini reload menghapus semua pekerjaan. Simpan draft
      ke server, bukan hanya ke memori.

## P2 — Kualitas & keandalan

- [ ] **Test unit untuk logika koin.** `balanceOf`, `applyEntry`, dan seluruh invarian di
      `KNOWLEDGE_BASE.md` §4 belum punya test. Pakai Vitest; ini area yang paling mahal
      kalau salah.
- [ ] **Test integrasi alur gagal → refund.** Pastikan setiap `refunded` berpasangan dengan
      debit ber-`refId` sama dan nominal sama. Ini kelas bug yang sudah pernah muncul.
- [ ] **Penanganan error yang bisa dipulihkan.** Saat ini kegagalan hanya jadi toast.
      Tambahkan tombol "Coba lagi" yang memakai ulang prompt terakhir.
- [ ] **Rate limiting & kuota** per pengguna pada endpoint LLM.
- [ ] **Audit aksesibilitas.** `:focus-visible` sudah ditata, tapi belum ada uji keyboard
      menyeluruh maupun uji pembaca layar pada `Pipeline`, `Inspector`, dan `LedgerView`.
- [ ] **Pantau biaya LLM.** Log token per permintaan; harga 20/5/50 koin perlu divalidasi
      terhadap biaya nyata, bukan ditebak.

## P3 — Pemolesan

- [ ] **Mode gelap.** Token warna sudah semantik dan terpusat di `tailwind.config.js`,
      jadi ini pekerjaan mendefinisikan satu set nilai lagi — bukan refactor.
- [ ] **Pratinjau responsif.** `Preview.tsx` hanya merender satu lebar; tambahkan
      pratinjau mobile/tablet.
- [ ] **Ekspor & impor proyek** sebagai JSON.
- [ ] **Landing page & alur onboarding** untuk pengguna baru.
- [ ] **Halaman status publik** untuk insiden deploy.

---

## Utang teknis yang diketahui

Dicatat apa adanya supaya tidak hilang.

| Item | Lokasi | Dampak |
|------|--------|--------|
| Semua efek jaringan adalah `setTimeout` | `store/useBuilder.ts` | Tidak ada error nyata; durasi palsu |
| Tidak ada router — navigasi lewat state | `App.tsx:12` | Tidak ada URL yang bisa dibagikan; reload kehilangan konteks |
| `hasGenerated` diinisialisasi `true` | `useBuilder.ts:82` | State awal tidak mencerminkan alur pengguna baru |
| Tidak ada `.env.example` | — | Anggota tim baru tidak tahu variabel yang dibutuhkan |
| Skill/agent belum dipasang ke `.claude/` | `CLAUDE.md` § Setup status | Sumbernya ada di `.amanah/`, perlu disalin |
| `.shots/` berisi harness ad-hoc | `apps/editor/.shots/` | Skrip verifikasi tidak terdaftar di `package.json` |

## Cara memakai daftar ini

1. Kerjakan P0 dari atas; semuanya saling bergantung.
2. Sebelum menyentuh kode fitur, baca `.amanah/atlas/*.md` dan blueprint fitur terkait
   (`CLAUDE.md` mewajibkan ini).
3. Setiap perubahan pada jalur koin wajib disertai test yang membuktikan invarian di
   `KNOWLEDGE_BASE.md` §4 masih berlaku.
4. Jalankan `node .shots/verify.mjs` dan `node .shots/flow.mjs` sebelum commit;
   `BALANCE_AFTER_REFUND` harus tetap **128**.
