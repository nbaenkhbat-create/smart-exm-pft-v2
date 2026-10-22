/* SmartEXAM — Groq photo parser + ZipGrade-style OMR (browser-only) */
(function (global) {
  'use strict';

  var GROQ_API_KEY = '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';
  var GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  var GROQ_MODEL = 'qwen/qwen3.8-27b';

  var OMR = {
    W: 720,
    H: 1068,
    pageW: 210,
    pageH: 297,
    mcx0: 15,
    mcy0: 15,
    innerW: 180,
    innerH: 267
  };

  function mmToWarp(xMm, yMm) {
    return {
      x: ((xMm - OMR.mcx0) / OMR.innerW) * OMR.W,
      y: ((yMm - OMR.mcy0) / OMR.innerH) * OMR.H
    };
  }

  function omrLayout(qCount) {
    var n = Math.max(1, Math.min(50, qCount | 0));
    var cols = n > 25 ? 2 : 1;
    var perCol = Math.ceil(n / cols);
    var headerMm = 38;
    var topMm = OMR.mcy0 + headerMm;
    var botMm = 282 - 8;
    var span = botMm - topMm;
    var items = [];
    for (let i = 0; i < n; i++) {
      var col = Math.floor(i / perCol);
      var row = i % perCol;
      var colW = OMR.innerW / cols;
      var x0 = OMR.mcx0 + col * colW;
      var yMm = topMm + ((row + 0.55) * span) / perCol;
      var bubbles = ['A', 'B', 'C', 'D'].map(function (key, bi) {
        var xMm = x0 + colW * (0.42 + bi * 0.135);
        var p = mmToWarp(xMm, yMm);
        return { key: key, x: p.x, y: p.y, r: 9 };
      });
      var np = mmToWarp(x0 + 8, yMm);
      items.push({ n: i + 1, x: np.x, y: np.y, bubbles: bubbles });
    }
    return { qCount: n, cols: cols, items: items };
  }

  function gaussSolve(A, b) {
    var n = b.length;
    var M = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var i = 0; i < n; i++) {
      var max = i;
      for (var k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[max][i])) max = k;
      var tmp = M[i]; M[i] = M[max]; M[max] = tmp;
      var piv = M[i][i] || 1e-12;
      for (var j = i; j <= n; j++) M[i][j] /= piv;
      for (var r = 0; r < n; r++) if (r !== i) {
        var f = M[r][i];
        for (var c = i; c <= n; c++) M[r][c] -= f * M[i][c];
      }
    }
    return M.map(function (row) { return row[n]; });
  }

  function homography(src, dst) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i].x, y = src[i].y, X = dst[i].x, Y = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
    }
    var h = gaussSolve(A, b);
    return h.concat([1]);
  }

  function applyH(H, x, y) {
    var w = H[6] * x + H[7] * y + H[8];
    return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
  }

  function grayOf(data, idx) {
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  function findMarkerInBox(data, w, h, x0, y0, x1, y1, box) {
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
    x1 = Math.min(w, x1 | 0); y1 = Math.min(h, y1 | 0);
    var best = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, score: -1 };
    var step = Math.max(2, (box / 5) | 0);
    for (var y = y0; y + box < y1; y += step) {
      for (var x = x0; x + box < x1; x += step) {
        var dark = 0, n = 0;
        for (var j = 0; j < box; j += 2) {
          for (var i = 0; i < box; i += 2) {
            n++;
            if (grayOf(data, ((y + j) * w + (x + i)) * 4) < 70) dark++;
          }
        }
        var score = dark / n;
        if (score > best.score) best = { x: x + box / 2, y: y + box / 2, score: score };
      }
    }
    return best;
  }

  function detectCorners(img) {
    var c = document.createElement('canvas');
    var maxSide = 1400;
    var k = Math.min(1, maxSide / Math.max(img.width, img.height));
    c.width = Math.max(2, Math.round(img.width * k));
    c.height = Math.max(2, Math.round(img.height * k));
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    var data = ctx.getImageData(0, 0, c.width, c.height).data;
    var w = c.width, h = c.height;
    var box = Math.max(18, Math.round(Math.min(w, h) * 0.045));
    var tl = findMarkerInBox(data, w, h, 0, 0, w * 0.32, h * 0.28, box);
    var tr = findMarkerInBox(data, w, h, w * 0.68, 0, w, h * 0.28, box);
    var br = findMarkerInBox(data, w, h, w * 0.68, h * 0.72, w, h, box);
    var bl = findMarkerInBox(data, w, h, 0, h * 0.72, w * 0.32, h, box);
    var pts = [tl, tr, br, bl];
    var ok = pts.every(function (p) { return p.score >= 0.28; });
    return { ok: ok, pts: pts, canvas: c, scale: k };
  }

  function warpSheet(img, corners) {
    var dw = OMR.W, dh = OMR.H;
    var H = homography(
      [{ x: 0, y: 0 }, { x: dw, y: 0 }, { x: dw, y: dh }, { x: 0, y: dh }],
      corners
    );
    var src = document.createElement('canvas');
    src.width = img.width; src.height = img.height;
    src.getContext('2d').drawImage(img, 0, 0);
    var sctx = src.getContext('2d');
    var srcData = sctx.getImageData(0, 0, src.width, src.height);
    var sd = srcData.data, sw = src.width, sh = src.height;
    var out = document.createElement('canvas');
    out.width = dw; out.height = dh;
    var octx = out.getContext('2d');
    var id = octx.createImageData(dw, dh);
    var od = id.data;
    for (var y = 0; y < dh; y++) {
      for (var x = 0; x < dw; x++) {
        var p = applyH(H, x, y);
        var sx = p.x, sy = p.y;
        var di = (y * dw + x) * 4;
        if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
          od[di] = od[di + 1] = od[di + 2] = 255; od[di + 3] = 255;
          continue;
        }
        var x0 = sx | 0, y0 = sy | 0;
        var fx = sx - x0, fy = sy - y0;
        var i00 = (y0 * sw + x0) * 4;
        var i10 = (y0 * sw + x0 + 1) * 4;
        var i01 = ((y0 + 1) * sw + x0) * 4;
        var i11 = ((y0 + 1) * sw + x0 + 1) * 4;
        for (var ch = 0; ch < 3; ch++) {
          od[di + ch] = (sd[i00 + ch] * (1 - fx) * (1 - fy) + sd[i10 + ch] * fx * (1 - fy) +
            sd[i01 + ch] * (1 - fx) * fy + sd[i11 + ch] * fx * fy) | 0;
        }
        od[di + 3] = 255;
      }
    }
    octx.putImageData(id, 0, 0);
    return out;
  }

  function bubbleFill(data, w, cx, cy, r) {
    var dark = 0, n = 0, r2 = r * r;
    for (var y = -r; y <= r; y++) {
      for (var x = -r; x <= r; x++) {
        if (x * x + y * y > r2) continue;
        var px = (cx + x) | 0, py = (cy + y) | 0;
        if (px < 0 || py < 0 || px >= w) continue;
        n++;
        if (grayOf(data, (py * w + px) * 4) < 95) dark++;
      }
    }
    return n ? dark / n : 0;
  }

  function readBubbles(warped, qCount) {
    var layout = omrLayout(qCount);
    var ctx = warped.getContext('2d');
    var img = ctx.getImageData(0, 0, warped.width, warped.height);
    var data = img.data, w = warped.width;
    var marks = layout.items.map(function (row) {
      var fills = row.bubbles.map(function (b) {
        return { key: b.key, fill: bubbleFill(data, w, b.x, b.y, b.r) };
      });
      fills.sort(function (a, b) { return b.fill - a.fill; });
      var top = fills[0], second = fills[1];
      var marked = top.fill >= 0.32;
      var multi = marked && second && second.fill >= 0.32 && (top.fill - second.fill) < 0.12;
      return {
        n: row.n,
        mark: multi ? 'MULTI' : (marked ? top.key : ''),
        fills: row.bubbles.map(function (b) {
          return { key: b.key, fill: bubbleFill(data, w, b.x, b.y, b.r) };
        }),
        bubbles: row.bubbles
      };
    });
    return { layout: layout, marks: marks };
  }

  function overlayResult(warped, read, keyMap) {
    var c = document.createElement('canvas');
    c.width = warped.width; c.height = warped.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(warped, 0, 0);
    read.marks.forEach(function (m) {
      var want = (keyMap && keyMap[m.n]) || '';
      var got = m.mark;
      var color = '#f59e0b';
      if (got === 'MULTI' || (got && want && got !== want)) color = '#dc2626';
      else if (got && want && got === want) color = '#16a34a';
      else if (!got) color = '#f59e0b';
      m.bubbles.forEach(function (b) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = b.key === got ? color : 'rgba(15,23,42,.18)';
        ctx.lineWidth = b.key === got ? 3 : 1;
        ctx.stroke();
      });
    });
    return c;
  }

  function gradeMarks(marks, keyMap) {
    var total = marks.length, correct = 0, blank = 0, multi = 0, wrong = 0;
    var detail = marks.map(function (m) {
      var want = keyMap[m.n] || '';
      var status = 'blank';
      if (m.mark === 'MULTI') { status = 'multi'; multi++; }
      else if (!m.mark) { status = 'blank'; blank++; }
      else if (want && m.mark === want) { status = 'correct'; correct++; }
      else { status = 'wrong'; wrong++; }
      return { n: m.n, got: m.mark || '', want: want, status: status };
    });
    return {
      total: total,
      correct: correct,
      wrong: wrong,
      blank: blank,
      multi: multi,
      score: total ? Math.round((correct / total) * 100) : 0,
      detail: detail
    };
  }

  function processOMR(img, qCount, keyMap) {
    var det = detectCorners(img);
    if (!det.ok) {
      throw new Error('4 булангийн хар тэмдэг олдсонгүй. Хуудсыг бүтэн, гэрэлтэй зургаарай.');
    }
    var warped = warpSheet(img, det.pts);
    var read = readBubbles(warped, qCount);
    var grade = gradeMarks(read.marks, keyMap || {});
    var preview = overlayResult(warped, read, keyMap || {});
    return { warped: warped, preview: preview, read: read, grade: grade, corners: det.pts };
  }

  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Зураг нээгдсэнгүй')); };
      img.src = url;
    });
  }

  function compressImage(img, maxSide, quality) {
    maxSide = maxSide || 1280;
    quality = quality || 0.72;
    var k = Math.min(1, maxSide / Math.max(img.width, img.height));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }

  function extractJson(text) {
    if (!text) return null;
    var s = String(text).replace(/```json/gi, '```').trim();
    var fence = s.match(/```([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return null; }
  }

  function mapGroqQuiz(raw) {
    var title = String((raw && raw.title) || '').trim().slice(0, 200);
    var questions = Array.isArray(raw && raw.questions) ? raw.questions : [];
    var out = [];
    questions.forEach(function (q, i) {
      if (!q) return;
      var type = String(q.type || 'mcq').toLowerCase();
      if (type === 'multiple' || type === 'choice' || type === 'single') type = 'mcq';
      if (type === 'fill' || type === 'fill_in' || type === 'blank') type = 'blank';
      if (type === 'matching' || type === 'match') type = 'match';
      if (type === 'truefalse' || type === 'tf' || type === 'true_false') type = 'tf';
      var text = String(q.text || q.question || '').trim();
      if (!text) return;
      var item = {
        id: out.length + 1,
        text: text.slice(0, 2000),
        type: type,
        topic: String(q.topic || '').slice(0, 120),
        imageUrl: '',
        sourceText: String(q.sourceText || '').slice(0, 4000),
        audioUrl: '',
        unit: '',
        left: [],
        options: [],
        answer: null,
        numericAnswer: null
      };
      if (type === 'match') {
        item.left = (q.left || []).slice(0, 8).map(function (t) { return String(t || '').slice(0, 300); });
        if (item.left.length < 2) item.left = ['', ''];
        var rights = q.right || q.options || [];
        item.options = rights.slice(0, 8).map(function (t, oi) {
          if (t && typeof t === 'object') return { key: t.key || 'ABCDEFGH'[oi], text: String(t.text || '').slice(0, 500) };
          return { key: 'ABCDEFGH'[oi], text: String(t || '').slice(0, 500) };
        });
        if (item.options.length < 2) item.options = [{ key: 'A', text: '' }, { key: 'B', text: '' }];
        item.answer = String(q.answer || '').slice(0, 40);
      } else if (type === 'tf') {
        item.options = [
          { key: 'A', text: 'Зөв / Үнэн' },
          { key: 'B', text: 'Буруу / Худал' }
        ];
        var ans = String(q.answer || '').toUpperCase();
        item.answer = (ans === 'B' || ans === 'FALSE' || ans === 'ХУДАЛ' || ans === 'БУРУУ') ? 'B' : (ans ? 'A' : null);
      } else if (type === 'blank' || type === 'grid') {
        item.type = type === 'grid' ? 'grid' : 'blank';
        item.options = type === 'grid' ? [] : [{ key: 'A', text: '' }, { key: 'B', text: '' }, { key: 'C', text: '' }, { key: 'D', text: '' }];
        item.answer = q.answer != null ? String(q.answer).slice(0, 80) : null;
        item.numericAnswer = type === 'grid' ? item.answer : null;
      } else {
        item.type = 'mcq';
        var opts = q.options || [];
        item.options = ['A', 'B', 'C', 'D'].map(function (key, oi) {
          var hit = opts.find && opts.find(function (o) { return o && (o.key === key || o.letter === key); });
          var byI = opts[oi];
          var txt = '';
          if (hit && typeof hit === 'object') txt = hit.text || '';
          else if (typeof byI === 'string') txt = byI;
          else if (byI && typeof byI === 'object') txt = byI.text || '';
          return { key: key, text: String(txt).slice(0, 500) };
        });
        var a = String(q.answer || '').trim().toUpperCase();
        item.answer = 'ABCD'.indexOf(a.charAt(0)) >= 0 ? a.charAt(0) : null;
      }
      out.push(item);
    });
    return { title: title, questions: out };
  }

  function groqVisionQuiz(dataUrls, onStatus) {
    onStatus = onStatus || function () {};
    var images = (dataUrls || []).slice(0, 3);
    if (!images.length) return Promise.reject(new Error('Зураг алга'));
    onStatus('Зургийг Groq руу илгээж байна...');
    var content = [
      {
        type: 'text',
        text: 'You are an exam OCR parser. Read the test paper photo(s). Return ONLY JSON (no markdown) with this shape:\n' +
          '{"title":"string","questions":[{"text":"...","type":"mcq|tf|blank|match","options":[{"key":"A","text":"..."},{"key":"B","text":"..."},{"key":"C","text":"..."},{"key":"D","text":"..."}],"answer":"A","left":[],"right":[],"topic":""}]}\n' +
          'Rules:\n- Preserve original language (Mongolian or whatever is printed).\n- type=mcq for A-D choice; tf for true/false; blank for fill-in; match for matching.\n- answer is the correct letter if visible, else "".\n- Extract ALL numbered questions. Do not invent extra items.\n- Never include explanations or code.'
      }
    ];
    images.forEach(function (u) {
      content.push({ type: 'image_url', image_url: { url: u } });
    });
    return fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        max_completion_tokens: 8192,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: content }]
      })
    }).then(function (res) {
      return res.text().then(function (body) {
        var parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
        if (!res.ok) {
          var msg = (parsed && parsed.error && parsed.error.message) || ('Groq алдаа ' + res.status);
          throw new Error(msg);
        }
        onStatus('Асуултуудыг эмхэлж байна...');
        var txt = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message
          ? parsed.choices[0].message.content
          : '';
        var quiz = extractJson(txt) || parsed;
        var mapped = mapGroqQuiz(quiz);
        if (!mapped.questions.length) throw new Error('Зургаас асуулт уншигдсангүй. Тод, бүтэн хуудас зургаарай.');
        return mapped;
      });
    });
  }

  global.SEOMR = {
    OMR: OMR,
    omrLayout: omrLayout,
    processOMR: processOMR,
    loadImageFile: loadImageFile,
    compressImage: compressImage,
    groqVisionQuiz: groqVisionQuiz
  };
})(window);
