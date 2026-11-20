# TODO — Rakit.ai

Daftar tugas pengembangan berikutnya, diurutkan berdasarkan apa yang menghalangi langkah
selanjutnya. Setiap butir merujuk file nyata di repo ini.

**Legenda:** `[ ]` belum · `[~]` sebagian · `[x]` selesai
**Prioritas:** **P0** menghalangi · **P1** inti MVP · **P2** penting tapi bisa menyusul · **P3** pemolesan

> **Sudah tidak berlaku, jangan dihidupkan lagi:** sistem koin, ledger, saldo, Midtrans, dan
> top-up telah **dihapus dari produk**. Billing sepenuhnya ada di akun LLM-Kita; repo ini tidak
> menghitung atau menagih apa pun. Ini aturan non-negosiabel #2 di `CLAUDE.md`. Daftar ini
> sebelumnya masih memuat butir debit koin, refund, dan webhook Midtrans — semuanya dihapus
> pada 2026-11-18 karena menyesatkan.
>
> Backend **bukan Express** dan tidak pernah akan: orchestrator adalah Hono di Cloudflare
> Workers (`apps/orchestrator/`). Tidak ada `apps/api/`.

---

## P0 — Yang menghalangi

- [ ] **Autentikasi.** Belum ada sama sekali. `owner_id` di `repositories/projects.ts` masih
      placeholder, sehingga setiap pemanggil melihat data yang sama. Selama ini kosong,
      `/api/v1/projects` **terbuka untuk siapa pun** dan aplikasi tidak boleh dipublikasikan.
      Ini satu-satunya butir yang membuka blokir provisioning dan publish.
- [x] **Pasang `RAKIT_SHARED_TOKEN` di production.** Selesai 2026-11-20 dan diverifikasi
      end-to-end: `/projects` tanpa token **401**, dengan token **200**, token salah **401**,
      `/generate` tetap **503** `FEATURE_DISABLED`, `/health` terbuka. Secret berlaku seketika
      tanpa deploy ulang. Ingat: ini pengekangan, bukan autentikasi — token tetap tertanam
      dalam bundle browser lewat `VITE_*`.

## P1 — Inti MVP

- [ ] **Generator DDL.** `packages/generator/` belum ada. Skema proyek belum bisa
      diterjemahkan menjadi `CREATE TABLE`, sehingga publish tidak punya bahan untuk dijalankan.
- [ ] **Provisioning Cloudflare per proyek.** `runPublish` di `apps/editor/src/store/useBuilder.ts`
      masih `setTimeout` simulasi. Sambungkan ke API Cloudflare sungguhan: satu database D1 per
      proyek (aturan #4), jangan pernah menaruh data pengguna di `rakit-db`.
- [ ] **Aktifkan `FEATURE_GENERATE_ENABLED` setelah auth ada.** Saat ini `"false"` di
      `wrangler.toml` dengan sengaja. Membaliknya sebelum auth berarti siapa pun yang menemukan
      URL Worker dapat membelanjakan kuota LLM-Kita.

## P2 — Kualitas & keandalan

- [ ] **Rate limiting & kuota** per pengguna pada endpoint LLM. Belum ada sama sekali; ini
      pengaman biaya yang sebenarnya setelah auth.
- [ ] **Penanganan error yang bisa dipulihkan.** Kegagalan saat ini hanya menjadi pesan;
      belum ada tombol "Coba lagi" yang memakai ulang prompt terakhir.
- [ ] **Log biaya LLM.** Catat token per permintaan supaya pemakaian bisa dilihat terhadap
      tagihan LLM-Kita yang sebenarnya.
- [ ] **Konfirmasi hapus proyek masih `window.confirm`.** `Rail.tsx` memakai dialog bawaan
      browser karena itu penjaga termurah yang tidak bisa dilewati salah klik. Gantinya dialog
      milik aplikasi sendiri ketika sudah ada komponen modal — jangan sampai penghapusan yang
      tidak bisa dibatalkan bergantung pada dialog yang bisa diblokir browser.
- [ ] **Audit aksesibilitas.** `:focus-visible` sudah ditata, tetapi belum ada uji keyboard
      menyeluruh maupun uji pembaca layar pada `Pipeline`, `Inspector`, dan `Preview`.

## P3 — Pemolesan

- [ ] **Mode gelap.** Token warna sudah semantik dan terpusat, jadi ini pekerjaan mendefinisikan
      satu set nilai lagi — bukan refactor.
- [ ] **Pratinjau responsif.** `Preview.tsx` merender satu lebar; tambahkan mobile/tablet.
- [ ] **Ekspor & impor proyek** sebagai JSON.
- [ ] **Landing page & alur onboarding** untuk pengguna baru.
- [ ] **Halaman status publik** untuk insiden deploy.

---

## Utang teknis yang diketahui

Diverifikasi terhadap kode pada 2026-11-18; diperbarui 2026-11-20. Butir yang ternyata sudah
beres dihapus, bukan dibiarkan menggantung.

| Item | Lokasi | Dampak |
|------|--------|--------|
| Pesan tahap generasi memakai timer, bukan progres server | `useBuilder.ts` (`setTimeout`) | Progres yang ditampilkan tidak mencerminkan pekerjaan nyata |
| Tidak ada router — navigasi lewat state | `App.tsx` | Tidak ada URL yang bisa dibagikan; reload kehilangan konteks |
| `hasGenerated` di-set tapi tidak pernah dibaca | `useBuilder.ts:68,135,295,339` | Dead state; aman dihapus, bukan bug perilaku |
| `.shots/` berisi harness ad-hoc | `apps/editor/.shots/` | Skrip verifikasi tidak terdaftar di `package.json` |
| Dokumen Confluence hanya sinkron ke depan | `scripts/sync-confluence.mjs` | Suntingan langsung di Confluence hilang pada sync berikutnya; ubah markdown di repo |

## Cara memakai daftar ini

1. Kerjakan P0 dari atas. Auth membuka blokir P1; tanpa itu provisioning hanya membakar kuota.
2. Sebelum menyentuh kode fitur, baca `.amanah/atlas/*.md` dan blueprint terkait
   (`CLAUDE.md` mewajibkan ini). Atlas sudah diselaraskan dengan kode pada 2026-11-18, tetapi
kode tetap menang bila keduanya berbeda.
3. Jangan menambahkan butir yang memuat koin, ledger, saldo, atau Midtrans. Bila muncul
   dorongan ke sana, baca ulang aturan #2 di `CLAUDE.md` lebih dulu.
4. Jalankan `npm test` dan `npm run typecheck` sebelum commit. Jalur uang tidak lagi ada,
   jadi tidak ada invarian saldo yang perlu dijaga.
