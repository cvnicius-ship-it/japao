const crypto = require('crypto');
const multer = require('multer');

module.exports = function setupGallery(app, { authorized, redis }) {
  const KEY = 'tropa-japao:gallery:v1';
  const categories = ['Eventos', 'Veículos', 'Roleplay'];
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter(req, file, cb) {
      cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
    }
  });

  const cloud = () => {
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      throw new Error('Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET');
    }
    return { cloudName: CLOUDINARY_CLOUD_NAME, key: CLOUDINARY_API_KEY, secret: CLOUDINARY_API_SECRET };
  };

  async function records() {
    const raw = await redis('HGETALL', KEY);
    const items = [];
    for (let i = 0; i < (raw || []).length; i += 2) {
      try { items.push(JSON.parse(raw[i + 1])); } catch { /* registro invalido */ }
    }
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  app.get('/api/gallery', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const category = req.query.category;
      if (category && !categories.includes(category)) return res.status(400).json({ error: 'Categoria invalida' });
      const items = await records();
      res.json({ items: category ? items.filter(x => x.category === category) : items });
    } catch (e) {
      console.error('Galeria listagem:', e.message);
      res.status(503).json({ error: 'Galeria indisponivel' });
    }
  });

  app.post('/api/gallery', authorized, upload.single('photo'), async (req, res) => {
    try {
      const category = req.body.category;
      const title = String(req.body.title || '').trim();
      if (!categories.includes(category) || title.length < 2 || title.length > 80) {
        return res.status(400).json({ error: 'Categoria ou titulo invalido' });
      }
      if (!req.file) return res.status(400).json({ error: 'Envie JPG, PNG ou WEBP de ate 8 MB' });
      const { cloudName, key, secret } = cloud();
      const timestamp = Math.floor(Date.now() / 1000);
      const folder = 'tropa-do-japao/galeria';
      const signature = crypto.createHash('sha1')
        .update(`folder=${folder}&timestamp=${timestamp}${secret}`)
        .digest('hex');
      const form = new FormData();
      form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
      form.append('api_key', key);
      form.append('timestamp', String(timestamp));
      form.append('folder', folder);
      form.append('signature', signature);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
        method: 'POST', body: form, signal: AbortSignal.timeout(30000)
      });
      const uploaded = await response.json();
      if (!response.ok || !uploaded.secure_url || !uploaded.public_id) {
        throw new Error('Cloudinary: ' + JSON.stringify(uploaded).slice(0, 300));
      }
      const item = {
        id: crypto.randomUUID(), title, category,
        url: uploaded.secure_url, publicId: uploaded.public_id,
        createdAt: Date.now()
      };
      try {
        await redis('HSET', KEY, item.id, JSON.stringify(item));
      } catch (dbError) {
        console.error('Imagem enviada mas nao registrada:', uploaded.public_id, dbError.message);
        throw dbError;
      }
      res.status(201).json({ ok: true, item });
    } catch (e) {
      console.error('Galeria upload:', e.message);
      res.status(503).json({ error: 'Nao foi possivel publicar a foto' });
    }
  });

  app.delete('/api/gallery/:id', authorized, async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!/^[a-f0-9-]{36}$/.test(id)) return res.status(400).json({ error: 'ID invalido' });
      const raw = await redis('HGET', KEY, id);
      if (!raw) return res.status(404).json({ error: 'Foto nao encontrada' });
      const item = JSON.parse(raw);
      const { cloudName, key, secret } = cloud();
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto.createHash('sha1')
        .update(`public_id=${item.publicId}&timestamp=${timestamp}${secret}`)
        .digest('hex');
      const form = new URLSearchParams({ public_id: item.publicId, timestamp: String(timestamp), api_key: key, signature });
      const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`, {
        method: 'POST', body: form, signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      if (!response.ok || !['ok', 'not found'].includes(result.result)) {
        throw new Error('Falha Cloudinary: ' + JSON.stringify(result));
      }
      await redis('HDEL', KEY, id);
      res.json({ ok: true });
    } catch (e) {
      console.error('Galeria exclusao:', e.message);
      res.status(503).json({ error: 'Nao foi possivel excluir' });
    }
  });

  app.use((err, req, res, next) => {
    if (req.path.startsWith('/api/gallery') && err instanceof multer.MulterError) {
      return res.status(400).json({ error: 'Imagem muito grande (maximo 8 MB)' });
    }
    next(err);
  });
};
