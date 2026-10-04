const http = require('http');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

process.env.PORT = '3009';
require('./server.js');

setTimeout(async () => {
  try {
    console.log('--- 1. PROBANDO EXPORTACIÓN DE BACKUP ZIP ---');
    const zipPath = path.join(__dirname, 'test_backup.zip');
    const fileStream = fs.createWriteStream(zipPath);

    await new Promise((resolve, reject) => {
      http.get('http://localhost:3009/api/backup/export', (res) => {
        console.log('STATUS EXPORT:', res.statusCode);
        console.log('CONTENT-TYPE:', res.headers['content-type']);
        console.log('CONTENT-DISPOSITION:', res.headers['content-disposition']);
        res.pipe(fileStream);
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
      }).on('error', reject);
    });

    console.log('ZIP descargado. Tamaño:', fs.statSync(zipPath).size, 'bytes');

    console.log('--- 2. VERIFICANDO CONTENIDO DEL ZIP ---');
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().map(e => e.entryName);
    console.log('ARCHIVOS EN ZIP:', entries);

    const hasDb = entries.includes('inventario.sqlite');
    const hasInfo = entries.includes('backup_info.json');
    console.log('¿Contiene inventario.sqlite?:', hasDb);
    console.log('¿Contiene backup_info.json?:', hasInfo);

    if (!hasDb || !hasInfo) {
      throw new Error('El archivo ZIP no contiene los archivos requeridos.');
    }

    const infoContent = JSON.parse(zip.readAsText('backup_info.json'));
    console.log('METADATOS DEL BACKUP:', infoContent);

    console.log('--- 3. PROBANDO RESTAURACIÓN DE BACKUP ZIP ---');
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const zipBuffer = fs.readFileSync(zipPath);

    const payloadHeader = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="backup_zip"; filename="test_backup.zip"\r\n` +
      `Content-Type: application/zip\r\n\r\n`
    );
    const payloadFooter = Buffer.from(`\r\n--${boundary}--\r\n`);
    const fullBody = Buffer.concat([payloadHeader, zipBuffer, payloadFooter]);

    const restoreReq = http.request({
      hostname: 'localhost',
      port: 3009,
      path: '/api/backup/restore',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBody.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('STATUS RESTORE:', res.statusCode);
        const json = JSON.parse(data);
        console.log('RESPUESTA RESTORE:', json);

        // Limpiar archivo temporal
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

        console.log('\n✅ PRUEBA COMPLETADA EXITOSAMENTE');
        process.exit(0);
      });
    });

    restoreReq.write(fullBody);
    restoreReq.end();
  } catch (err) {
    console.error('❌ ERROR EN PRUEBA:', err);
    process.exit(1);
  }
}, 800);
