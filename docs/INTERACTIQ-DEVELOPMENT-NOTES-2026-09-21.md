# InteractIQ — Nota Pembangunan Lengkap

Tarikh kemas kini terakhir: **21 September 2026**
Status dokumen: **Rekod pembangunan, rujukan ujian, dan panduan sebelum deployment**

## 1. Tujuan dokumen

Dokumen ini merekodkan kerja pembangunan InteractIQ dari asas projek sehingga penambahbaikan terakhir pada modul Presentation. Ia disediakan supaya pembangunan boleh disambung, diuji, diterbitkan, dan diselenggara tanpa perlu meneka semula keputusan teknikal yang telah dibuat.

Perkara penting tentang status semasa:

- Kod terkini berada pada komputer tempatan.
- Production Cloudflare Worker yang terakhir disahkan telah menggunakan migrasi sehingga `0021_live_session_controls.sql`.
- Migrasi `0022_presentation_download_permission.sql` dan `0023_presentation_live_zoom.sql` telah diuji pada D1 tempatan tetapi masih perlu digunakan pada D1 production.
- Frontend terkini masih perlu dibina dan diterbitkan semula ke GitHub Pages selepas Worker dan D1 production dikemas kini.
- Semakan terkini selepas modul password recovery: **64 automated tests lulus**, semua TypeScript checks lulus, frontend production build lulus, transaksi SQL baharu sah terhadap D1 tempatan, dan production dependency audit melaporkan 0 vulnerability. Worker dry-run semasa tidak dapat disahkan dalam sandbox Codex kerana sekatan akses native `esbuild`; ini bukan kegagalan TypeScript atau ujian aplikasi dan perlu diulang pada terminal pemilik sebelum deploy.

## 2. Gambaran keseluruhan sistem

InteractIQ ialah aplikasi pembelajaran interaktif berbilang tenant. Guru/admin membina dan menerbitkan resource, manakala pelajar membuka pautan share awam untuk menyertai aktiviti.

Komponen utama:

| Komponen | Teknologi | Tanggungjawab |
| --- | --- | --- |
| Frontend | React, TypeScript, Vite | Dashboard admin, editor resource, bilik pelajar, laporan, dan live classroom |
| API | Cloudflare Worker | Authentication, authorization, resource API, live state, upload, delete, report, dan student attempts |
| Database | Cloudflare D1 | Tenant, pengguna, resource, soalan, attempts, markah, live state, dan permission |
| File storage | Cloudflare R2 | Presentation, imej editor, dan fail submission assignment |
| AI | Cloudflare Workers AI | Pemarkahan awal respons terbuka |
| Hosting frontend | GitHub Pages | Laman admin dan pautan share pelajar |
| Shared contracts | TypeScript package | Bentuk request/response yang dikongsi frontend dan Worker |

Aliran asas:

```text
Admin/Pelajar
      │
      ▼
React + Vite di GitHub Pages
      │ HTTPS / API
      ▼
Cloudflare Worker
  ├── D1: data berstruktur dan live state
  ├── R2: fail yang dimuat naik
  └── Workers AI: bantuan pemarkahan
```

## 3. Struktur workspace

```text
interactiq-phase-1/
├── apps/
│   ├── web/                 # React/Vite frontend
│   └── worker/              # Cloudflare Worker, migrasi dan tests
├── packages/
│   └── contracts/           # Shared TypeScript API contracts
├── docs/                    # Nota teknikal dan deployment
├── DEPLOY-NEXT.md           # Arahan deployment release terdahulu
├── RELEASE-TEST-REPORT-2026-09-20.md
├── README.md
└── package.json             # Workspace scripts
```

Fail utama:

- `apps/web/src/App.tsx` — aliran UI utama, dashboard, Library, editor, live classroom, student room, dan reports.
- `apps/web/src/styles.css` — gaya keseluruhan frontend.
- `apps/worker/src/index.ts` — HTTP routes, upload/download R2, security boundary, dan penyambungan services.
- `apps/worker/src/resources/service.ts` — validation dan business rules resource.
- `apps/worker/src/resources/repository.ts` — query D1 untuk resource dan live state.
- `packages/contracts/src/index.ts` — interface yang dikongsi oleh web dan Worker.
- `apps/worker/migrations/` — sejarah perubahan schema D1.

## 4. Modul yang telah dibangunkan

### 4.1 Authentication dan session

- Admin login menggunakan tenant slug, username, dan password.
- Pelajar boleh menggunakan Google authentication.
- Session menggunakan token yang diuruskan oleh Worker dan cookie HttpOnly.
- CSRF token diwajibkan untuk operasi yang mengubah data.
- Session boleh diperbaharui untuk tab browser baharu hanya daripada origin yang dibenarkan.
- Logout membatalkan session dan membawa pengguna kembali ke halaman login.
- Browser Back menggunakan history aplikasi dan tidak sepatutnya memintas authentication.
- Session admin mempunyai tempoh lalai 8 jam melalui `SESSION_TTL_SECONDS=28800`.

### 4.2 Rate limiting

- Admin login mempunyai perlindungan brute force.
- Selepas lima percubaan gagal dalam tempoh 15 minit, request ditolak dengan HTTP `429`.
- Response mengandungi `Retry-After: 900`.
- Rekod rate limit disimpan dan diperiksa pada Worker/D1.

### 4.3 Role dan permission

Role yang disokong oleh schema:

- `SUPER_ADMIN`
- `TENANT_ADMIN`
- `TEACHER`
- `EDITOR`
- `STUDENT`

Operasi penting seperti edit, publish, report, upload dan delete diperiksa menggunakan permission pada Worker, bukan sekadar menyembunyikan butang di frontend.

### 4.4 Home dashboard

- Ringkasan resource dan prestasi kelas.
- Class drill-down untuk melihat pencapaian mengikut kelas.
- Eksport analitik kepada CSV, PNG dan PDF.
- Class boleh dipadam menggunakan tindakan delete yang disahkan.
- Delete class membersihkan assignment class yang berkaitan tanpa memadam resource secara tidak sengaja.

### 4.5 Library

Library memaparkan semua resource tenant dan menyediakan:

- Filter kelas.
- Filter jenis resource.
- Filter bulan penciptaan.
- Susunan newest-to-oldest atau oldest-to-newest.
- Edit.
- Duplicate.
- Publish settings atau Share/settings.
- Stop publish.
- Delete resource.

Jenis resource yang disokong:

- Quiz
- Assessment
- Flashcard set
- Presentation
- Passage
- Interactive video

Delete resource telah disambungkan kepada API sebenar supaya resource dan data berkaitan dipadam melalui foreign-key cascade dan cleanup media yang berkaitan.

### 4.6 Create resource

Resource baharu bermula sebagai `DRAFT`. Admin boleh menetapkan:

- Jenis resource.
- Tajuk.
- Penerangan.
- Kelas pilihan.
- Polisi attempt: multiple attempts atau sekali bagi setiap e-mel.

Admin menentukan sendiri bila resource diterbitkan.

### 4.7 Quiz dan assessment

- Editor soalan berstruktur menggunakan rich text.
- Pelbagai jenis soalan dan interaction disokong.
- Resource boleh diberikan kepada kelas tertentu.
- Access start time dan countdown pelajar disokong.
- Polisi attempt dan result release disimpan dalam D1.
- Pelajar menjawab, mengesahkan submission, dan melengkapkan identiti/nama kelas.
- Soalan terbuka menerima markah awal AI sebelum semakan guru.
- Guru boleh override markah dan feedback.
- Final review disimpan secara kekal.

### 4.8 Flashcards

- Front dan back menggunakan rich content.
- Imej boleh dimuat naik melalui editor.
- Kad boleh ditambah, dikemas kini dan dipadam.
- Pelajar boleh bergerak antara kad dan flip front/back.

### 4.9 Assignment dan submission

- Pelajar boleh menghantar fail assignment yang dibenarkan.
- Fail submission disimpan dalam R2.
- Metadata submission disimpan dalam D1.
- Fail assignment hanya boleh dibaca oleh pemilik atau guru/admin dalam tenant yang sama.
- Guru boleh menetapkan status review, markah dan feedback.

### 4.10 Marking & reports

Paparan laporan menyediakan:

- Jumlah submissions.
- Purata markah.
- Bilangan submission yang memerlukan review.
- Penggunaan R2 dan jumlah fail.
- Tab All, Completed dan Needs review.
- Carian nama pelajar/resource.
- Filter resource type, class dan tarikh.
- Eksport CSV, PNG dan PDF.
- Semakan jawapan dan pemberian markah manual.
- Tanda amaran nama berulang untuk semakan identiti.
- `Delete resource & data` untuk membuang resource dan submission berkaitan.

Eksport CSV telah dikeraskan supaya nilai yang kelihatan seperti formula atau tarikh tidak dieksekusi secara tidak sengaja oleh spreadsheet software.

### 4.11 Students

- Paparan prestasi pelajar dikumpulkan daripada report data.
- Statistik kelas dan ranking boleh diperiksa.
- Data yang dipaparkan mengikuti submission sebenar dan kelas pelajar.

### 4.12 Memory Control dan R2

Memory Control kini memberi fokus kepada fail sebenar dalam R2:

- Menyenaraikan presentation, imej dan fail assignment.
- Menunjukkan saiz, masa upload, storage key, kategori, dan jumlah reference.
- Menyokong carian dan filter jenis fail.
- Membezakan fail yang masih digunakan dengan fail unused.
- Delete memerlukan permission `resource.delete`, CSRF token, dan confirmation.
- Storage key mesti berada di bawah prefix tenant yang sedang login.
- Traversal seperti `..` ditolak.

Apabila fail dipadam melalui Memory Control:

1. Reference sepadan dalam `learning_resources.asset_url` dibersihkan.
2. Metadata fail submission dalam `attempts` dibersihkan.
3. Reference media dalam rich content resource, questions dan flashcards dibersihkan.
4. Object sebenar dipadam daripada R2.
5. Inventory dimuat semula.

Delete menggunakan perbandingan exact dan `instr()` untuk URL yang mempunyai query string. Ia tidak lagi menggunakan pola `LIKE` yang boleh gagal pada storage key panjang.

## 5. Presentation — fungsi akhir

Ini ialah modul yang menerima penambahbaikan paling banyak.

### 5.1 Upload dan preview

- Format upload: PowerPoint, PDF, Word dan Excel.
- Had saiz: 50 MB.
- File signature diperiksa; extension sahaja tidak dipercayai.
- Fail disimpan dalam prefix R2 tenant:

```text
tenants/{tenantId}/presentations/{uuid}.{extension}
```

- PDF boleh dipaparkan secara tempatan.
- PowerPoint/Word/Excel menggunakan Microsoft Office web viewer dan memerlukan URL Worker yang boleh dicapai secara awam. Microsoft tidak boleh mengambil fail daripada `localhost`.
- Nama asal fail disimpan dalam query parameter untuk paparan dan download.

### 5.2 Kawalan halaman

- Pelajar tidak mengawal page atau slide.
- Admin mengawal page menggunakan butang `Previous` dan `Next` yang disediakan oleh InteractIQ.
- `currentSlide` disimpan dalam live state D1.
- Halaman pelajar melakukan polling live state dan berpindah ke page yang sama.
- Panel thumbnail/pages di sebelah kiri PDF disembunyikan.
- Toolbar PDF di bahagian atas kekal untuk paparan admin.

### 5.3 Live zoom

- Kawalan live zoom admin berada di bahagian atas presentation: `−`, peratus, dan `+`.
- Julat zoom: 25% hingga 200%.
- Nilai asal: 100%.
- `currentZoom` disimpan dalam D1 dan dihantar kepada pelajar bersama live state.
- Pelajar tidak boleh mengubah zoom sendiri.
- Gunakan kawalan **live zoom InteractIQ** untuk penyelarasan. Zoom dalaman browser/PDF plugin tidak boleh dipercayai untuk menghasilkan event kepada aplikasi induk.
- PDF menerima nilai zoom melalui viewer URL; Office viewer menerima nilai zoom yang sama melalui embed URL.

### 5.4 Modes

Tiga mode disediakan:

- `Slides` — paparan presentation tanpa kanvas lukisan.
- `Annotate` — presentation dengan lapisan whiteboard.
- `Whiteboard` — kanvas penuh tanpa presentation.

### 5.5 Annotation dan drawing ownership

- Admin boleh melukis dalam Annotate dan Whiteboard.
- Admin memilih pelajar tertentu melalui Participants untuk memberi permission melukis.
- Tiada checkbox global `Allow students to draw` digunakan lagi.
- Pelajar yang dipilih menerima alert bahawa drawing telah dibenarkan.
- Stroke pelajar kekal selepas mouse/pointer dilepaskan dan disimpan dalam live state.
- Stroke menggunakan normalized coordinates supaya kedudukan konsisten pada saiz skrin berbeza.
- Admin boleh memadam stroke admin dan stroke pelajar.
- Pelajar hanya boleh memadam stroke miliknya sendiri.
- Pelajar tidak boleh memadam stroke admin atau stroke pelajar lain.
- Permission pelajar diperiksa di server melalui `live_drawing_permissions`.

### 5.6 Participants dan live session

- Senarai participant memaparkan online/offline state dan waktu terakhir dilihat.
- Admin boleh memberi atau menarik balik drawing permission bagi setiap participant.
- Admin boleh kick participant.
- Participant yang dikick perlu membuka semula link dan menyertai sesi sekali lagi.
- Apabila resource di-unpublish, participant tidak lagi boleh meneruskan sesi.
- Selepas publish semula, sesi live bermula dengan membership participant yang baharu.

### 5.7 Download permission

- Checkbox `Allow students to download` hanya wujud untuk Presentation.
- Nilai asal ialah untick/false.
- State disimpan dalam kolum D1 `allow_download`.
- Apabila untick, butang Download tidak dipaparkan kepada pelajar.
- Apabila admin tick, butang Download muncul di halaman pelajar.
- Endpoint media menghantar `Content-Disposition: attachment` apabila URL download digunakan.

### 5.8 Delete presentation

- Delete daripada editor Presentation memerlukan confirmation.
- Object presentation dipadam daripada R2.
- Reference `asset_url` resource dibersihkan.
- UI dikemas kini selepas operasi berjaya.

## 6. Interactive video

- URL video disimpan pada resource.
- Hanya URL HTTPS YouTube/YouTube No-Cookie yang sah diterima untuk iframe.
- Mode Slides, Annotate dan Whiteboard dikongsi dengan live classroom.
- Live questions, participants, drawing permission, kick dan session lifecycle mengikuti prinsip yang sama seperti Presentation.
- Beberapa video YouTube boleh memaparkan Error 153 jika konfigurasi/referrer video tersebut tidak membenarkan embedded playback. Ini ialah sekatan pemain/video YouTube, bukan kegagalan D1 atau R2.
- Download permission dan live presentation zoom tidak digunakan pada Interactive Video.

## 7. Publish dan student share flow

1. Admin mencipta resource sebagai draft.
2. Admin melengkapkan content dan publish settings.
3. Worker menjana share code lapan aksara.
4. Link pelajar menggunakan hash route supaya GitHub Pages boleh membuka route secara terus:

```text
https://interactiq-edu.github.io/smttjpka/#/join/AB12CD34
```

5. Public join endpoint memastikan resource masih `PUBLISHED`.
6. Pelajar login, memulakan attempt, dan menyertai aktiviti.
7. Unpublish menyebabkan public join tidak lagi tersedia.

Public join info mempunyai cache pendek 10 saat untuk membantu prestasi. Oleh itu, perubahan publish/unpublish mungkin mengambil beberapa saat untuk kelihatan pada request yang sudah dicache.

## 8. Delete behaviour mengikut lokasi

| Lokasi | Apa yang dipadam |
| --- | --- |
| Library → Delete | Resource dan data child yang mempunyai foreign-key cascade; media berkaitan turut dibersihkan mengikut cleanup resource |
| Marking & reports → Delete resource & data | Resource, attempts, answers, reviews, live state dan hubungan berkaitan |
| Presentation editor → Delete | Fail presentation dalam R2 dan reference presentation pada resource |
| Memory Control → Delete | Object R2 yang dipilih serta reference sepadan dalam D1/rich content |
| Home → Delete class | Assignment/nama kelas berkaitan; bukan pemadaman rawak semua resource |
| Flashcard editor → Delete | Kad yang dipilih sahaja |
| Question editor → Delete | Soalan yang dipilih dan jawapan berkaitan mengikut schema |

Semua delete material menggunakan confirmation pada UI. Operasi storage/delete sensitif memerlukan session, permission dan CSRF validation pada Worker.

## 9. Security yang telah diterapkan

- Tenant isolation pada query D1 dan prefix R2.
- RBAC/permission pada API.
- HttpOnly session cookie.
- CSRF validation untuk state-changing request.
- CORS hanya bagi origin yang diluluskan.
- Login rate limiting.
- PBKDF2-HMAC-SHA-256 untuk password admin.
- File size, MIME, extension dan signature validation.
- Assignment files tidak boleh dibaca secara anonymous.
- R2 delete menolak key tenant lain dan traversal text.
- CSP, `nosniff`, referrer policy dan permissions policy.
- Interactive video iframe dihadkan kepada YouTube HTTPS.
- CSV injection/date coercion protection.
- Rich text link protocols yang tidak selamat ditolak.
- Logout tidak membenarkan session lama memulihkan dashboard dalam tab yang sama.

Secrets tidak boleh dimasukkan ke Git:

- Jangan commit `.dev.vars`.
- Jangan commit password admin.
- Gunakan `wrangler secret put` untuk Worker secrets.
- `VITE_*` berada dalam browser bundle dan tidak boleh dianggap sebagai secret.

## 10. Sejarah migrasi D1

| Migrasi | Tujuan utama |
| --- | --- |
| `0001_tenant_identity.sql` | Tenant, users, admin users, sessions dan asas identity |
| `0002_auth_rate_limits.sql` | Rekod rate limiting authentication |
| `0003_rbac_permissions.sql` | Roles dan permissions |
| `0004_learning_resources.sql` | Learning resources dan jenis resource |
| `0005_questions.sql` | Questions dan option data |
| `0006_attempts.sql` | Attempts dan attempt answers |
| `0007_worker_pbkdf2_limit.sql` | Penyesuaian PBKDF2 kepada had Web Crypto Worker |
| `0008_question_type_gallery.sql` | Jenis soalan tambahan |
| `0009_publish_share_and_question_timing.sql` | Publish, share code dan timing |
| `0010_student_experience_reviews_themes.sql` | Student identity, reviews dan themes |
| `0011_media_flashcards_live_classroom.sql` | Asset URL, external URL, flashcards dan live state |
| `0012_rich_interactive_questions.sql` | Rich/interaktif question content |
| `0013_final_reviews.sql` | Final teacher review |
| `0014_resource_access_attempt_policies.sql` | Access window dan attempt policy |
| `0015_live_classroom_classes.sql` | Presentation modes, class assignment dan live display flags |
| `0016_result_release_policy.sql` | Polisi keluaran keputusan |
| `0017_assignment_submissions.sql` | Fail dan metadata assignment submission |
| `0018_assignment_review.sql` | Status, markah dan feedback assignment |
| `0019_live_classroom_defaults.sql` | Live controls default kepada off |
| `0020_participant_drawing_permissions.sql` | Drawing permission per participant |
| `0021_live_session_controls.sql` | Kick participant dan live participant index |
| `0022_presentation_download_permission.sql` | `allow_download`, default `0` |
| `0023_presentation_live_zoom.sql` | `current_zoom`, default `100` |

Jangan deploy Worker yang menggunakan kolum baharu sebelum migrasi D1 production selesai.

## 11. Local development

Dari root projek:

```powershell
npm install
npx wrangler d1 migrations apply DB --local --config apps/worker/wrangler.toml
npm run dev:worker
```

Buka terminal kedua:

```powershell
npm run dev:web
```

Frontend tempatan:

```text
http://localhost:5173
```

Worker tempatan lazimnya:

```text
http://127.0.0.1:8787
```

Vite mem-proxy request `/api` kepada Worker. Target boleh diubah menggunakan `VITE_API_PROXY_TARGET`.

## 12. Automated verification

Arahan standard:

```powershell
npm run typecheck
npm test
npm run build
```

Maksud setiap arahan:

- `typecheck` — menyemak TypeScript contracts, web dan Worker.
- `test` — menjalankan Vitest Worker/API tests.
- `build` — membina contracts dan frontend serta menjalankan `wrangler deploy --dry-run`.

Keputusan terakhir pada 21 September 2026:

- Test files: 8 lulus.
- Tests: 51 lulus, 0 gagal.
- TypeScript: lulus.
- Vite production build: lulus.
- Worker upload dry-run: lulus.
- D1 tempatan: migrasi sehingga `0023` berjaya.
- `allow_download` default: `0`.
- `current_zoom` default: `100`.

## 13. Production environment

Konfigurasi Worker utama berada dalam `apps/worker/wrangler.toml`:

- D1 binding: `DB`
- R2 binding: `MEDIA`
- AI binding: `AI`
- Worker name: `interactiq-api`
- Production API: `https://interactiq-api.apiz1335.workers.dev`
- Approved frontend origin: `https://interactiq-edu.github.io`

Frontend production memerlukan nilai berikut semasa build:

```text
VITE_API_BASE_URL=https://interactiq-api.apiz1335.workers.dev
VITE_GOOGLE_CLIENT_ID=<Google web client ID>
VITE_BASE_PATH=/smttjpka/
```

Google Cloud Authorized JavaScript origins mesti termasuk:

- `http://localhost:5173`
- `http://localhost:5174`
- `https://interactiq-edu.github.io`

## 14. Urutan deployment yang betul

Gunakan urutan ini kerana frontend dan Worker terkini bergantung kepada kolum D1 baharu:

### Langkah 1 — semakan sebelum production

```powershell
npm run typecheck
npm test
npm run build
```

### Langkah 2 — migrasi D1 production

```powershell
npx wrangler d1 migrations apply interactiq --remote --config apps/worker/wrangler.toml
```

Pastikan `0022` dan `0023` dipaparkan sebagai berjaya.

### Langkah 3 — deploy Worker

```powershell
npx wrangler deploy --config apps/worker/wrangler.toml
```

### Langkah 4 — build frontend production

```powershell
npm run build --workspace=@interactiq/web
```

### Langkah 5 — publish GitHub Pages

Terbitkan semua kandungan dalam:

```text
apps/web/dist/
```

Ini termasuk `index.html` dan keseluruhan folder `assets`. Jangan upload `index.html` sahaja kerana nama bundle mempunyai hash dan berubah pada setiap build.

## 15. Checklist manual sebelum push GitHub

- [ ] Admin login berjaya.
- [ ] Logout kembali ke login dan Back tidak membuka dashboard tanpa session.
- [ ] Library filter class/type/month/sort berfungsi.
- [ ] Edit Presentation dan Interactive Video boleh dibuka.
- [ ] Publish menghasilkan share link yang betul.
- [ ] Pelajar boleh membuka share link production.
- [ ] Unpublish menutup akses pelajar.
- [ ] PDF/PPT bergerak menggunakan Previous/Next admin.
- [ ] Panel thumbnail PDF tidak muncul.
- [ ] Live zoom admin diikuti oleh pelajar.
- [ ] Annotate admin muncul kepada pelajar.
- [ ] Pelajar terpilih menerima alert dan boleh melukis.
- [ ] Stroke pelajar muncul kepada admin dan kekal selepas pointer dilepaskan.
- [ ] Pelajar tidak boleh memadam stroke admin.
- [ ] Kick memutuskan participant dan memerlukan re-entry.
- [ ] Download tidak muncul secara default.
- [ ] Download muncul selepas admin menandakan checkbox.
- [ ] Delete Presentation membuang object R2.
- [ ] Delete Library berfungsi.
- [ ] Delete resource & data dalam Reports berfungsi.
- [ ] Delete Memory Control membuang R2 dan membersihkan reference.
- [ ] Upload presentation dan assignment baharu berfungsi.
- [ ] Reports, marking dan export masih berfungsi.
- [x] `npm test` dan frontend production build lulus selepas perubahan terakhir (64 ujian; 21 September 2026).

## 16. Perkara yang perlu diketahui semasa troubleshooting

### PowerPoint tidak boleh preview pada localhost

Microsoft Office viewer perlu mengambil fail melalui URL awam. Gunakan Worker production/staging yang boleh dicapai dari internet. PDF tidak mempunyai batasan ini untuk preview tempatan.

### YouTube Error 153

Semak sama ada video membenarkan embedding dan sama ada URL ialah YouTube HTTPS yang sah. Sesetengah video/channel menyekat embedded playback.

### Student mendapat “Activity unavailable” selepas publish

Semak:

1. Status resource benar-benar `PUBLISHED`.
2. Share code pada URL sama dengan D1.
3. Worker production sudah menggunakan schema/migrasi terkini.
4. Frontend menggunakan `VITE_API_BASE_URL` yang betul.
5. Origin GitHub Pages berada dalam `ALLOWED_ORIGIN`.
6. Tunggu sehingga cache public join 10 saat tamat jika resource baru sahaja diubah.

### Memory Control delete gagal

Semak session admin, CSRF token, permission `resource.delete`, R2 binding `MEDIA`, prefix tenant dan sama ada migrasi Worker terkini telah dideploy.

### Perubahan admin tidak muncul pada pelajar

Semak Worker/API request live state, status publish, participant session, polling browser pelajar dan sambungan network. Untuk zoom, gunakan kawalan live zoom InteractIQ, bukan zoom browser keseluruhan.

## 17. Prinsip penyelenggaraan

- Buat perubahan sekecil mungkin pada modul yang diminta.
- Jangan ubah fungsi yang telah lulus tanpa sebab berkaitan.
- Tambah migrasi baharu; jangan edit migrasi production lama yang telah digunakan.
- Kekalkan contracts, Worker dan frontend dalam sync.
- Jalankan typecheck, tests dan build selepas setiap perubahan schema/live state.
- Uji menggunakan dua browser/tab berasingan: satu admin dan satu pelajar.
- Jangan menganggap UI confirmation bermaksud delete berjaya; sahkan D1 dan R2.
- Deployment mesti mengikut urutan D1 → Worker → frontend.

## 18. Ringkasan status akhir

InteractIQ kini mempunyai aliran lengkap untuk penciptaan resource, publishing, student joining, live presentation/video, drawing permissions, reports, marking, class analytics, file storage dan pentadbiran R2.

Penambahan terakhir ialah:

1. Toolbar PDF admin dengan panel thumbnail disembunyikan.
2. Permission download Presentation, default off.
3. Live zoom Presentation daripada admin kepada pelajar.
4. Migrasi D1 `0022` dan `0023`.
5. Ujian regression Presentation meningkat kepada 51 dan semuanya lulus pada peringkat tersebut; selepas password recovery ditambah, keseluruhan suite meningkat kepada 64 dan semuanya lulus.

Selepas nota asal ini disediakan, sistem pemulihan kata laluan Admin telah ditambah melalui migrasi `0024_admin_password_recovery.sql`, dua endpoint Worker, penghantaran backend Resend, UI minimum Forgot/Reset Password, rate limiting, token hash sekali guna 15 minit, dan pembatalan sesi akaun terjejas. Penukaran credential, revokasi sesi, audit kejayaan, dan penggunaan token disatukan dalam satu transaksi D1 bersyarat. Rujuk `docs/ADMIN-PASSWORD-RECOVERY.md` untuk reka bentuk keselamatan, konfigurasi, ujian, deployment dan rollback. Sebelum release awam seterusnya, tindakan yang masih diperlukan ialah menjalankan migrasi production `0022`–`0024`, mengesahkan kedua-dua akaun Admin dalam remote D1, menetapkan Worker secrets pemulihan, menjalankan semula Worker dry-run di terminal pemilik, deploy Worker terkini, build frontend sekali lagi, kemudian push kandungan production ke GitHub Pages.
