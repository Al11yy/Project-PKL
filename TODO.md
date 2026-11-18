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
- [ ] **Pasang `RAKIT_SHARED_TOKEN` di production.** Secret ini belum di-set pada Worker,
      jadi penjagaan token belum aktif di sana meski kodenya sudah siap:
      `npx wrangler secret put RAKIT_SHARED_TOKEN` dari `apps/orchestrator/`.
      `/generate` dan `/revise` sudah aman karena `FEATURE_GENERATE_ENABLED = "false"`,
      tetapi `/projects` masih dapat dibaca tanpa kredensial.

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

Diverifikasi terhadap kode pada 2026-11-18. Butir yang ternyata sudah beres dihapus, bukan
dibiarkan menggantung.

| Item | Lokasi | Dampak |
|------|--------|--------|
| Pesan tahap generasi memakai timer, bukan progres server | `useBuilder.ts` (`setTimeout`) | Progres yang ditampilkan tidak mencerminkan pekerjaan nyata |
| Tidak ada router — navigasi lewat state | `App.tsx` | Tidak ada URL yang bisa dibagikan; reload kehilangan konteks |
| `hasGenerated` di-set tapi tidak pernah dibaca | `useBuilder.ts:68,111,211,255` | Dead state; aman dihapus, bukan bug perilaku |
| `.shots/` berisi harness ad-hoc | `apps/editor/.shots/` | Skrip verifikasi tidak terdaftar di `package.json` |
| Atlas kedaluwarsa (2026-07-15) | `.amanah/atlas/` | Mempredasi orchestrator dan `packages/schema`; kode menang bila berbeda |
| URL remote masih menunjuk repo lama | `.git/config` | GitHub mengalihkan ke `Al11yy/Rakit.ai`; perbarui agar tidak bergantung redirect |

## Cara memakai daftar ini

1. Kerjakan P0 dari atas. Auth membuka blokir P1; tanpa itu provisioning hanya membakar kuota.
2. Sebelum menyentuh kode fitur, baca `.amanah/atlas/*.md` dan blueprint terkait
   (`CLAUDE.md` mewajibkan ini). Ingat atlas masih basi — verifikasi ke kode.
3. Jangan menambahkan butir yang memuat koin, ledger, saldo, atau Midtrans. Bila muncul
   dorongan ke sana, baca ulang aturan #2 di `CLAUDE.md` lebih dulu.
4. Jalankan `npm test` dan `npm run typecheck` sebelum commit. Jalur uang tidak lagi ada,
   jadi tidak ada invarian saldo yang perlu dijaga.
