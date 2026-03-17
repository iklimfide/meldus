# Panel (Meldus) – Çalıştırma

## 404 alıyorsanız (config.js / app.js bulunamadı)

1. **Dosyayı doğrudan açmayın** (file://...). Tarayıcı güvenliği script’leri engeller.
2. **Sunucuyu proje kökünden başlatın** (panel’in bir üst klasörü):
   ```bash
   cd d:\iklimfide.com
   npx serve . -l 3000
   ```
3. Tarayıcıda açın: **http://localhost:3000/meldus/**
4. Yerelde `panel/config.js` olmalı (yoksa `config.example.js`’i kopyalayıp `config.js` yapın ve Supabase anahtarlarını girin).

## Vercel’de (canlı sitede) panel

- Vercel projesinde **Environment Variables** ekleyin:  
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- **Build Command** olarak: `npm run build` kullanın (bu komut `panel/config.js` dosyasını oluşturur).
- Deploy sonrası panel: **https://siteniz.vercel.app/meldus/**
