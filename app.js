
(() => {
const $ = id => document.getElementById(id);
const gallery = $('gallery');
let items = [], busy = false;

const say = t => $('status').textContent = t;
const fx = () => $('effect').value;
const strength = () => +$('strength').value;

function controls() {
  $('autoAll').disabled = busy || !items.length;
  $('zipAll').disabled = busy || !items.length;
  $('clearAll').disabled = busy || !items.length;
}

async function makeWorker() {
  if (!window.Tesseract) {
    throw new Error('Không tải được thư viện OCR. Hãy kiểm tra Internet hoặc CDN.');
  }

  return Tesseract.createWorker('eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    workerBlobURL: true
  });
}

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

      small.getContext('2d').drawImage(c, x, y, w, h, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
    } else {
      // Tạo vùng lớn hơn để làm mờ không bị viền sắc.
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
      pctx.drawImage(c, left, top, patch.width, patch.height, 0, 0, patch.width, patch.height);
      ctx.drawImage(patch, left, top);
    }
  }

  return c;
}

function redraw(it) {
  it.output = output(it);
  it.ctx.clearRect(0, 0, it.canvas.width, it.canvas.height);
  it.ctx.drawImage(it.output, 0, 0);
}

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
  it.note.textContent = 'Chưa xử lý';

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

$('files').onchange = e => {
  [...e.target.files]
    .filter(f => f.type.startsWith('image/'))
    .forEach(file => {
      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        const it = { file, img, regions: [] };
        items.push(it);
        card(it);
        say(`Đã tải ${items.length} ảnh.`);
        controls();
        URL.revokeObjectURL(url);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        say('Không mở được ảnh: ' + file.name);
      };

      img.src = url;
    });
};

async function one(it, worker) {
  let own = false;

  try {
    it.note.textContent = 'Đang nhận diện...';

    if (!worker) {
      worker = await makeWorker();
      own = true;
    }

    const result = await worker.recognize(it.img);
    const words = (result.data.words || [])
      .filter(w => w.text && w.confidence > 15);

    let hit = null;

    for (let i = 0; i < words.length && !hit; i++) {
      const first = words[i];
      if (first.text.toLowerCase().replace(/[^a-z]/g, '') !== 'trading') continue;

      for (let j = i + 1; j < Math.min(i + 6, words.length); j++) {
        const second = words[j];

        if (second.text.toLowerCase().replace(/[^a-z]/g, '') !== 'with') continue;

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

    // Che một dải ngang toàn chiều rộng ảnh.
    const margin = Math.max(8, Math.round((hit.bottom - hit.top) * 0.65));
    const y = Math.max(0, Math.floor(hit.top - margin));
    const bottom = Math.min(it.img.naturalHeight, Math.ceil(hit.bottom + margin));

    // Bỏ vùng tự động cũ để tránh chồng nhiều lớp khi chạy lại.
    it.regions = it.regions.filter(r => !r.auto);
    it.regions.push({
      x: 0,
      y,
      w: it.img.naturalWidth,
      h: bottom - y,
      effect: fx(),
      strength: strength(),
      auto: true
    });

    redraw(it);
    it.note.textContent = `Đã che toàn chiều ngang: y=${y}–${bottom}`;
    return true;

  } catch (err) {
    it.note.textContent = 'Lỗi: ' + err.message;
    return false;
  } finally {
    if (own && worker) {
      try { await worker.terminate(); } catch {}
    }
  }
}

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
    say('Lỗi OCR: ' + err.message + '. Hãy kiểm tra kết nối Internet.');
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch {}
    }
    busy = false;
    controls();
  }
};

function download(it) {
  redraw(it);

  it.output.toBlob(blob => {
    if (!blob) {
      say('Không tạo được ảnh.');
      return;
    }

    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = it.file.name.replace(/\.[^.]+$/, '') + '_hidden.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

function selectRegion(it) {
  const box = document.createElement('div');
  box.className = 'card';

  const msg = document.createElement('p');
  msg.textContent = 'Kéo chuột để chọn dải ngang cần che.';

  const c = document.createElement('canvas');
  c.width = it.img.naturalWidth;
  c.height = it.img.naturalHeight;
  c.style.width = '100%';
  c.style.touchAction = 'none';

  const ctx = c.getContext('2d');
  let start = null, selected = null;

  function paint() {
    ctx.drawImage(it.output || it.img, 0, 0);

    if (selected) {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(selected.x, selected.y, selected.w, selected.h);
      ctx.setLineDash([]);
    }
  }

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

  const position = e => {
    const rect = c.getBoundingClientRect();
    const scale = c.width / rect.width;
    return {
      x: (e.clientX - rect.left) * scale,
      y: (e.clientY - rect.top) * scale
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

  c.onpointerup = () => { start = null; };

  apply.onclick = () => {
    if (!selected || selected.w < 2 || selected.h < 2) {
      msg.textContent = 'Hãy chọn vùng trước.';
      return;
    }

    it.regions.push({
      ...selected,
      effect: fx(),
      strength: strength()
    });

    redraw(it);
    it.note.textContent = 'Đã thêm vùng thủ công.';
    box.remove();
  };

  cancel.onclick = () => box.remove();
}

$('zipAll').onclick = async () => {
  if (!window.JSZip) {
    say('Không tải được JSZip. Hãy kiểm tra Internet.');
    return;
  }

  try {
    say('Đang tạo ZIP...');
    const zip = new JSZip();

    items.forEach(it => {
      redraw(it);
      const data = it.output.toDataURL('image/png').split(',')[1];
      zip.file(it.file.name.replace(/\.[^.]+$/, '') + '_hidden.png', data, { base64: true });
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = 'roblox_hidden_images.zip';
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 2000);
    say('Đã tạo ZIP ảnh.');
  } catch (err) {
    say('Lỗi tạo ZIP: ' + err.message);
  }
};

$('clearAll').onclick = () => {
  items = [];
  gallery.replaceChildren();
  $('files').value = '';
  say('Đã xóa danh sách ảnh.');
  controls();
};
})();
