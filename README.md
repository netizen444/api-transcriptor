# video-audio-service

Recibe un video, extrae su audio (mono, 16kHz, 64kbps) y lo parte en
fragmentos de 20 minutos, listos para transcribir con Groq/Whisper.

## Desplegar en Render (gratis)

1. Sube esta carpeta a un repositorio de GitHub (puede ser privado).
2. Entra a https://render.com y crea una cuenta (gratis, con GitHub).
3. New + → Web Service → conecta tu repositorio.
4. Configuración:
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `node app.js`
   - Instance Type: Free
5. Deploy. Cuando termine, Render te da una URL tipo
   `https://video-audio-service-xxxx.onrender.com`
6. Prueba que funciona entrando a esa URL en el navegador — debe
   responder "Servicio de extracción de audio funcionando."

## Uso

POST a `/process` con un campo `video` (multipart/form-data) que
contenga el archivo. Responde:

```json
{
  "jobId": "...",
  "totalChunks": 3,
  "chunks": [
    "https://tu-servicio.onrender.com/files/<jobId>/chunk_000.mp3",
    "https://tu-servicio.onrender.com/files/<jobId>/chunk_001.mp3",
    "https://tu-servicio.onrender.com/files/<jobId>/chunk_002.mp3"
  ]
}
```

Cada URL queda disponible por 1 hora antes de borrarse automáticamente.

## Nota sobre el tier gratuito de Render

El servicio "duerme" tras ~15 min de inactividad. La primera solicitud
después de dormir tarda 30-60 seg extra en responder (arranque en frío).
No afecta la calidad del audio, solo el tiempo de espera inicial.
