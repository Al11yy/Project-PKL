import type { Project } from './types'

/**
 * Synthetic demonstration data. It exists so every state in the surface is
 * reachable and legible; it is not a real customer, and no figure here is a
 * product claim. Replace with real material before any public showing.
 */
export const SEED_PROJECTS: Project[] = [
  {
    id: 'p-klinik',
    name: 'Kasir Klinik Sehat',
    slug: 'kasir-klinik-sehat',
    prompt:
      'Saya butuh sistem kasir untuk klinik: catat pasien, layanan, obat, dan pembayaran. Ada laporan harian.',
    status: 'live',
    tablesCount: 12,
    screensCount: 8,
    updatedAt: '2 menit lalu',
    tables: [
      {
        name: 'pasien',
        rows: 348,
        columns: [
          { name: 'id', type: 'INTEGER', primary: true },
          { name: 'nama', type: 'TEXT' },
          { name: 'no_rekam_medis', type: 'TEXT', note: 'unik' },
          { name: 'telepon', type: 'TEXT', nullable: true },
          { name: 'dibuat_pada', type: 'TEXT' },
        ],
      },
      {
        name: 'layanan',
        rows: 24,
        columns: [
          { name: 'id', type: 'INTEGER', primary: true },
          { name: 'nama', type: 'TEXT' },
          { name: 'tarif', type: 'REAL' },
        ],
      },
      {
        name: 'obat',
        rows: 86,
        columns: [
          { name: 'id', type: 'INTEGER', primary: true },
          { name: 'nama', type: 'TEXT' },
          { name: 'satuan', type: 'TEXT' },
          { name: 'stok', type: 'INTEGER' },
          { name: 'harga', type: 'REAL' },
        ],
      },
      {
        name: 'transaksi',
        rows: 1520,
        columns: [
          { name: 'id', type: 'INTEGER', primary: true },
          { name: 'pasien_id', type: 'INTEGER', note: '→ pasien.id' },
          { name: 'layanan_id', type: 'INTEGER', note: '→ layanan.id' },
          { name: 'total', type: 'REAL' },
          { name: 'status', type: 'TEXT' },
          { name: 'dibuat_pada', type: 'TEXT' },
        ],
      },
    ],
    screens: [
      {
        id: 's-kasir',
        name: 'Kasir',
        blocks: [
          {
            id: 'b-nav',
            kind: 'navbar',
            title: 'Klinik Sehat',
            body: 'Kasir · Pasien · Obat · Laporan',
          },
          { id: 'b-s1', kind: 'stat', title: 'Transaksi hari ini', body: '47' },
          { id: 'b-s2', kind: 'stat', title: 'Pendapatan', body: '3,24jt' },
          { id: 'b-s3', kind: 'stat', title: 'Pasien baru', body: '12' },
          { id: 'b-s4', kind: 'stat', title: 'Stok menipis', body: '6', accent: 'warn' },
          {
            id: 'b-t1',
            kind: 'table',
            title: 'Transaksi terakhir',
            body: 'pasien · layanan · tanggal · status',
          },
        ],
      },
      {
        id: 's-pasien',
        name: 'Pasien',
        blocks: [
          { id: 'b-pnav', kind: 'navbar', title: 'Klinik Sehat', body: 'Kasir · Pasien · Obat · Laporan' },
          { id: 'b-p1', kind: 'table', title: 'Daftar pasien', body: 'nama · rekam medis · telepon · kunjungan' },
        ],
      },
      {
        id: 's-obat',
        name: 'Obat',
        blocks: [
          { id: 'b-onav', kind: 'navbar', title: 'Klinik Sehat', body: 'Kasir · Pasien · Obat · Laporan' },
          { id: 'b-o1', kind: 'table', title: 'Stok obat', body: 'nama · satuan · stok · harga' },
        ],
      },
    ],
  },
  {
    id: 'p-bangunan',
    name: 'Toko Bangunan Jaya',
    slug: 'toko-bangunan-jaya',
    prompt: 'Toko bangunan: catat stok semen, besi, cat. Kasir dan nota.',
    status: 'draft',
    tablesCount: 7,
    screensCount: 5,
    updatedAt: 'kemarin',
    tables: [],
    screens: [],
  },
  {
    id: 'p-absensi',
    name: 'Absensi Pondok',
    slug: 'absensi-pondok',
    prompt: 'Absensi santri pondok: catat kehadiran harian dan rekap bulanan.',
    status: 'draft',
    tablesCount: 4,
    screensCount: 3,
    updatedAt: '3 hari lalu',
    tables: [],
    screens: [],
  },
  {
    id: 'p-laundry',
    name: 'Laundry Kilat',
    slug: 'laundry-kilat',
    prompt: 'Laundry: terima cucian, hitung kilo, lacak status cucian.',
    status: 'draft',
    tablesCount: 3,
    screensCount: 2,
    updatedAt: '1 minggu lalu',
    tables: [],
    screens: [],
  },
]
