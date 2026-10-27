(() => {
  const $ = id => document.getElementById(id);
  const gallery = $('gallery');

  let items = [];
  let busy = false;

  const say = t => {
    if ($('status')) $('status').textContent = t;
  };

  const fx = () => $('effect')?.value || 'blur';
  const strength = () => +($('strength')?.value || 12);
  const watermarkSize = () => +($('watermarkSize')?.value || 28);

  function controls() {
    if ($('autoAll')) $('autoAll').disabled = busy || !items.length;
    if ($('zipAll')) $('zipAll').disabled = busy || !items.length;
    if ($('clearAll')) $('clearAll').disabled = busy || !items.length;
  }

  // OCR Worker
  async function makeWorker() {
  if (!window.Tesseract) {
    throw new Error('Không tải được Tesseract.js. Kiểm tra index.html và Internet.');
  }

return await Tesseract.createWorker('eng', 1, {
    workerPath: 'tesseract-assets/worker.min.js',
    corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0/',
    langPath:   'https://tessdata.projectnaptha.com/4.0.0',
    workerBlobURL: true,
    logger: m => {
      if (m.status) {
        say('OCR: ' + m.status +
          (m.progress != null ? ' ' + Math.round(m.progress * 100) + '%' : ''));
      }
    },
    errorHandler: err => console.error('Tesseract Worker:', err)
});
  }

  // Vẽ watermark lặp khắp ảnh, nghiêng chéo
  function drawWatermark(ctx, canvasW, canvasH, text) {
    if (!text) return;

    const size = watermarkSize();

    ctx.save();
    ctx.font = `600 ${size}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const angle = -25 * Math.PI / 180;
    const stepX = size * 8;
    const stepY = size * 4;

    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.rotate(angle);

    const diag = Math.sqrt(canvasW * canvasW + canvasH * canvasH);

    for (let y = -diag; y < diag; y += stepY) {
      for (let x = -diag; x < diag; x += stepX) {
        ctx.fillText(text, x, y);
      }
    }

    ctx.restore();
  }

  // Tạo ảnh đã che
  function output(it) {
    const c = document.createElement('canvas');
    c.width = it.img.naturalWidth;
    c.height = it.img.naturalHeight;

    const ctx = c.getContext('2d');
    ctx.drawImage(it.img, 0, 0);

    for (const r of it.regions) {
      const x = Math.max(0, Math.round(r.x));
      const y = Math.max(0, Math.round(r.y));
      const w = Math.min(c.width - x, Math.round(r.w));
      const h = Math.min(c.height - y, Math.round(r.h));

      if (w < 1 || h < 1) continue;

      if (r.effect === 'black') {
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, w, h);
      } else if (r.effect === 'pixel') {
        const n = Math.max(4, r.strength);
        const small = document.createElement('canvas');

        small.width = Math.max(1, Math.ceil(w / n));
        small.height = Math.max(1, Math.ceil(h / n));

        small.getContext('2d').drawImage(
          c, x, y, w, h,
          0, 0, small.width, small.height
        );

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          small, 0, 0, small.width, small.height,
          x, y, w, h
        );
        ctx.imageSmoothingEnabled = true;
      } else if (r.effect === 'text') {
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, w, h);

        const label = r.text || $('coverText')?.value.trim() || '';
        if (label) {
          let fontSize = Math.max(10, Math.min(h * 0.6, 60));
          ctx.font = `600 ${fontSize}px sans-serif`;

          while (ctx.measureText(label).width > w - 10 && fontSize > 8) {
            fontSize -= 2;
            ctx.font = `600 ${fontSize}px sans-serif`;
          }

          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, x + w / 2, y + h / 2);
        }
        ctx.restore();
      } else {
        const pad = Math.max(8, r.strength * 2);
        const left = Math.max(0, x - pad);
        const top = Math.max(0, y - pad);
        const right = Math.min(c.width, x + w + pad);
        const bottom = Math.min(c.height, y + h + pad);

        const patch = document.createElement('canvas');
        patch.width = right - left;
        patch.height = bottom - top;

        const pctx = patch.getContext('2d');
        pctx.filter = `blur(${Math.max(2, r.strength)}px)`;
        pctx.drawImage(
          c,
          left, top, patch.width, patch.height,
          0, 0, patch.width, patch.height
        );

        ctx.drawImage(patch, left, top);
      }
    }

    drawWatermark(ctx, c.width, c.height, $('watermarkText')?.value.trim());

    return c;
  }

  function redraw(it) {
    it.output = output(it);
    it.ctx.clearRect(0, 0, it.canvas.width, it.canvas.height);
    it.ctx.drawImage(it.output, 0, 0);
  }

  // Thẻ ảnh
  function card(it) {
    it.el = document.createElement('section');
    it.el.className = 'card';

    it.canvas = document.createElement('canvas');
    it.canvas.width = it.img.naturalWidth;
    it.canvas.height = it.img.naturalHeight;
    it.ctx = it.canvas.getContext('2d');

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = it.file.name;

    it.note = document.createElement('div');
    it.note.className = 'small';
    it.note.textContent = 'Đã tải ảnh, chưa xử lý';

    const actions = document.createElement('div');
    actions.className = 'actions';

    const auto = document.createElement('button');
    auto.textContent = 'Tự tìm dòng';
    auto.onclick = () => one(it);

    const manual = document.createElement('button');
    manual.textContent = 'Chọn vùng';
    manual.onclick = () => selectRegion(it);

    const save = document.createElement('button');
    save.textContent = 'Tải ảnh';
    save.onclick = () => download(it);

    actions.append(auto, manual, save);
    it.el.append(it.canvas, name, it.note, actions);
    gallery.append(it.el);

    redraw(it);
  }

  // Đọc ảnh chắc chắn trước khi đưa vào gallery
  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();

    try {
      img.src = url;
      await img.decode();

      if (!img.naturalWidth || !img.naturalHeight) {
        throw new Error('Kích thước ảnh không hợp lệ');
      }

      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Chọn và tải ảnh — hỗ trợ trình duyệt điện thoại
  $('files').addEventListener('change', async e => {
    const files = Array.from(e.target.files || [])
      .filter(file => file.type.startsWith('image/'));

    if (!files.length) {
      say('Không có ảnh hợp lệ. Hãy chọn JPG, PNG hoặc WEBP.');
      return;
    }

    let loaded = 0;
    let failed = 0;

    say(`Đang tải ảnh: 0/${files.length}`);

    for (const file of files) {
      try {
        const img = await loadImage(file);
        const it = { file, img, regions: [] };

        items.push(it);
        card(it);
        loaded++;
        controls();

        say(`Đã tải ${loaded}/${files.length} ảnh.`);
      } catch (err) {
        failed++;
        console.error('Lỗi đọc ảnh:', file.name, err);
        say(`Không đọc được "${file.name}": ${err.message || err}`);
      }
    }

    if (loaded > 0) {
      say(`Đã tải ${loaded}/${files.length} ảnh` +
        (failed ? `; lỗi ${failed} ảnh.` : '.'));
    } else {
      say('Không tải được ảnh. Hãy thử ảnh JPG hoặc PNG khác.');
    }

    controls();
    // Cho phép chọn lại cùng file
    e.target.value = '';
  });

  // Tìm chữ Trading with và che dải ngang
  async function one(it, worker) {
    let own = false;

    try {
      it.note.textContent = 'Đang nhận diện...';

      if (!worker) {
        worker = await makeWorker();
        own = true;
      }

      const result = await worker.recognize(it.file);
      const words = (result.data.words || [])
        .filter(w => w.text && w.confidence > 15);

      let hit = null;

      for (let i = 0; i < words.length && !hit; i++) {
        const first = words[i];

        if (first.text.toLowerCase().replace(/[^a-z]/g, '') !== 'trading') {
          continue;
        }

        for (let j = i + 1; j < Math.min(i + 6, words.length); j++) {
          const second = words[j];

          if (second.text.toLowerCase().replace(/[^a-z]/g, '') !== 'with') {
            continue;
          }

          const a = first.bbox;
          const b = second.bbox;
          const centerA = (a.y0 + a.y1) / 2;
          const centerB = (b.y0 + b.y1) / 2;
          const height = Math.max(a.y1 - a.y0, b.y1 - b.y0);

          if (Math.abs(centerA - centerB) < height) {
            hit = {
              top: Math.min(a.y0, b.y0),
              bottom: Math.max(a.y1, b.y1)
            };
            break;
          }
        }
      }

      if (!hit) {
        it.note.textContent = 'Không tìm thấy Trading with';
        return false;
      }

      const margin = Math.max(
        8,
        Math.round((hit.bottom - hit.top) * 0.65)
      );

      const y = Math.max(0, Math.floor(hit.top - margin));
      const bottom = Math.min(
        it.img.naturalHeight,
        Math.ceil(hit.bottom + margin)
      );

      it.regions = it.regions.filter(r => !r.auto);
      it.regions.push({
        x: 0,
        y,
        w: it.img.naturalWidth,
        h: bottom - y,
        effect: fx(),
        strength: strength(),
        text: $('coverText')?.value.trim() || '',
        auto: true
      });

      redraw(it);
      it.note.textContent = `Đã che dải ngang y=${y}–${bottom}`;
      return true;
    } catch (err) {
      console.error('Lỗi OCR:', err);
      it.note.textContent = 'Lỗi: ' + (err.message || err);
      return false;
    } finally {
      if (own && worker) {
        try {
          await worker.terminate();
        } catch {}
      }
    }
  }

  // Tự tìm trên tất cả ảnh
  $('autoAll').onclick = async () => {
    if (busy || !items.length) return;

    busy = true;
    controls();
    let worker;

    try {
      worker = await makeWorker();
      let success = 0;

      for (let i = 0; i < items.length; i++) {
        say(`Đang xử lý ${i + 1}/${items.length}: ${items[i].file.name}`);
        if (await one(items[i], worker)) success++;
      }

      say(`Hoàn tất: tìm thấy Trading with ở ${success}/${items.length} ảnh.`);
    } catch (err) {
      console.error('Lỗi khởi tạo OCR:', err);
      say('Lỗi OCR: ' + (err.message || err) +
        '. Kiểm tra kết nối Internet.');
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch {}
      }

      busy = false;
      controls();
    }
  };

  // Tải một ảnh
  function download(it) {
    try {
      redraw(it);

      it.output.toBlob(blob => {
        if (!blob) {
          say('Không tạo được ảnh.');
          return;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        a.href = url;
        a.download = it.file.name.replace(/\.[^.]+$/, '') + '_hidden.png';
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => URL.revokeObjectURL(url), 2000);
        say('Đã xuất ảnh.');
      }, 'image/png');
    } catch (err) {
      say('Lỗi xuất ảnh: ' + (err.message || err));
    }
  }

  // Chọn vùng thủ công
  function selectRegion(it) {
    const box = document.createElement('div');
    box.className = 'card';

    const msg = document.createElement('p');
    msg.textContent = 'Kéo để chọn vùng cần che.';

    const c = document.createElement('canvas');
    c.width = it.img.naturalWidth;
    c.height = it.img.naturalHeight;
    c.style.width = '100%';
    c.style.height = 'auto';
    c.style.touchAction = 'none';

    const ctx = c.getContext('2d');
    let start = null;
    let selected = null;

    box.append(msg, c);

    const row = document.createElement('div');
    row.className = 'actions';

    const apply = document.createElement('button');
    apply.textContent = 'Áp dụng';

    const cancel = document.createElement('button');
    cancel.textContent = 'Hủy';

    row.append(apply, cancel);
    box.append(row);
    it.el.after(box);

    function paint() {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(it.output || it.img, 0, 0);

      if (selected) {
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 4;
        ctx.setLineDash([8, 5]);
        ctx.strokeRect(
          selected.x, selected.y,
          selected.w, selected.h
        );
        ctx.setLineDash([]);
      }
    }

    paint();

    const position = e => {
      const rect = c.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(c.width,
          (e.clientX - rect.left) * c.width / rect.width)),
        y: Math.max(0, Math.min(c.height,
          (e.clientY - rect.top) * c.height / rect.height))
      };
    };

    c.onpointerdown = e => {
      start = position(e);
      selected = { x: start.x, y: start.y, w: 0, h: 0 };
      c.setPointerCapture(e.pointerId);
      paint();
    };

    c.onpointermove = e => {
      if (!start) return;
      const p = position(e);

      selected = {
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(start.x - p.x),
        h: Math.abs(start.y - p.y)
      };

      paint();
    };

    c.onpointerup = () => {
      start = null;
    };

    apply.onclick = () => {
      if (!selected || selected.w < 2 || selected.h < 2) {
        msg.textContent = 'Hãy chọn vùng trước.';
        return;
      }

      it.regions.push({
        ...selected,
        effect: fx(),
        strength: strength(),
        text: $('coverText')?.value.trim() || ''
      });

      redraw(it);
      it.note.textContent = 'Đã thêm vùng thủ công.';
      box.remove();
    };

    cancel.onclick = () => box.remove();
  }

  // Tải tất cả ảnh thành ZIP
  $('zipAll').onclick = async () => {
    if (!window.JSZip) {
      say('Không tải được JSZip. Kiểm tra Internet.');
      return;
    }

    if (!items.length) {
      say('Chưa có ảnh để xuất.');
      return;
    }

    try {
      say('Đang tạo ZIP...');
      const zip = new JSZip();

      for (const it of items) {
        redraw(it);

        const blob = await new Promise(resolve =>
          it.output.toBlob(resolve, 'image/png')
        );

        if (!blob) throw new Error('Không xuất được ' + it.file.name);

        zip.file(
          it.file.name.replace(/\.[^.]+$/, '') + '_hidden.png',
          blob
        );
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      a.href = url;
      a.download = 'roblox_hidden_images.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 2000);
      say('Đã tạo ZIP ảnh.');
    } catch (err) {
      console.error('Lỗi ZIP:', err);
      say('Lỗi tạo ZIP: ' + (err.message || err));
    }
  };

  // Xóa danh sách
  $('clearAll').onclick = () => {
    items = [];
    gallery.replaceChildren();
    $('files').value = '';
    say('Đã xóa danh sách ảnh.');
    controls();
  };

  $('watermarkText')?.addEventListener('input', () => {
    items.forEach(redraw);
  });

  $('watermarkSize')?.addEventListener('input', () => {
    items.forEach(redraw);
  });

  controls();
})();
