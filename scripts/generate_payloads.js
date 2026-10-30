/**
 * Generator payload konteks untuk stress test.
 * Ukuran: short (1k, 2k, 4k, 16k) dan long (32k, 64k). Maksimum 64k.
 *
 * Jalankan: node scripts/generate_payloads.js
 *
 * Estimasi token memakai rasio ~3.8 karakter/token (teks campuran Indonesia/Inggris).
 * Untuk konteks 64k (batas maksimum), ruang untuk output (MAX_TOKENS) disisihkan dari total
 * agar prompt + completion tidak melebihi batas 64k.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

const CHARS_PER_TOKEN = 3.8;
const MAX_TOKENS = 1024; // harus sama dengan default CONFIG.MAX_TOKENS
const SIZES = { '1k': 1024, '2k': 2048, '4k': 4096, '16k': 16384, '32k': 32768, '64k': 65536 };

const SYSTEM =
  'Kamu adalah arsitek sistem AI dan akselerator hardware. Berikan analisis teknis komparatif yang mendalam, terstruktur, dan presisi.';

const USER_TURNS = [
  'Jelaskan perbedaan karakteristik komputasi antara GPU workstation 48GB GDDR6 dan server DGX berbasis HBM untuk inferensi model Mixture-of-Experts.',
  'Bagaimana KV-cache tumbuh terhadap panjang konteks dan jumlah request konkuren pada vLLM?',
  'Apa dampak prefix caching dan chunked prefill terhadap Time-To-First-Token pada konteks panjang?',
  'Jelaskan trade-off antara tensor parallelism dan expert parallelism untuk model A3B.',
  'Bagaimana strategi batching kontinu mempengaruhi throughput per stream saat beban naik?',
];

const ASSISTANT_TURNS = [
  'Memori HBM memiliki bandwidth jauh lebih tinggi dibanding GDDR6, sehingga fase decode yang bersifat memory-bound berjalan lebih cepat. Kapasitas memori yang lebih besar juga memungkinkan KV-cache menampung lebih banyak request konkuren tanpa preemption. Pada GPU 48GB, bobot model mengambil sebagian besar VRAM sehingga sisa ruang untuk KV-cache terbatas dan batch efektif menyusut ketika konteks memanjang. Akibatnya antrean request bertambah dan latensi tail meningkat tajam saat konkurensi tinggi.',
  'Ukuran KV-cache bertambah linear terhadap jumlah token dan jumlah layer attention. Untuk konteks panjang, satu request saja dapat memakai beberapa gigabyte. Dengan banyak request konkuren, scheduler vLLM harus melakukan preemption atau menolak request ketika blok KV habis, yang tampak sebagai error 5xx, 429, atau timeout pada klien.',
  'Prefill pada konteks panjang bersifat compute-bound dan dapat memblokir decode request lain. Chunked prefill memecah prefill menjadi potongan kecil agar decode tetap berjalan, namun TTFT request panjang tetap naik. Prefix caching membantu hanya jika prefix identik, sehingga pengujian beban perlu menyisipkan tag unik agar prefill benar-benar dihitung.',
  'Tensor parallelism membagi setiap layer lintas GPU dan menambah komunikasi all-reduce, sedangkan expert parallelism menempatkan expert berbeda pada GPU berbeda sehingga lebih efisien untuk model dengan banyak expert tetapi parameter aktif kecil. Pilihan terbaik bergantung pada interkoneksi dan pola routing token.',
  'Continuous batching memasukkan request baru ke batch yang sedang berjalan sehingga utilisasi GPU tinggi. Namun ketika jumlah request aktif melebihi kapasitas, TPS per stream turun karena bandwidth memori dibagi ke lebih banyak sekuens, dan request baru menunggu di antrean waiting.',
];

function buildMessages(targetTokens) {
  const reserve = targetTokens >= 65536 ? MAX_TOKENS + 512 : 0;
  const targetChars = Math.floor((targetTokens - reserve) * CHARS_PER_TOKEN);

  const messages = [{ role: 'system', content: SYSTEM }];
  let chars = SYSTEM.length;
  let i = 0;
  while (true) {
    const u = `[Turn ${i + 1}] ${USER_TURNS[i % USER_TURNS.length]}`;
    const a = `[Turn ${i + 1}] ${ASSISTANT_TURNS[i % ASSISTANT_TURNS.length]}`;
    if (chars + u.length + a.length > targetChars) break;
    messages.push({ role: 'user', content: u }, { role: 'assistant', content: a });
    chars += u.length + a.length;
    i++;
  }
  // Pesan terakhir wajib dari user agar model menghasilkan jawaban
  messages.push({
    role: 'user',
    content: 'Berdasarkan seluruh diskusi di atas, buat ringkasan teknis dan rekomendasi kapasitas yang terstruktur.',
  });
  return messages;
}

fs.mkdirSync(dataDir, { recursive: true });
for (const [label, tokens] of Object.entries(SIZES)) {
  const messages = buildMessages(tokens);
  const file = path.join(dataDir, `context_${label}.json`);
  const payload = {
    description: `Context payload ${label} (~${tokens} tokens nominal, multi-turn)`,
    messages,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  const estChars = messages.reduce((s, m) => s + m.content.length, 0);
  console.log(`[OK] ${path.basename(file)}: ${messages.length} pesan, ~${Math.round(estChars / CHARS_PER_TOKEN)} token (estimasi)`);
}
