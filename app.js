const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer({ dest: 'uploads/' });

// Duración de cada fragmento de audio en segundos.
// 1200 s = 20 min. A 64kbps mono, un fragmento pesa ~9-10MB,
// bien por debajo del límite de 25MB del tier gratuito de Groq.
const CHUNK_SECONDS = 1200;

const OUTPUT_ROOT = path.join(__dirname, 'output');
fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

// Sirve los fragmentos generados como archivos descargables
app.use('/files', express.static(OUTPUT_ROOT));

app.get('/', (req, res) => {
  res.send('Servicio de extracción de audio funcionando.');
});

app.post('/process', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo en el campo "video".' });
  }

  const jobId = uuidv4();
  const outputDir = path.join(OUTPUT_ROOT, jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  const inputPath = req.file.path;
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
      // borrar el video original, ya no se necesita
      fs.unlink(inputPath, () => {});

      const files = fs.readdirSync(outputDir).sort();
      if (files.length === 0) {
        return res.status(500).json({ error: 'No se generó ningún fragmento de audio.' });
      }

      const baseUrl = `${req.protocol}://${req.get('host')}/files/${jobId}`;
      const chunks = files.map((f) => `${baseUrl}/${f}`);

      res.json({ jobId, totalChunks: chunks.length, chunks });

      // limpieza automática después de 1 hora para no llenar el disco
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
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servicio corriendo en el puerto ${PORT}`);
});
