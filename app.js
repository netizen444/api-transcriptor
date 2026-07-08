const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ytdlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer({ dest: 'uploads/' });

// Duracion de cada fragmento de audio en segundos (20 min).
const CHUNK_SECONDS = 1200;

const OUTPUT_ROOT = path.join(__dirname, 'output');
fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

app.use('/files', express.static(OUTPUT_ROOT));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Servicio de extraccion de audio funcionando.');
});

// Convierte cualquier archivo de audio/video en outputDir/inputPath
// en fragmentos mp3 y responde con las URLs de descarga.
function cortarYResponder(inputPath, outputDir, jobId, req, res) {
  const audioPattern = path.join(outputDir, 'chunk_%03d.mp3');

  ffmpeg(inputPath)
    .noVideo()
    .audioChannels(1)
    .audioFrequency(16000)
    .audioBitrate('64k')
    .outputOptions([
      '-f segment',
      `-segment_time ${CHUNK_SECONDS}`,
      '-reset_timestamps 1'
    ])
    .output(audioPattern)
    .on('end', () => {
      fs.unlink(inputPath, () => {});
      const files = fs.readdirSync(outputDir).filter(f => f.startsWith('chunk_')).sort();
      if (files.length === 0) {
        return res.status(500).json({ error: 'No se genero ningun fragmento de audio.' });
      }
      const baseUrl = `${req.protocol}://${req.get('host')}/files/${jobId}`;
      const chunks = files.map((f) => `${baseUrl}/${f}`);
      res.json({ jobId, totalChunks: chunks.length, chunks });

      setTimeout(() => {
        fs.rm(outputDir, { recursive: true, force: true }, () => {});
      }, 60 * 60 * 1000);
    })
    .on('error', (err) => {
      console.error('Error de ffmpeg:', err.message);
      fs.unlink(inputPath, () => {});
      res.status(500).json({ error: err.message });
    })
    .run();
}

// --- Endpoint 1: archivo subido directamente (form-data) ---
app.post('/process', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibio ningun archivo en el campo "video".' });
  }
  const jobId = uuidv4();
  const outputDir = path.join(OUTPUT_ROOT, jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  cortarYResponder(req.file.path, outputDir, jobId, req, res);
});

// --- Endpoint 2: un link (YouTube, Google Drive compartido, o URL directa) ---
app.post('/process-url', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Falta el parametro "url" en el body.' });
  }

  const jobId = uuidv4();
  const outputDir = path.join(OUTPUT_ROOT, jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const downloadTemplate = path.join(outputDir, 'source.%(ext)s');

  try {
    const secretsCookiesPath = '/etc/secrets/cookies.txt';
    let cookiesOption = {};
    if (fs.existsSync(secretsCookiesPath)) {
      const workingCookiesPath = path.join(outputDir, 'cookies.txt');
      fs.copyFileSync(secretsCookiesPath, workingCookiesPath);
      cookiesOption = { cookies: workingCookiesPath };
      console.log('Usando cookies copiadas a', workingCookiesPath);
    } else {
      console.log('No se encontró /etc/secrets/cookies.txt, se intentará sin cookies.');
    }

    await ytdlp(url, {
      output: downloadTemplate,
      format: '18/bestaudio/best',
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 5,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:Mozilla/5.0'],
      ...cookiesOption
    });

    const files = fs.readdirSync(outputDir);
    const sourceFile = files.find((f) => f.startsWith('source'));
    if (!sourceFile) {
      throw new Error('No se pudo descargar el video/audio de ese enlace.');
    }
    const inputPath = path.join(outputDir, sourceFile);
    cortarYResponder(inputPath, outputDir, jobId, req, res);
  } catch (err) {
    console.error('Error descargando el enlace:', err.message);
    fs.rm(outputDir, { recursive: true, force: true }, () => {});
    res.status(500).json({
      error: 'No se pudo descargar ese enlace. Puede estar restringido, ser privado, o no ser compatible: ' + err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servicio corriendo en el puerto ${PORT}`);
});
