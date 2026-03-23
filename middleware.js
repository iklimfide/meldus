export default function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // İzin verilen sayfalar - yönlendirme yapma
  if (path === '/' || path === '/index.html') return;
  if (path === '/marul-fidesi.html') return;
  if (path.startsWith('/urunler/kivircik-marul-fidesi')) return;
  if (path.startsWith('/urunler/yedikule-marul-fidesi')) return;
  if (path === '/meldus' || path.startsWith('/meldus/')) return;

  // Statik dosyalar - yönlendirme yapma
  if (path.startsWith('/resimler/')) return;
  if (path === '/output.css') return;
  if (path === '/sitemap.xml') return;
  if (path === '/robots.txt') return;
  if (/\.(css|js|png|jpg|jpeg|webp|ico|xml|txt|svg|woff2?)$/i.test(path)) return;

  // Diğer tüm linkler ana sayfaya yönlensin
  return Response.redirect(new URL('/', request.url), 301);
}
