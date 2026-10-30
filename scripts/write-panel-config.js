'use strict';
var fs = require('fs');
var path = require('path');

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  var lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  lines.forEach(function (line) {
    line = line.trim();
    if (!line || line.charAt(0) === '#') return;
    var eq = line.indexOf('=');
    if (eq < 1) return;
    var k = line.slice(0, eq).trim();
    var v = line.slice(eq + 1).trim();
    if ((v.charAt(0) === '"' && v.slice(-1) === '"') || (v.charAt(0) === "'" && v.slice(-1) === "'")) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  });
}

loadDotEnv(path.join(__dirname, '..', '.env'));

var url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
var key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.SUPABASE_ANON_KEY || '';
var registerCode = process.env.MELDUS_REGISTER_CODE || 'iklim2026';
var content = '// Otomatik oluşturuldu (build/env)\nwindow.SUPABASE_URL = ' + JSON.stringify(url) + ';\nwindow.SUPABASE_ANON_KEY = ' + JSON.stringify(key) + ';\nwindow.MELDUS_REGISTER_CODE = ' + JSON.stringify(registerCode) + ';\n';

function writeConfig(filePath, label) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(label + ' yazıldı');
}

var outPanel = path.join(__dirname, '..', 'panel', 'config.js');
writeConfig(outPanel, 'panel/config.js');

var outMeldus = path.join(__dirname, '..', 'meldus', 'config.js');
if (url && key) {
  writeConfig(outMeldus, 'meldus/config.js');
} else if (fs.existsSync(outMeldus)) {
  var existing = fs.readFileSync(outMeldus, 'utf8');
  if (/SUPABASE_URL\s*=\s*['"]https?:\/\//.test(existing)) {
    console.log('meldus/config.js korundu (.env veya env boş; mevcut dosya silinmedi)');
  } else {
    writeConfig(outMeldus, 'meldus/config.js');
  }
} else {
  writeConfig(outMeldus, 'meldus/config.js');
}
