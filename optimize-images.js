/**
 * Resim optimizasyon scripti - Lighthouse önerilerine göre
 * Boyut küçültme + responsive srcset versiyonları
 */
const fs = require('fs');
const path = require('path');

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.log('sharp yükleniyor...');
    await require('child_process').execSync('npm install sharp', { stdio: 'inherit', cwd: __dirname });
    sharp = require('sharp');
  }

  const dir = path.join(__dirname, 'resimler');
  const webpOpt = { quality: 80, effort: 6 }; // Daha iyi sıkıştırma

  // Hero (LCP): 1200px max, sıkıştır
  if (fs.existsSync(path.join(dir, 'hero.webp'))) {
    const tmp = path.join(dir, 'hero-tmp.webp');
    await sharp(path.join(dir, 'hero.webp'))
      .resize(1200, null, { withoutEnlargement: true })
      .webp(webpOpt)
      .toFile(tmp);
    fs.renameSync(tmp, path.join(dir, 'hero.webp'));
    console.log('hero.webp optimize edildi');
  }

  // Ürün kartları: 400w, 800w srcset + orijinal sıkıştır (modal için)
  for (const name of ['kivircik', 'yedikule', 'iceberg']) {
    const src = path.join(dir, name + '.webp');
    if (!fs.existsSync(src)) continue;
    const buf = fs.readFileSync(src);
    await sharp(buf).resize(800, null, { withoutEnlargement: true }).webp(webpOpt).toFile(path.join(dir, name + '-800.webp'));
    await sharp(buf).resize(400, null, { withoutEnlargement: true }).webp(webpOpt).toFile(path.join(dir, name + '-400.webp'));
    const tmp = path.join(dir, name + '-tmp.webp');
    await sharp(buf).webp(webpOpt).toFile(tmp);
    fs.renameSync(tmp, src);
    console.log(name + '.webp optimize edildi + 400w, 800w');
  }

  // Galeri: 400w yeterli
  for (let i = 1; i <= 4; i++) {
    const src = path.join(dir, `galeri${i}.webp`);
    if (!fs.existsSync(src)) continue;
    const tmp = path.join(dir, `galeri${i}-tmp.webp`);
    await sharp(src).resize(400, null, { withoutEnlargement: true }).webp(webpOpt).toFile(tmp);
    fs.renameSync(tmp, src);
    console.log(`galeri${i}.webp optimize edildi`);
  }

  // Logo: 100px WebP (49px görüntüleniyor, 2x için 100)
  if (fs.existsSync(path.join(dir, 'logo.png'))) {
    await sharp(path.join(dir, 'logo.png'))
      .resize(100, 100, { fit: 'contain' })
      .webp({ quality: 90 })
      .toFile(path.join(dir, 'logo.webp'));
    console.log('logo.webp oluşturuldu');
  }

  console.log('Tamamlandı.');
}

main().catch(e => { console.error(e); process.exit(1); });
