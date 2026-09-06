# Crude Transfer Web SCADA — Schneider Modicon M221

SCADA web lokal untuk proyek `OIL_GAS_CRUDE_TRANSFER_COMPLEX_TM221CE24R_OPENABLE.smbp`. Dashboard memantau transfer crude, permissive/ESD, analyser sequence, tiga jalur routing, alarm, tren, dan daftar alamat Modbus.

## Cara paling cepat — mode DEMO

1. Pastikan Node.js 20 atau lebih baru tersedia.
2. Klik `Jalankan_SCADA_DEMO.cmd`.
3. Buka `http://127.0.0.1:3210`.
4. Klik **CONTROL SESSION**, lalu masukkan token yang tercetak di terminal.
5. Tekan **START**. Aliran, route, batch counter, level, flow, pressure, dan BS&W akan bergerak.

Mode ini diberi label **DEMO ENGINE** secara jelas. Tidak ada koneksi PLC dan tidak boleh dipakai sebagai data operasi.

## Monitor Schneider M221 — read only

1. Buka project PLC di EcoStruxure Machine Expert - Basic.
2. Analyze/Compile, jalankan simulator atau sambungkan PLC, lalu ubah controller ke **RUN**.
3. Pastikan Modbus TCP tersedia pada IP yang benar, port `502`, Unit ID `1`.
4. Untuk simulator lokal, klik `Jalankan_SCADA_MONITOR.cmd`.
5. Buka `http://127.0.0.1:3200`.

Jika PLC menggunakan alamat lain, jalankan dari PowerShell:

```powershell
$env:SCADA_PLC_HOST = '192.168.1.10'
npm start
```

Mode live tidak memiliki fallback data palsu. Kegagalan koneksi selalu menghasilkan status `PLC OFFLINE / NO DATA`.

## Kontrol Schneider M221

1. Buktikan pembacaan live bekerja dalam mode monitor-only.
2. Hentikan server monitor.
3. Klik `Jalankan_SCADA_CONTROL_SCHNEIDER.cmd`.
4. Masukkan token terminal melalui tombol **CONTROL SESSION**.

Write hanya mengizinkan coil berikut:

| Fungsi | PLC | Offset Modbus | Jenis |
|---|---:|---:|---|
| Auto mode | `%M0` | `0` | Toggle |
| Start transfer | `%M1` | `1` | Pulse |
| Normal stop | `%M2` | `2` | Hold |
| Auto enable | `%M3` | `3` | Toggle |
| Reset batch counters | `%M40` | `40` | Pulse |

Tidak ada endpoint untuk menulis alamat arbitrer. Setiap write memakai FC05, readback, token sesi acak, same-origin check, rate limit, batas payload, dan audit JSONL.

## Data yang ditampilkan

- `%M10…%M15`: run, permissive, demand, slop HH, dan ESD latch.
- `%M20…%M25`: route Sales/Reprocess/Slop dan status sequence.
- `%M26…%M30`, `%M33`: valve fail, pump proof fail, common alarm, dan equipment alarm.
- Flow, pressure, BS&W, level, serta batch counter memiliki nilai aktif pada mode DEMO.
- Pada mode Modbus live, nilai analog dan counter tampil `N/A` sampai PLC memetakan data tersebut ke register yang disepakati. Dashboard tidak mengarang nilai.

## Keamanan operasi

- Server hanya bind ke loopback `127.0.0.1`.
- Mode default adalah monitor-only.
- Port web dan Modbus `502` jangan diekspos langsung ke internet.
- STOP web adalah perintah operasi normal, bukan emergency stop.
- ESD hanya dimonitor; reset ESD tetap dilakukan di panel lokal setelah area aman.
- Untuk akses dari jaringan, gunakan engineering workstation, firewall allowlist, VPN, dan reverse proxy TLS yang dikelola OT/IT.

## Verifikasi source

```powershell
npm run check
npm test
```

Tidak ada package eksternal yang perlu diunduh; server memakai modul bawaan Node.js.
