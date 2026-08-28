"use strict";

/* =========================================================
   シート領域 = 抜き型データ（assets/cutpass.svg）そのもの
   ---------------------------------------------------------
   MASK  … cutpass.svg の viewBox 全体を、どこに置けば実機と一致するか。
           ベース画像の穴（ディスプレイ・USB-A×2・USB-C×2）の中心と
           抜き型の穴の中心を最小二乗で合わせて算出（残差 2.1px 以下 / 4000px中）
   SHEET … そのときのシート外形の範囲（模様の配置基準に使う）
   ※ 数値はすべて「ベース画像の横幅を1」とする単位。縦もこの単位で持つので、
     正方形でない画像でも扱える。ベース画像を差し替えたら再計算が必要。
   ========================================================= */
const MASK  = { x: 0.118921, y: 0.062448, w: 0.765855, h: 0.541460 };
const SHEET = { x: 0.219440, y: 0.171966, w: 0.565201, h: 0.322999 };

/* 表示範囲の縦横比（マス目やサムネイルの形に使う） */
const RATIO_W = 1527, RATIO_H = 1000;

/* カード／プレビューで表示する範囲（余白を落とすためのトリミング） */
const VIEW = { x0: 0.0967, y0: 0.0491, x1: 0.9113, y1: 0.5825 };

/* =========================================================
   state（保存はしません。リロードで消えます）
   ========================================================= */
const S = {
  base: null,
  mask: null,      // cutpass.svg（シート形状）
  printSrc: null,  // print.svg のテキスト（印字レイヤー）
  shadowImg: null, // assets/shadow.png（出っ張りの落ち影）
  items: {},       // id -> item
  current: null
};

S.catNames = {};
for (const cat of CATALOG) S.catNames[cat.id] = cat.name;
const catNameOf = id => S.catNames[id] || id;

for (const cat of CATALOG) {
  for (const it of cat.items) {
    S.items[it.id] = {
      id: it.id, catId: cat.id, no: it.no,
      name: it.name || "",
      mode: "color",
      hex: "#EE7A20",
      pattern: null, patternName: "",
      adj: { sat: 100, bright: 100, contrast: 100, cr: 0, mg: 0, yb: 0 },
      fit: "cover", scale: 100, offX: 0, offY: 0, rot: 0,
      print: "white", printColor: "#F3BE18",
      applied: false,
      room: null
    };
  }
}

const $ = id => document.getElementById(id);

/* =========================================================
   描画
   ========================================================= */
/* 正規化座標 → キャンバス座標 の変換器 */
function mapper(cw, ch) {
  const sx = VIEW.x1 - VIEW.x0, sy = VIEW.y1 - VIEW.y0;
  return {
    x: n => (n - VIEW.x0) / sx * cw,
    y: n => (n - VIEW.y0) / sy * ch,
    w: n => n / sx * cw,
    h: n => n / sy * ch
  };
}

/* 色／模様を抜き型で切り抜いた1枚を作る（使い回しの裏キャンバス） */
const _layer = document.createElement("canvas");
function makeLayer(cw, ch, item) {
  if (!S.mask) return null;
  _layer.width = cw; _layer.height = ch;
  const g = _layer.getContext("2d");
  g.clearRect(0, 0, cw, ch);

  const m = mapper(cw, ch);
  const px = m.x(SHEET.x), py = m.y(SHEET.y), pw = m.w(SHEET.w), ph = m.h(SHEET.h);

  if (item.mode === "pattern" && item.pattern) {
    drawPattern(g, item, px, py, pw, ph);
  } else {
    g.fillStyle = item.hex;
    g.fillRect(px, py, pw, ph);
  }

  /* 出っ張りの落ち影（assets/shadow.png があれば重ねる）
     抜き型（cutpass.svg）と同じアートボードで書き出した透過PNG。
     つまみ本体が写っていても、このあと抜き型で切り抜かれるので影だけ残る */
  if (S.shadowImg) g.drawImage(S.shadowImg, m.x(MASK.x), m.y(MASK.y), m.w(MASK.w), m.h(MASK.h));

  /* 抜き型で切り抜く */
  g.globalCompositeOperation = "destination-in";
  g.drawImage(S.mask, m.x(MASK.x), m.y(MASK.y), m.w(MASK.w), m.h(MASK.h));
  g.globalCompositeOperation = "source-over";
  return _layer;
}

/* ---------------------------------------------------------
   印字レイヤー（assets/print.svg の .cls-3 だけを任意色で描く）
   シート形状と同じ viewBox なので、MASK と同じ位置に重ねればよい
   --------------------------------------------------------- */
const printCache = new Map();   // color -> {img, ready}

function printImage(color) {
  if (!S.printSrc) return null;
  let e = printCache.get(color);
  if (!e) {
    const img = new Image();
    e = { img, ready: false };
    printCache.set(color, e);
    img.onload = () => {
      e.ready = true;
      /* 陰影マップは印字を打ち消すのに使うので、揃ってから作り直す */
      Object.keys(S.items).forEach(refreshCard);
      if (S.current) repaintDetail();
    };
    /* .cls-2（シート形状）は opacity:0 のまま、.cls-3 の色だけ差し替える */
    const svg = S.printSrc.replace(/fill:\s*#fff/i, `fill:${color}`);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  return e.ready ? e.img : null;
}

function printColorOf(item) {
  if (item.print === "black") return "#1E1E1E";
  if (item.print === "color") return item.printColor || "#F3BE18";
  return "#FFFFFF";
}

/* キャンバス1枚を描く。item.applied が false ならベース画像のまま */
function paint(canvas, item) {
  const g = canvas.getContext("2d");
  const cw = canvas.width, ch = canvas.height;
  g.clearRect(0, 0, cw, ch);
  if (!S.base) return;

  const BW = S.base.naturalWidth;
  g.drawImage(S.base,
    VIEW.x0 * BW, VIEW.y0 * BW, (VIEW.x1 - VIEW.x0) * BW, (VIEW.y1 - VIEW.y0) * BW,
    0, 0, cw, ch);

  if (item && item.applied) {
    const layer = makeLayer(cw, ch, item);
    if (layer) g.drawImage(layer, 0, 0);

    const pc = printColorOf(item);
    const pimg = pc && printImage(pc);
    if (pimg) {
      const m = mapper(cw, ch);
      g.drawImage(pimg, m.x(MASK.x), m.y(MASK.y), m.w(MASK.w), m.h(MASK.h));
    }
  }
}

/* ---------------------------------------------------------
   模様の色調整
   彩度・明るさ・コントラストは canvas のフィルタ、
   カラーバランス（中間調）は1画素ずつ計算する。
   結果はキャッシュして、カードを描くたびに作り直さないようにする
   --------------------------------------------------------- */
const ADJ_DEFAULT = { sat: 100, bright: 100, contrast: 100, cr: 0, mg: 0, yb: 0 };
const adjKey = a => [a.sat, a.bright, a.contrast, a.cr, a.mg, a.yb].join(",");
const isAdjDefault = a => adjKey(a) === adjKey(ADJ_DEFAULT);

function adjustedPattern(item) {
  if (!item.pattern) return null;
  const a = item.adj || ADJ_DEFAULT;
  if (isAdjDefault(a)) return item.pattern;

  /* どの画像かをキーに含めないと、模様を差し替えたときに前の画像が残る */
  const key = item.pattern.src + "|" + adjKey(a);
  if (item._adjCache && item._adjCache.key === key) return item._adjCache.canvas;

  const img = item.pattern;
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.filter = `saturate(${a.sat}%) brightness(${a.bright}%) contrast(${a.contrast}%)`;
  g.drawImage(img, 0, 0);
  g.filter = "none";

  if (a.cr || a.mg || a.yb) {
    const im = g.getImageData(0, 0, W, H), d = im.data;
    const kr = a.cr / 100 * 76, kg = a.mg / 100 * 76, kb = a.yb / 100 * 76;
    const cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
    /* 中間調ほど強くかかる重み（0と255では効かない） */
    const w = v => { const t = v / 127.5 - 1; return 1 - t * t; };
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      const L0 = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      let nr = r + kr * w(r), ng = gg + kg * w(gg), nb = b + kb * w(b);
      /* 輝度を保持（Photoshopの既定と同じ考え方） */
      const L1 = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
      if (L1 > 0.5) { const sc = L0 / L1; nr *= sc; ng *= sc; nb *= sc; }
      d[i] = cl(nr); d[i + 1] = cl(ng); d[i + 2] = cl(nb);
    }
    g.putImageData(im, 0, 0);
  }
  item._adjCache = { key, canvas: c };
  return c;
}

function drawPattern(g, item, px, py, pw, ph) {
  const img = adjustedPattern(item);
  if (!img) return;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const sc = item.scale / 100;
  const ox = (item.offX / 100) * pw * 0.5;
  const oy = (item.offY / 100) * ph * 0.5;

  g.save();
  g.translate(px + pw / 2 + ox, py + ph / 2 + oy);
  g.rotate(item.rot * Math.PI / 180);
  if (item.fit === "repeat") {
    const pat = g.createPattern(img, "repeat");
    const unit = Math.max(pw, ph) / 2 * sc;
    const k = unit / Math.max(iw, ih);
    if (pat.setTransform) pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    g.fillStyle = pat;
    const big = Math.hypot(pw, ph) * 1.6;
    g.fillRect(-big / 2, -big / 2, big, big);
  } else {
    const cover = Math.max(pw / iw, ph / ih) * sc;
    const dw = iw * cover, dh = ih * cover;
    g.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  }
  g.restore();
}

/* =========================================================
   画像の読み込み
   ========================================================= */
function loadFile(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
function pickFile(cb) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  inp.onchange = () => { if (inp.files[0]) cb(inp.files[0]); };
  inp.click();
}
function wireDrop(el, onFile) {
  ["dragenter", "dragover"].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.remove("over"); }));
  el.addEventListener("drop", e => {
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) onFile(f);
  });
}

/* =========================================================
   一覧
   ========================================================= */
const CARD_W = 480;
const CARD_H = Math.round(CARD_W * (VIEW.y1 - VIEW.y0) / (VIEW.x1 - VIEW.x0));
const cardCanvas = {};   // id -> canvas
const cardEl = {};       // id -> element

function buildCatalog() {
  const root = $("catalogRoot");
  const nav = $("catnav");
  root.innerHTML = ""; nav.innerHTML = "";

  for (const cat of CATALOG) {
    const a = document.createElement("a");
    a.href = "#" + cat.id; a.textContent = catNameOf(cat.id);
    a.dataset.cat = cat.id;
    nav.appendChild(a);

    const sec = document.createElement("section");
    sec.className = "cat"; sec.id = cat.id;
    sec.innerHTML = `<div class="cat-head"><span class="cat-num">${cat.id.replace("c", "")}</span>
        <input class="cat-name-input" data-cat="${cat.id}" value="${catNameOf(cat.id)}"
               title="クリックして名前を変更できます">
        <span class="cat-count">${cat.items.filter(it => S.items[it.id].applied).length} / ${cat.items.length}案</span></div>`;
    sec.querySelector(".cat-name-input").addEventListener("input", e => {
      S.catNames[cat.id] = e.target.value;
      a.textContent = e.target.value;
      if (S.current && cur().catId === cat.id) $("dCat").textContent = e.target.value;
    });
    const grid = document.createElement("div");
    grid.className = "grid";
    /* 登録済みだけを並べる。未設定は出さない */
    for (const it of cat.items) {
      if (S.items[it.id].applied) grid.appendChild(buildCard(S.items[it.id]));
    }
    const next = cat.items.find(it => !S.items[it.id].applied);
    if (next) {
      const add = document.createElement("button");
      add.className = "card card-add";
      add.innerHTML = `<span class="plus">＋</span><span class="t">案を追加</span>`;
      add.addEventListener("click", () => openDetail(next.id));
      grid.appendChild(add);
    }
    sec.appendChild(grid);
    root.appendChild(sec);
  }
  $("statCat").textContent = CATALOG.length;
  $("statItem").textContent = Object.keys(S.items).length;
  updateFilled();
}

function buildCard(item) {
  const el = document.createElement("button");
  el.className = "card";
  el.innerHTML = `
    <div class="card-visual">
      <div class="card-pane"><span class="pane-tag">本体</span><canvas width="${CARD_W}" height="${CARD_H}"></canvas></div>
      <div class="card-pane room"><span class="pane-tag">イメージ</span>
        <div class="room-empty"><span class="plus">＋</span>イメージ画像</div>
      </div>
    </div>
    <div class="card-meta">
      <span class="card-chip"></span>
      <span class="card-name"></span>
      <span class="card-no">${String(item.no).padStart(2, "0")}</span>
    </div>`;
  cardCanvas[item.id] = el.querySelector("canvas");
  cardEl[item.id] = el;
  el.addEventListener("click", () => openDetail(item.id));
  refreshCard(item.id);
  return el;
}

function refreshCard(id) {
  const item = S.items[id], el = cardEl[id];
  if (!el) return;
  paint(cardCanvas[id], item);

  const chip = el.querySelector(".card-chip");
  const name = el.querySelector(".card-name");
  if (item.applied) {
    if (item.mode === "pattern" && item.pattern) {
      chip.style.background = `url(${item.pattern.src}) center/cover`;
    } else {
      chip.style.background = item.hex;
    }
    chip.style.display = "";
    name.textContent = item.name || (item.mode === "pattern" ? "（模様・名称未設定）" : item.hex);
    name.classList.remove("empty");
  } else {
    chip.style.display = "none";
    name.textContent = "未設定";
    name.classList.add("empty");
  }

  const roomPane = el.querySelector(".card-pane.room");
  roomPane.querySelectorAll("img").forEach(n => n.remove());
  const empty = roomPane.querySelector(".room-empty");
  if (item.room) {
    empty.style.display = "none";
    const img = document.createElement("img");
    img.src = item.room.src;
    roomPane.appendChild(img);
  } else {
    empty.style.display = "";
  }
  updateFilled();
}

function updateFilled() {
  const n = Object.values(S.items).filter(i => i.applied).length;
  $("statFilled").textContent = n;
}

/* =========================================================
   詳細
   ========================================================= */
function openDetail(id) {
  S.current = id;
  const it = S.items[id];

  $("dCat").textContent = catNameOf(it.catId);
  $("dNo").textContent = "No." + String(it.no).padStart(2, "0");
  $("dName").value = it.name;

  setSeg("dMode", "mode", it.mode);
  $("dColorArea").style.display = it.mode === "color" ? "" : "none";
  $("dPatArea").style.display = it.mode === "pattern" ? "" : "none";

  $("dPicker").value = it.hex;
  $("dHex").value = it.hex.toUpperCase();
  syncRGBFromHex();

  setSeg("dFit", "fit", it.fit);
  $("dScale").value = it.scale; $("vScale").textContent = it.scale + "%";
  $("dOffX").value = it.offX;   $("vOffX").textContent = it.offX;
  $("dOffY").value = it.offY;   $("vOffY").textContent = it.offY;
  $("dRot").value = it.rot;     $("vRot").textContent = it.rot + "°";
  syncAdj();

  setSeg("dPrint", "print", it.print);
  $("dPrintColorRow").style.display = it.print === "color" ? "" : "none";
  $("dPrintPicker").value = it.printColor;
  $("dPrintHex").value = it.printColor.toUpperCase();

  refreshPatInfo();
  refreshRoom();
  refreshApplyBtn();
  repaintDetail();

  $("overlay").classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeDetail() {
  $("overlay").classList.remove("show");
  document.body.style.overflow = "";
  S.current = null;
}

function cur() { return S.items[S.current]; }

function repaintDetail() {
  paint($("dCanvas"), cur());
}

function refreshApplyBtn() {
  const it = cur();
  $("btnApply").textContent = it.applied ? "反映を解除" : "反映する";
  $("btnApply").classList.toggle("btn-primary", !it.applied);
  $("applyState").textContent = it.applied ? "反映中" : "反映前（ベースのまま）";
  $("applyState").classList.toggle("on", it.applied);
}

function setSeg(segId, key, value) {
  document.querySelectorAll(`#${segId} button`).forEach(b => {
    b.classList.toggle("active", b.dataset[key] === value);
  });
}

function syncRGBFromHex() {
  const h = $("dHex").value.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return;
  $("dR").value = $("dRr").value = parseInt(h.slice(0, 2), 16);
  $("dG").value = $("dGr").value = parseInt(h.slice(2, 4), 16);
  $("dB").value = $("dBr").value = parseInt(h.slice(4, 6), 16);
}
function hexFromRGB() {
  const v = k => Math.max(0, Math.min(255, parseInt($(k).value || 0, 10)));
  return "#" + [v("dR"), v("dG"), v("dB")].map(n => n.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function setColor(hex) {
  const it = cur(); if (!it) return;
  it.hex = hex;
  $("dPicker").value = hex; $("dHex").value = hex.toUpperCase();
  syncRGBFromHex();
  repaintDetail();
}

function refreshPatInfo() {
  const it = cur();
  const box = $("dPatInfo");
  if (it.pattern) {
    box.classList.add("show");
    $("dPatThumb").src = it.pattern.src;
    $("dPatMeta").textContent = `${it.patternName}（${it.pattern.naturalWidth}×${it.pattern.naturalHeight}px）`;
  } else {
    box.classList.remove("show");
  }
}

function refreshRoom() {
  const it = cur();
  const wrap = $("dRoomWrap");
  wrap.innerHTML = "";
  if (it.room) {
    const img = document.createElement("img");
    img.src = it.room.src;
    wrap.className = "room-box";
    wrap.appendChild(img);
  } else {
    wrap.className = "";
    const d = document.createElement("div");
    d.className = "room-drop";
    d.innerHTML = "<strong>イメージ画像をドロップ / クリックして選択</strong><span>部屋の写真など、設置シーンの画像</span>";
    d.addEventListener("click", () => pickFile(setRoom));
    wireDrop(d, setRoom);
    wrap.appendChild(d);
  }
}

async function setRoom(file) {
  const it = cur(); if (!it) return;
  it.room = await loadFile(file);
  it.roomBlob = file;          // 保存スロット用に原本を持っておく
  refreshRoom();
  refreshCard(it.id);
}

/* =========================================================
   イベント
   ========================================================= */
$("dClose").addEventListener("click", closeDetail);
$("overlay").addEventListener("click", e => { if (e.target === $("overlay")) closeDetail(); });
document.addEventListener("keydown", e => {
  if (!S.current) return;
  if (e.key === "Escape") closeDetail();
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "ArrowRight") step(1);
});

function step(d) {
  const ids = Object.keys(S.items);
  const i = ids.indexOf(S.current);
  const next = ids[(i + d + ids.length) % ids.length];
  openDetail(next);
}
$("dPrev").addEventListener("click", () => step(-1));
$("dNext").addEventListener("click", () => step(1));

$("btnApply").addEventListener("click", () => {
  const it = cur();
  it.applied = !it.applied;
  refreshApplyBtn();
  repaintDetail();
  buildCatalog();          // 一覧に出る／出ないが変わるので作り直す
});

$("dName").addEventListener("input", e => {
  cur().name = e.target.value;
  refreshCard(cur().id);
});

document.querySelectorAll("#dMode button").forEach(b => {
  b.addEventListener("click", () => {
    const it = cur();
    it.mode = b.dataset.mode;
    setSeg("dMode", "mode", it.mode);
    $("dColorArea").style.display = it.mode === "color" ? "" : "none";
    $("dPatArea").style.display = it.mode === "pattern" ? "" : "none";
    repaintDetail(); refreshCard(it.id);
  });
});

$("dPicker").addEventListener("input", e => setColor(e.target.value.toUpperCase()));
$("dHex").addEventListener("input", e => {
  const h = e.target.value.trim().replace(/^#?/, "#");
  if (/^#[0-9a-fA-F]{6}$/.test(h)) { cur().hex = h.toUpperCase(); $("dPicker").value = h; syncRGBFromHex(); repaintDetail(); }
});
["dR", "dG", "dB"].forEach(k => $(k).addEventListener("input", () => setColor(hexFromRGB())));
["dRr", "dGr", "dBr"].forEach((k, i) => $(k).addEventListener("input", e => {
  $(["dR", "dG", "dB"][i]).value = e.target.value;
  setColor(hexFromRGB());
}));

$("dPatUp").addEventListener("click", () => pickFile(setPattern));
wireDrop($("dPatUp"), setPattern);
async function setPattern(file) {
  const it = cur(); if (!it) return;
  it.pattern = await loadFile(file);
  it._adjCache = null;
  it.patternBlob = file;       // 保存スロット用
  it.patternKind = "file";
  it.patternName = file.name;
  it.mode = "pattern";
  setSeg("dMode", "mode", "pattern");
  $("dColorArea").style.display = "none";
  $("dPatArea").style.display = "";
  refreshPatInfo(); repaintDetail(); refreshCard(it.id);
}
$("dPatClear").addEventListener("click", () => {
  const it = cur();
  it.pattern = null; it.patternName = ""; it.patternKind = null; it.patternBlob = null; it._adjCache = null;
  refreshPatInfo(); repaintDetail(); refreshCard(it.id);
});

document.querySelectorAll("#dFit button").forEach(b => {
  b.addEventListener("click", () => {
    cur().fit = b.dataset.fit;
    setSeg("dFit", "fit", cur().fit);
    repaintDetail(); refreshCard(cur().id);
  });
});
const sliders = [["dScale", "scale", "vScale", v => v + "%"], ["dOffX", "offX", "vOffX", v => v],
                 ["dOffY", "offY", "vOffY", v => v], ["dRot", "rot", "vRot", v => v + "°"]];
for (const [el, key, out, fmt] of sliders) {
  $(el).addEventListener("input", e => {
    cur()[key] = +e.target.value;
    $(out).textContent = fmt(e.target.value);
    repaintDetail(); refreshCard(cur().id);
  });
}

/* 印字 */
document.querySelectorAll("#dPrint button").forEach(b => {
  b.addEventListener("click", () => {
    const it = cur();
    it.print = b.dataset.print;
    setSeg("dPrint", "print", it.print);
    $("dPrintColorRow").style.display = it.print === "color" ? "" : "none";
    repaintDetail(); refreshCard(it.id);
  });
});
function setPrintColor(hex) {
  const it = cur(); if (!it) return;
  it.printColor = hex.toUpperCase();
  it.print = "color";
  setSeg("dPrint", "print", "color");
  $("dPrintColorRow").style.display = "";
  $("dPrintPicker").value = hex;
  $("dPrintHex").value = hex.toUpperCase();
  repaintDetail(); refreshCard(it.id);
}
$("dPrintPicker").addEventListener("input", e => setPrintColor(e.target.value));
$("dPrintHex").addEventListener("input", e => {
  const h = e.target.value.trim().replace(/^#?/, "#");
  if (/^#[0-9a-fA-F]{6}$/.test(h)) setPrintColor(h);
});

/* 模様の色調整 */
const ADJ_UI = [
  ["dSat", "sat", "vSat", v => v + "%"],
  ["dBright", "bright", "vBright", v => v + "%"],
  ["dContrast", "contrast", "vContrast", v => v + "%"],
  ["dCr", "cr", "vCr", v => v],
  ["dMg", "mg", "vMg", v => v],
  ["dYb", "yb", "vYb", v => v]
];
function syncAdj() {
  const it = cur(); if (!it) return;
  if (!it.adj) it.adj = { ...ADJ_DEFAULT };
  for (const [el, key, out, fmt] of ADJ_UI) {
    $(el).value = it.adj[key];
    $(out).textContent = fmt(it.adj[key]);
  }
}
for (const [el, key, out, fmt] of ADJ_UI) {
  $(el).addEventListener("input", e => {
    const it = cur(); if (!it) return;
    it.adj[key] = +e.target.value;
    $(out).textContent = fmt(e.target.value);
    repaintDetail(); refreshCard(it.id);
  });
}
$("dAdjReset").addEventListener("click", () => {
  const it = cur(); if (!it) return;
  it.adj = { ...ADJ_DEFAULT };
  syncAdj(); repaintDetail(); refreshCard(it.id);
});

$("dRoomPick").addEventListener("click", () => pickFile(setRoom));
$("dRoomClear").addEventListener("click", () => {
  cur().room = null; cur().roomBlob = null; refreshRoom(); refreshCard(cur().id);
});

/* =========================================================
   単体の書き出し（PNG）
   ========================================================= */
function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, "_").trim(); }

/* PDFのファイル名はブラウザがページのタイトルから作るので、
   保存の直前だけタイトルを一意な名前に差し替える */
const PAGE_TITLE = document.title;
function pdfName(it) {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const label = it.mode === "pattern" && it.pattern
    ? (it.patternName || "模様").replace(/\.[^.]+$/, "")
    : it.hex.toUpperCase().replace("#", "");
  const parts = [safeName(catNameOf(it.catId)), String(it.no).padStart(2, "0")];
  if (it.name) parts.push(safeName(it.name));
  parts.push(safeName(label), stamp);
  return parts.join("_");
}

$("dPdf").addEventListener("click", () => {
  const it = cur(); if (!it) return;
  if (!S.base || !S.mask) { alert("画像の読み込みが終わっていません。"); return; }

  const label = it.mode === "pattern" && it.pattern ? (it.patternName || "模様") : it.hex.toUpperCase();
  const root = $("printRoot");
  root.innerHTML = "";
  const pg = document.createElement("div");
  pg.className = "p-page";
  pg.innerHTML = `<div class="p-one"><img src="${shot(it, 2400)}" alt="">
    <div class="code">${label}</div></div>`;
  root.appendChild(pg);

  document.title = pdfName(it);
  setTimeout(() => window.print(), 150);
});

/* 印刷用のプレビュー画像を作る */
function shot(item, w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = Math.round(w * (VIEW.y1 - VIEW.y0) / (VIEW.x1 - VIEW.x0));
  paint(c, item);
  return c.toDataURL("image/png");
}
window.addEventListener("afterprint", () => {
  $("printRoot").innerHTML = "";
  document.title = PAGE_TITLE;
});

/* ベース画像 */
function setBase(img) {
  S.base = img;
  $("basebar").classList.add("ok");
  $("baseLbl").textContent = "ベース画像 読み込み済み";
  $("baseMsg").textContent = `${img.naturalWidth}×${img.naturalHeight}px`;
  Object.keys(S.items).forEach(refreshCard);
  if (S.current) repaintDetail();
}
$("btnBase").addEventListener("click", () => pickFile(async f => setBase(await loadFile(f))));

(function initBase() {
  const img = new Image();
  img.onload = () => setBase(img);
  img.onerror = () => {
    $("baseLbl").textContent = "ベース画像 未設定";
    $("baseMsg").textContent = "assets/base.png が読み込めませんでした。右のボタンから選択してください。";
  };
  img.src = "assets/base.png?v=202608290121";
})();

/* 抜き型（cutpass.svg） */
(function initMask() {
  const img = new Image();
  img.onload = () => {
    S.mask = img;
    Object.keys(S.items).forEach(refreshCard);
    if (S.current) repaintDetail();
  };
  img.onerror = () => {
    $("baseLbl").textContent = "抜き型データが読めません";
    $("baseMsg").textContent = "assets/cutpass.svg が見つかりません。";
  };
  img.src = "assets/cutpass.svg?v=202608290121";
})();

/* 出っ張りの落ち影（assets/shadow.png / 任意） */
(function initShadow() {
  const img = new Image();
  img.onload = () => {
    S.shadowImg = img;
    Object.keys(S.items).forEach(refreshCard);
    if (S.current) repaintDetail();
  };
  img.onerror = () => {};      /* 無ければ影なしで動く */
  img.src = "assets/shadow.png?v=202608290121";
})();

/* 印字レイヤー（assets/print.svg） */
fetch("assets/print.svg?v=202608290121")
  .then(r => r.ok ? r.text() : Promise.reject(new Error(r.status)))
  .then(t => {
    S.printSrc = t;
    Object.keys(S.items).forEach(refreshCard);
    if (S.current) repaintDetail();
  })
  .catch(() => { console.warn("assets/print.svg を読み込めませんでした"); });

buildCatalog();
