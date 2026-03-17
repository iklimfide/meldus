'use strict';
var fs = require('fs');
var path = require('path');
var url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
var key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.SUPABASE_ANON_KEY || '';
var out = path.join(__dirname, '..', 'panel', 'config.js');
var content = '// Otomatik oluşturuldu (build/env)\nwindow.SUPABASE_URL = ' + JSON.stringify(url) + ';\nwindow.SUPABASE_ANON_KEY = ' + JSON.stringify(key) + ';\n';
fs.writeFileSync(out, content, 'utf8');
console.log('panel/config.js yazıldı');
