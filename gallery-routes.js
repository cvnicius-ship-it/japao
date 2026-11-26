const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function setupGallery(app, { authorized, redis }) {

  // Não alterar: mantém acesso às publicações antigas.
  const KEY = 'tropa-japao:gallery:v1';

  const categories = ['Eventos', 'Veículos', 'Roleplay'];
  const IMAGE_LIMIT = 8 * 1024 * 1024;
  const VIDEO_LIMIT = 100 * 1024 * 1024;

  const upload = multer({
    storage: multer.diskStorage({
      destination: os.tmpdir(),
      filename: (req, file, cb) => cb(null, 'japao-' + crypto.randomUUID())
    }),
    limits: {
      fileSize: VIDEO_LIMIT,
      files: 1
    },
    fileFilter(req, file, cb) {
      const allowed = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4'
      ];

      if (!allowed.includes(file.mimetype)) {
        return cb(new Error(
          'Formato inválido. Use JPG, PNG, WEBP ou MP4.'
        ));
      }

      cb(null, true);
    }
  }).fields([
    { name: 'photo', maxCount: 1 },
    { name: 'video', maxCount: 1 },
    { name: 'media', maxCount: 1 }
  ]);

  function cloud() {
    const {
      CLOUDINARY_CLOUD_NAME,
      CLOUDINARY_API_KEY,
      CLOUDINARY_API_SECRET
    } = process.env;

    if (
      !CLOUDINARY_CLOUD_NAME ||
      !CLOUDINARY_API_KEY ||
      !CLOUDINARY_API_SECRET
    ) {
      throw new Error(
        'Configure as variáveis CLOUDINARY no Render'
      );
    }

    return {
      cloudName: CLOUDINARY_CLOUD_NAME,
      key: CLOUDINARY_API_KEY,
      secret: CLOUDINARY_API_SECRET
    };
  }

  function youtubeId(input) {
    try {
      const url = new URL(String(input || '').trim());

      if (url.protocol !== 'https:') return null;

      const host = url.hostname.toLowerCase();
      let id = null;

      if (
        host === 'youtu.be' ||
        host === 'www.youtu.be'
      ) {
        id = url.pathname.split('/').filter(Boolean)[0];
      } else if ([
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com'
      ].includes(host)) {
        const parts = url.pathname.split('/').filter(Boolean);

        if (parts[0] === 'watch') {
          id = url.searchParams.get('v');
        }

        if (['shorts', 'embed', 'live'].includes(parts[0])) {
          id = parts[1];
        }
      }

      return /^[a-zA-Z0-9_-]{11}$/.test(id || '')
        ? id
        : null;
    } catch {
      return null;
    }
  }

  async function records() {
    const raw = await redis('HGETALL', KEY);
    const items = [];

    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i += 2) {
        try {
          items.push(JSON.parse(raw[i + 1]));
        } catch {}
      }
    } else if (raw && typeof raw === 'object') {
      for (const value of Object.values(raw)) {
        try {
          items.push(
            typeof value === 'string'
              ? JSON.parse(value)
              : value
          );
        } catch {}
      }
    }

    return items.sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  function validDetails(req, res) {
    const category = req.body?.category;
    const title = String(req.body?.title || '').trim();

    if (
      !categories.includes(category) ||
      title.length < 2 ||
      title.length > 80
    ) {
      res.status(400).json({
        error: 'Escolha uma categoria e um título de 2 a 80 caracteres'
      });
      return null;
    }

    return { category, title };
  }

  async function uploadCloudinary(file, resourceType) {
    const { cloudName, key, secret } = cloud();
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'tropa-do-japao/galeria';

    const signature = crypto.createHash('sha1')
      .update(
        `folder=${folder}&timestamp=${timestamp}${secret}`
      )
      .digest('hex');

    const chunkSize = 10 * 1024 * 1024;
    const chunked = resourceType === 'video' && file.size > chunkSize;
    const uploadId = crypto.randomUUID();
    const handle = await fs.promises.open(file.path, 'r');
    try {
      let result;
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        const length = Math.min(chunkSize, file.size - offset);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        if (bytesRead !== length) throw new Error('Leitura incompleta');
        const form = new FormData();
        form.append('file', new Blob([buffer], { type: file.mimetype }), file.originalname);
        form.append('api_key', key);
        form.append('timestamp', String(timestamp));
        form.append('folder', folder);
        form.append('signature', signature);
        const response = await fetch(
          `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`,
          { method: 'POST', body: form,
            headers: chunked ? { 'X-Unique-Upload-Id': uploadId,
              'Content-Range': `bytes ${offset}-${offset + length - 1}/${file.size}` } : {},
            signal: AbortSignal.timeout(120000) }
        );
        result = await response.json();
        if (!response.ok || result.error) throw new Error('Cloudinary upload: ' + JSON.stringify(result).slice(0, 300));
      }
      if (!result?.secure_url || !result?.public_id) throw new Error('Upload incompleto');
      return result;
    } finally {
      await handle.close();
    }
  }

  async function destroyCloudinary(publicId, resourceType) {
    const { cloudName, key, secret } = cloud();
    const timestamp = Math.floor(Date.now() / 1000);

    const signature = crypto.createHash('sha1')
      .update(
        `public_id=${publicId}&timestamp=${timestamp}${secret}`
      )
      .digest('hex');

    const form = new URLSearchParams({
      public_id: publicId,
      timestamp: String(timestamp),
      api_key: key,
      signature
    });

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/destroy`,
      {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(20000)
      }
    );

    const result = await response.json();

    if (
      !response.ok ||
      !['ok', 'not found'].includes(result.result)
    ) {
      throw new Error(
        'Cloudinary destroy: ' +
        JSON.stringify(result).slice(0, 300)
      );
    }
  }

  // LISTAR FOTOS E VÍDEOS
  app.get('/api/gallery', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');

      const category = req.query.category;

      if (category && !categories.includes(category)) {
        return res.status(400).json({
          error: 'Categoria inválida'
        });
      }

      const items = await records();

      res.json({
        items: category
          ? items.filter(x => x.category === category)
          : items
      });
    } catch (error) {
      console.error('Galeria listagem:', error.message);

      res.status(503).json({
        error: 'Galeria indisponível'
      });
    }
  });

  // ENVIAR FOTO OU VÍDEO MP4
  app.post(
    '/api/gallery',
    authorized,
    upload,
    async (req, res) => {
      try {
        const details = validDetails(req, res);
        if (!details) return;

        const file =
          req.files?.photo?.[0] ||
          req.files?.video?.[0] ||
          req.files?.media?.[0];

        const count = Object.values(req.files || {})
          .reduce((n, files) => n + files.length, 0);

        if (!file || count !== 1) {
          return res.status(400).json({
            error: 'Envie somente uma foto ou um vídeo MP4'
          });
        }

        const isVideo = file.mimetype === 'video/mp4';

        if (!isVideo && file.size > IMAGE_LIMIT) {
          return res.status(400).json({
            error: 'Foto deve ter no máximo 8 MB'
          });
        }

        const uploaded = await uploadCloudinary(
          file,
          isVideo ? 'video' : 'image'
        );

        const item = {
          id: crypto.randomUUID(),
          ...details,
          type: isVideo ? 'video' : 'image',
          url: uploaded.secure_url,
          publicId: uploaded.public_id,
          createdAt: Date.now()
        };

        try {
          await redis(
            'HSET',
            KEY,
            item.id,
            JSON.stringify(item)
          );
        } catch (error) {
          try {
            await destroyCloudinary(
              item.publicId,
              isVideo ? 'video' : 'image'
            );
          } catch (cleanup) {
            console.error(
              'Falha ao limpar arquivo:',
              cleanup.message
            );
          }

          throw error;
        }

        res.status(201).json({
          ok: true,
          item
        });
      } catch (error) {
        console.error('Galeria upload:', error.message);

        res.status(503).json({
          error: 'Não foi possível publicar o arquivo. Confira o limite do Cloudinary e tente novamente.'
        });
      } finally {
        for (const file of Object.values(req.files || {}).flat()) {
          if (file.path) await fs.promises.unlink(file.path).catch(() => {});
        }
      }
    }
  );

  // ADICIONAR VÍDEO DO YOUTUBE
  app.post(
    '/api/gallery/youtube',
    authorized,
    async (req, res) => {
      try {
        const details = validDetails(req, res);
        if (!details) return;

        const id = youtubeId(
          req.body?.youtubeUrl || req.body?.url
        );

        if (!id) {
          return res.status(400).json({
            error: 'Link do YouTube inválido'
          });
        }

        const item = {
          id: crypto.randomUUID(),
          ...details,
          type: 'youtube',
          youtubeId: id,
          url: `https://www.youtube.com/watch?v=${id}`,
          createdAt: Date.now()
        };

        await redis(
          'HSET',
          KEY,
          item.id,
          JSON.stringify(item)
        );

        res.status(201).json({
          ok: true,
          item
        });
      } catch (error) {
        console.error('Galeria YouTube:', error.message);

        res.status(503).json({
          error: 'Não foi possível publicar o link'
        });
      }
    }
  );

  // EXCLUIR FOTO OU VÍDEO
  app.delete(
    '/api/gallery/:id',
    authorized,
    async (req, res) => {
      try {
        const id = String(req.params.id);

        if (!/^[a-f0-9-]{36}$/.test(id)) {
          return res.status(400).json({
            error: 'ID inválido'
          });
        }

        const raw = await redis('HGET', KEY, id);

        if (!raw) {
          return res.status(404).json({
            error: 'Publicação não encontrada'
          });
        }

        const item = typeof raw === 'string'
          ? JSON.parse(raw)
          : raw;

        if (item.publicId) {
          await destroyCloudinary(
            item.publicId,
            item.type === 'video' ? 'video' : 'image'
          );
        }

        await redis('HDEL', KEY, id);

        res.json({ ok: true });
      } catch (error) {
        console.error('Galeria exclusão:', error.message);

        res.status(503).json({
          error: 'Não foi possível excluir'
        });
      }
    }
  );

  // TRATAMENTO DE ERROS DO UPLOAD
  app.use((err, req, res, next) => {
    if (
      req.path.startsWith('/api/gallery') &&
      (
        err instanceof multer.MulterError ||
        err.message?.startsWith('Formato inválido')
      )
    ) {
      return res.status(400).json({
        error: err.code === 'LIMIT_FILE_SIZE'
          ? 'Arquivo acima de 100 MB. Comprima o vídeo antes de enviar.'
          : err.message
      });
    }

    next(err);
  });
};