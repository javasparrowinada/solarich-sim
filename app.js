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
const RATIO_W = 217, RATIO_H = 145;

/* カード／プレビューで表示する範囲（余白を落とすためのトリミング） */
const VIEW = { x0: 0.0967, y0: 0.0516, x1: 0.9113, y1: 0.5959 };

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

function drawPattern(g, item, px, py, pw, ph) {
  const img = item.pattern;
  const iw = img.naturalWidth, ih = img.naturalHeight;
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
  it.pattern = null; it.patternName = ""; it.patternKind = null; it.patternBlob = null;
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

$("dRoomPick").addEventListener("click", () => pickFile(setRoom));
$("dRoomClear").addEventListener("click", () => {
  cur().room = null; cur().roomBlob = null; refreshRoom(); refreshCard(cur().id);
});

/* =========================================================
   単体の書き出し（PNG）
   ========================================================= */
function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, "_").trim(); }

$("dDownload").addEventListener("click", () => {
  const it = cur(); if (!it) return;
  const W = 2400;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = Math.round(W * (VIEW.y1 - VIEW.y0) / (VIEW.x1 - VIEW.x0));
  paint(c, it);
  const parts = [safeName(catNameOf(it.catId)), String(it.no).padStart(2, "0")];
  if (it.name) parts.push(safeName(it.name));
  if (!it.applied) parts.push("反映前");
  c.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = parts.join("_") + ".png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
});

/* =========================================================
   保存スロット（3件・IndexedDB）
   生成した柄はプロンプトから作り直せるので画像は保存しない。
   アップロードした画像だけ原本を保存する。
   ========================================================= */
const DB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open("solarich-1000", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("slots");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const store = async mode => (await open()).transaction("slots", mode).objectStore("slots");
  const wrap = q => new Promise((res, rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  return {
    async put(k, v) { return wrap((await store("readwrite")).put(v, k)); },
    async get(k) { return wrap((await store("readonly")).get(k)); },
    async del(k) { return wrap((await store("readwrite")).delete(k)); }
  };
})();

const SLOT_COUNT = 10;
const SLOTS = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1);
const slotKey = n => "slot" + n;
S.currentSlot = null;

function snapshot(title) {
  const items = [];
  for (const it of Object.values(S.items)) {
    const used = it.applied || it.name || it.room || it.pattern;
    if (!used) continue;
    items.push({
      id: it.id, name: it.name, mode: it.mode, hex: it.hex,
      fit: it.fit, scale: it.scale, offX: it.offX, offY: it.offY, rot: it.rot,
      print: it.print, printColor: it.printColor, applied: it.applied,
      patternKind: it.patternKind || (it.pattern ? "gen" : null),
      patternName: it.patternName || "",
      patternBlob: it.patternKind === "file" ? it.patternBlob : null,
      roomBlob: it.roomBlob || null
    });
  }
  return { title: title || "", savedAt: new Date().toISOString(), catNames: { ...S.catNames }, items };
}

async function restore(data) {
  /* いったん全部まっさらに戻す */
  for (const it of Object.values(S.items)) {
    Object.assign(it, {
      name: "", mode: "color", hex: "#EE7A20",
      pattern: null, patternBlob: null, patternKind: null, patternName: "",
      fit: "cover", scale: 100, offX: 0, offY: 0, rot: 0,
      print: "white", printColor: "#F3BE18", applied: false, room: null, roomBlob: null
    });
  }
  S.catNames = { ...data.catNames };

  for (const s of data.items) {
    const it = S.items[s.id];
    if (!it) continue;
    Object.assign(it, {
      name: s.name, mode: s.mode, hex: s.hex,
      fit: s.fit, scale: s.scale, offX: s.offX, offY: s.offY, rot: s.rot,
      print: s.print, printColor: s.printColor, applied: s.applied,
      patternKind: s.patternKind, patternName: s.patternName
    });
    if (s.patternBlob) {
      it.patternBlob = s.patternBlob;
      it.pattern = await loadFile(s.patternBlob);
    }
    if (s.roomBlob) {
      it.roomBlob = s.roomBlob;
      it.room = await loadFile(s.roomBlob);
    }
  }
  buildCatalog();
  if (S.current) openDetail(S.current);
}

function savesMsg(m, cls) {
  const el = $("savesMsg");
  el.textContent = m; el.className = "saves-msg" + (cls ? " " + cls : "");
}

function slotLabel(data, n) {
  return (data && data.title) ? data.title : (data ? `版 ${n}` : "");
}
function updateSlotLabel(data, n) {
  $("slotLabel").textContent = data ? slotLabel(data, n) : "未保存";
}

async function renderSlots() {
  const list = $("slotList");
  list.innerHTML = "";

  for (const n of SLOTS) {
    const data = await DB.get(slotKey(n)).catch(() => null);
    const row = document.createElement("div");
    row.className = "vrow " + (data ? "filled" : "empty") + (S.currentSlot === n ? " on" : "");

    const dot = document.createElement("span");
    dot.className = "vdot";
    row.appendChild(dot);

    const name = document.createElement("input");
    name.className = "vname";
    name.type = "text";
    name.value = data ? slotLabel(data, n) : "";
    name.placeholder = `版 ${n}（空き）`;
    name.disabled = !data;
    name.addEventListener("input", () => {
      clearTimeout(name._t);
      name._t = setTimeout(async () => {
        const cur = await DB.get(slotKey(n));
        if (!cur) return;
        cur.title = name.value.trim();
        await DB.put(slotKey(n), cur);
        if (S.currentSlot === n) updateSlotLabel(cur, n);
      }, 400);
    });
    row.appendChild(name);

    const foot = document.createElement("div");
    foot.className = "vfoot";
    const meta = document.createElement("span");
    meta.className = "vmeta";
    meta.textContent = data
      ? new Date(data.savedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
        + `　${data.items.filter(i => i.applied).length}案`
      : "未保存";
    foot.appendChild(meta);

    const mk = (label, cls, fn) => {
      const b = document.createElement("button");
      b.className = "btn btn-sm" + (cls ? " " + cls : "");
      b.textContent = label;
      b.addEventListener("click", fn);
      foot.appendChild(b);
    };

    if (!data) {
      mk("ここに保存", "btn-primary", async () => {
        try {
          await DB.put(slotKey(n), snapshot(`版 ${n}`));
          S.currentSlot = n;
          const d = await DB.get(slotKey(n));
          updateSlotLabel(d, n);
          savesMsg(`版 ${n} として保存しました。名称を入力できます。`, "ok");
          await renderSlots();
          const inp = list.querySelectorAll(".vname")[n - 1];
          if (inp) { inp.focus(); inp.select(); }
        } catch (e) { savesMsg("保存できませんでした：" + e.message, "err"); }
      });
    } else {
      if (S.currentSlot !== n) {
        mk("切替", "btn-primary", async () => {
          if (!confirm(`「${slotLabel(data, n)}」に切り替えます。\n保存していない変更は失われます。よろしいですか？`)) return;
          try {
            await restore(data);
            S.currentSlot = n;
            updateSlotLabel(data, n);
            savesMsg(`「${slotLabel(data, n)}」に切り替えました。`, "ok");
            renderSlots();
          } catch (e) { savesMsg("切り替えられませんでした：" + e.message, "err"); }
        });
      }
      mk("上書き保存", "", async () => {
        if (!confirm(`「${slotLabel(data, n)}」をいまの内容で上書きします。よろしいですか？`)) return;
        try {
          await DB.put(slotKey(n), snapshot(data.title || `版 ${n}`));
          S.currentSlot = n;
          savesMsg(`「${slotLabel(data, n)}」を上書きしました。`, "ok");
          renderSlots();
        } catch (e) { savesMsg("保存できませんでした：" + e.message, "err"); }
      });
      mk("削除", "btn-ghost", async () => {
        if (!confirm(`「${slotLabel(data, n)}」を削除します。よろしいですか？`)) return;
        await DB.del(slotKey(n));
        if (S.currentSlot === n) { S.currentSlot = null; updateSlotLabel(null, n); }
        savesMsg("削除しました。");
        renderSlots();
      });
    }
    row.appendChild(foot);
    list.appendChild(row);
  }
}

$("btnSaves").addEventListener("click", e => {
  e.stopPropagation();
  const p = $("savePanel");
  $("exportPanel").classList.remove("show");
  p.classList.toggle("show");
  if (p.classList.contains("show")) { savesMsg(""); renderSlots(); }
});
document.addEventListener("click", e => {
  const p = $("savePanel");
  if (p.classList.contains("show") && !p.contains(e.target)) p.classList.remove("show");
});

/* =========================================================
   一覧の書き出し（A4横 / ブラウザの印刷 → PDFで保存）
   P1        … 全体マップ（10カテゴリー × 10枠）
   P2以降    … 登録のあるカテゴリーごとに 5列×2行
   ========================================================= */
const PRINT = { mapW: 340, cellW: 900 };

function shot(item, w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = Math.round(w * (VIEW.y1 - VIEW.y0) / (VIEW.x1 - VIEW.x0));
  paint(c, item);
  return c.toDataURL("image/png");
}

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function buildPrint() {
  const root = $("printRoot");
  root.innerHTML = "";

  const filled = Object.values(S.items).filter(i => i.applied);
  if (!filled.length) {
    alert("登録済みの案がありません。詳細を開いて色や模様を指定し、「反映する」を押してください。");
    return false;
  }
  const today = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });

  /* ---- P1 全体マップ ---- */
  const p1 = el("div", "p-page");
  const map = el("div", "p-map");
  /* 1案も登録がないカテゴリーは出さない */
  const cats = CATALOG.filter(c => c.items.some(ci => S.items[ci.id].applied));
  /* 行数に応じてマスの大きさを決める（A4横・余白14mmに収める） */
  const capH = 2.4, rowGap = 1.5, chrome = 12;      // mm
  const availH = 182 - chrome;
  let cellW = (availH - cats.length * capH - (cats.length - 1) * rowGap) / cats.length * RATIO_W / RATIO_H;
  cellW = Math.min(cellW, 21.2);
  map.style.gridTemplateColumns = `24mm repeat(${ITEMS_PER_CATEGORY}, ${cellW.toFixed(2)}mm)`;

  map.appendChild(el("div"));
  for (let i = 1; i <= ITEMS_PER_CATEGORY; i++) map.appendChild(el("div", "colno", String(i).padStart(2, "0")));
  for (const cat of cats) {
    const n = cat.items.filter(ci => S.items[ci.id].applied).length;
    map.appendChild(el("div", "rowlbl",
      `${catNameOf(cat.id)}<small>${n ? n + "案" : "－"}</small>`));
    for (const ci of cat.items) {
      const item = S.items[ci.id];
      const cell = el("div", "mcell");
      const th = el("div", "mthumb" + (item.applied ? "" : " empty"));
      if (item.applied) {
        const im = new Image(); im.src = shot(item, PRINT.mapW);
        th.appendChild(im);
      }
      cell.appendChild(th);
      cell.appendChild(el("div", "mcap", item.applied ? (item.name || "&nbsp;") : "&nbsp;"));
      map.appendChild(cell);
    }
  }
  p1.appendChild(map);
  root.appendChild(p1);

  /* ---- カテゴリーページ ---- */
  for (const cat of CATALOG) {
    const items = cat.items.map(ci => S.items[ci.id]).filter(i => i.applied);
    if (!items.length) continue;

    const pg = el("div", "p-page");
    pg.appendChild(el("div", "p-head",
      `<span class="t">${catNameOf(cat.id)}</span>
       <span class="s">${items.length}案</span>
       <span class="r">solarich 着せ替えシートシミュレーション　/　${today}</span>`));

    const grid = el("div", "p-grid");
    for (const item of items) {
      const cell = el("div", "p-cell");
      const main = el("div", "p-main");
      const im = new Image(); im.src = shot(item, PRINT.cellW);
      main.appendChild(im);
      cell.appendChild(main);

      const foot = el("div", "p-foot");
      if (item.room) {
        const r = new Image(); r.className = "p-room"; r.src = item.room.src;
        foot.appendChild(r);
      } else {
        foot.appendChild(el("div", "p-room none"));
      }
      const label = item.mode === "pattern" && item.pattern
        ? (item.patternName || "模様")
        : item.hex.toUpperCase();
      foot.appendChild(el("div", "p-txt",
        `<div class="p-no">${String(item.no).padStart(2, "0")}</div>
         <div class="p-name">${item.name || "（名称未設定）"}</div>
         <div class="p-code">${label}</div>`));
      cell.appendChild(foot);
      grid.appendChild(cell);
    }
    pg.appendChild(grid);
    root.appendChild(pg);
  }
  return true;
}

$("btnExpPdf").addEventListener("click", () => {
  if (!S.base || !S.mask) { alert("画像の読み込みが終わっていません。"); return; }
  let ok;
  try { ok = buildPrint(); }
  catch (e) {
    alert("書き出しに失敗しました。静的サーバー経由（http://…）で開いてください。\n" + e.message);
    return;
  }
  if (!ok) return;
  $("exportPanel").classList.remove("show");
  setTimeout(() => window.print(), 120);
});
window.addEventListener("afterprint", () => { $("printRoot").innerHTML = ""; });

$("btnExport").addEventListener("click", e => {
  e.stopPropagation();
  $("savePanel").classList.remove("show");
  $("exportPanel").classList.toggle("show");
});
document.addEventListener("click", e => {
  const p = $("exportPanel");
  if (p.classList.contains("show") && !p.contains(e.target)) p.classList.remove("show");
});

/* =========================================================
   一覧の書き出し（PNG 1920×1080）
   ページ構成はPDFと同じ。1ページ＝1枚のPNG
   ========================================================= */
const PNG = { W: 1920, H: 1080, PAD: 64 };

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r);
  g.closePath();
}
function hatch(g, x, y, w, h) {
  g.save(); rr(g, x, y, w, h, 5); g.clip();
  g.fillStyle = "#F7F6F4"; g.fillRect(x, y, w, h);
  g.strokeStyle = "#EDEBE7"; g.lineWidth = 5;
  for (let i = -h; i < w; i += 14) { g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + h, y); g.stroke(); }
  g.restore();
}
function clipText(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}
function pngHeader(g, title, sub, right) {
  const { PAD, W } = PNG;
  g.textBaseline = "alphabetic"; g.textAlign = "left";
  g.fillStyle = "#1F3A5F"; g.font = "900 32px 'Noto Sans JP', sans-serif";
  g.fillText(title, PAD, PAD + 30);
  const tw = g.measureText(title).width;
  g.fillStyle = "#6E6B66"; g.font = "400 17px 'Noto Sans JP', sans-serif";
  g.fillText(sub, PAD + tw + 18, PAD + 30);
  g.fillStyle = "#9C9892"; g.textAlign = "right";
  g.fillText(right, W - PAD, PAD + 30);
  g.strokeStyle = "#1F3A5F"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(PAD, PAD + 46); g.lineTo(W - PAD, PAD + 46); g.stroke();
  g.textAlign = "left";
  return PAD + 46;
}
function newPage() {
  const c = document.createElement("canvas");
  c.width = PNG.W; c.height = PNG.H;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, PNG.W, PNG.H);
  return { c, g };
}

function pngOverview() {
  const { c, g } = newPage();
  const { PAD, W, H } = PNG;

  const labelW = 190, colGap = 26, rowGap = 10, capH = 22, numH = 24;
  const cols = ITEMS_PER_CATEGORY;
  /* 1案も登録がないカテゴリーは出さない */
  const cats = CATALOG.filter(c => c.items.some(ci => S.items[ci.id].applied));
  const rows = cats.length;
  let thH = (H - PAD * 2 - numH - rows * capH - rowGap * (rows - 1)) / rows;
  let thW = thH * RATIO_W / RATIO_H;
  const maxW = (W - PAD * 2 - labelW - colGap * cols) / cols;
  if (thW > maxW) { thW = maxW; thH = thW * RATIO_H / RATIO_W; }
  const rowH = thH + capH;
  const x0 = Math.max(PAD, (W - (labelW + cols * thW + colGap * cols)) / 2);
  const y0 = PAD + Math.max(0, (H - PAD * 2 - numH - rows * rowH - rowGap * (rows - 1)) / 2);

  g.font = "700 14px 'Noto Sans JP', sans-serif";
  g.fillStyle = "#9C9892"; g.textAlign = "center";
  for (let i = 0; i < cols; i++)
    g.fillText(String(i + 1).padStart(2, "0"), x0 + labelW + colGap + i * (thW + colGap) + thW / 2, y0 + 16);
  g.textAlign = "left";

  cats.forEach((cat, r) => {
    const y = y0 + numH + r * (rowH + rowGap);
    const n = cat.items.filter(ci => S.items[ci.id].applied).length;
    g.fillStyle = "#1F3A5F"; g.font = "700 16px 'Noto Sans JP', sans-serif";
    g.fillText(clipText(g, catNameOf(cat.id), labelW - 16), x0, y + thH / 2 - 2);
    g.fillStyle = "#9C9892"; g.font = "400 12px 'Noto Sans JP', sans-serif";
    g.fillText(n ? n + "案" : "－", x0, y + thH / 2 + 15);

    cat.items.forEach((ci, i) => {
      const item = S.items[ci.id];
      const x = x0 + labelW + colGap + i * (thW + colGap);
      if (item.applied) {
        const t = document.createElement("canvas");
        t.width = Math.round(thW * 2); t.height = Math.round(thH * 2);
        paint(t, item);
        g.save(); rr(g, x, y, thW, thH, 4); g.clip();
        g.drawImage(t, x, y, thW, thH); g.restore();
      } else hatch(g, x, y, thW, thH);
      g.strokeStyle = "#E2E0DC"; g.lineWidth = 1;
      rr(g, x + .5, y + .5, thW - 1, thH - 1, 4); g.stroke();

      if (item.applied && item.name) {
        g.fillStyle = "#3A3A38"; g.font = "400 11px 'Noto Sans JP', sans-serif";
        g.textAlign = "center";
        g.fillText(clipText(g, item.name, thW), x + thW / 2, y + thH + 14);
        g.textAlign = "left";
      }
    });
  });
  return c;
}

function pngCategory(cat, items, today) {
  const { c, g } = newPage();
  const { PAD, W, H } = PNG;
  const top = pngHeader(g, catNameOf(cat.id), `${items.length}案`,
    `solarich 着せ替えシートシミュレーション　/　${today}`) + 30;

  const cols = 5, gap = 26, footH = 62;
  const imgW = (W - PAD * 2 - gap * (cols - 1)) / cols;
  const imgH = imgW * RATIO_H / RATIO_W;
  const cellH = imgH + footH;
  const rowsN = Math.ceil(items.length / cols);
  const y0 = top + Math.max(0, (H - PAD - top - (rowsN * cellH + (rowsN - 1) * gap)) / 2);

  items.forEach((item, i) => {
    const x = PAD + (i % cols) * (imgW + gap);
    const y = y0 + Math.floor(i / cols) * (cellH + gap);

    g.save(); rr(g, x, y, imgW, cellH, 8); g.clip();
    g.fillStyle = "#fff"; g.fillRect(x, y, imgW, cellH);
    const t = document.createElement("canvas");
    t.width = Math.round(imgW * 2); t.height = Math.round(imgH * 2);
    paint(t, item);
    g.drawImage(t, x, y, imgW, imgH);
    g.restore();
    g.strokeStyle = "#E2E0DC"; g.lineWidth = 1;
    rr(g, x + .5, y + .5, imgW - 1, cellH - 1, 8); g.stroke();

    const fy = y + imgH + 10, thW = 62, thH = 42;
    if (item.room) {
      g.save(); rr(g, x + 10, fy, thW, thH, 4); g.clip();
      const s = Math.max(thW / item.room.naturalWidth, thH / item.room.naturalHeight);
      g.drawImage(item.room, x + 10 + (thW - item.room.naturalWidth * s) / 2,
        fy + (thH - item.room.naturalHeight * s) / 2,
        item.room.naturalWidth * s, item.room.naturalHeight * s);
      g.restore();
    } else hatch(g, x + 10, fy, thW, thH);
    g.strokeStyle = "#E2E0DC"; g.lineWidth = 1;
    rr(g, x + 10.5, fy + .5, thW - 1, thH - 1, 4); g.stroke();

    const tx = x + 10 + thW + 10, tmax = imgW - (thW + 30);
    g.textAlign = "left";
    g.fillStyle = "#1F3A5F"; g.font = "900 22px 'Noto Sans JP', sans-serif";
    g.fillText(String(item.no).padStart(2, "0"), tx, fy + 18);
    g.fillStyle = "#1E1E1C"; g.font = "700 14px 'Noto Sans JP', sans-serif";
    g.fillText(clipText(g, item.name || "（名称未設定）", tmax), tx, fy + 34);
    g.fillStyle = "#6E6B66"; g.font = "400 12px 'Noto Sans JP', sans-serif";
    const label = item.mode === "pattern" && item.pattern ? (item.patternName || "模様") : item.hex.toUpperCase();
    g.fillText(clipText(g, label, tmax), tx, fy + 50);
  });
  return c;
}

function downloadCanvas(canvas, name) {
  return new Promise(res => canvas.toBlob(b => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); res(); }, 400);
  }, "image/png"));
}

/* =========================================================
   共有用HTML（1ファイル完結・画像を埋め込む）
   ========================================================= */
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function itemJpeg(item, w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = Math.round(w * (VIEW.y1 - VIEW.y0) / (VIEW.x1 - VIEW.x0));
  paint(c, item);
  return c.toDataURL("image/jpeg", 0.92);
}
function roomJpeg(img, maxW) {
  const s = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

function buildShareHtml(title, today) {
  const cats = CATALOG.filter(c => c.items.some(ci => S.items[ci.id].applied));
  const total = Object.values(S.items).filter(i => i.applied).length;

  let body = "";
  for (const cat of cats) {
    const items = cat.items.map(ci => S.items[ci.id]).filter(i => i.applied);
    body += `<section><h2>${esc(catNameOf(cat.id))}<span>${items.length}案</span></h2><div class="g">`;
    for (const it of items) {
      const label = it.mode === "pattern" && it.pattern ? (it.patternName || "模様") : it.hex.toUpperCase();
      body += `<figure>
        <img class="b" src="${itemJpeg(it, 1000)}" alt="">
        ${it.room ? `<img class="r" src="${roomJpeg(it.room, 900)}" alt="">` : ""}
        <figcaption><b>${String(it.no).padStart(2, "0")}</b>
          <span class="n">${esc(it.name || "（名称未設定）")}</span>
          <span class="c">${esc(label)}</span></figcaption>
      </figure>`;
    }
    body += `</div></section>`;
  }

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}｜solarich 着せ替えシートシミュレーション</title>
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans JP','Hiragino Sans','Yu Gothic',sans-serif;background:#F4F4F2;color:#1E1E1C;line-height:1.7;-webkit-font-smoothing:antialiased}
header{background:#fff;border-bottom:1px solid rgba(0,0,0,.08);padding:22px 24px}
.hd{max-width:1280px;margin:0 auto;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.hd h1{font-size:1.15rem;font-weight:900;color:#1F3A5F}
.hd .s{font-size:.78rem;color:#6E6B66}
.hd .d{margin-left:auto;font-size:.72rem;color:#9C9892}
main{max-width:1280px;margin:0 auto;padding:8px 24px 72px}
section{margin-top:40px}
h2{font-size:1.05rem;font-weight:900;display:flex;align-items:baseline;gap:10px;margin-bottom:14px}
h2 span{font-size:.72rem;font-weight:400;color:#9C9892}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
figure{background:#fff;border:1px solid rgba(0,0,0,.05);border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(30,30,28,.06)}
figure img{width:100%;display:block}
figure img.b{background:#FBFBFA}
figure img.r{border-top:1px solid rgba(0,0,0,.06);aspect-ratio:16/9;object-fit:cover}
figcaption{padding:11px 14px 13px;display:flex;align-items:baseline;gap:9px}
figcaption b{font-size:.95rem;font-weight:900;color:#1F3A5F}
figcaption .n{font-size:.84rem;font-weight:700;flex:1}
figcaption .c{font-size:.66rem;color:#6E6B66}
footer{text-align:center;font-size:.68rem;color:#9C9892;padding:0 20px 40px}
@media print{body{background:#fff}figure{break-inside:avoid}}
</style></head>
<body>
<header><div class="hd">
  <h1>${esc(title)}</h1>
  <span class="s">solarich 着せ替えシートシミュレーション　${cats.length}カテゴリー / ${total}案</span>
  <span class="d">${esc(today)}</span>
</div></header>
<main>${body}</main>
<footer>solarich 着せ替えシートシミュレーション｜このファイルは書き出し時点の内容です</footer>
</body></html>`;
}

$("btnExpHtml").addEventListener("click", async () => {
  if (!S.base || !S.mask) { alert("画像の読み込みが終わっていません。"); return; }
  const filled = Object.values(S.items).filter(i => i.applied);
  const msg = $("expMsg");
  if (!filled.length) { msg.className = "saves-msg err"; msg.textContent = "登録済みの案がありません。"; return; }

  const btn = $("btnExpHtml"); btn.disabled = true;
  msg.className = "saves-msg"; msg.textContent = "書き出し中…";
  try {
    const data = S.currentSlot ? await DB.get(slotKey(S.currentSlot)) : null;
    const title = (data && data.title) || "solarich 着せ替えシートシミュレーション";
    const today = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
    const html = buildShareHtml(title, today);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName(title)}_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    msg.className = "saves-msg ok";
    msg.textContent = `書き出しました（${Math.round(blob.size / 1024)}KB）。そのまま送れます。`;
  } catch (e) {
    msg.className = "saves-msg err";
    msg.textContent = "書き出せませんでした：" + e.message;
  } finally { btn.disabled = false; }
});

$("btnExpPng").addEventListener("click", async () => {
  if (!S.base || !S.mask) { alert("画像の読み込みが終わっていません。"); return; }
  const filled = Object.values(S.items).filter(i => i.applied);
  const msg = $("expMsg");
  if (!filled.length) { msg.className = "saves-msg err"; msg.textContent = "登録済みの案がありません。"; return; }

  const btn = $("btnExpPng"); btn.disabled = true;
  msg.className = "saves-msg"; msg.textContent = "書き出し中…";
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const today = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
    const pages = [["01_全体マップ", pngOverview()]];
    let n = 1;
    for (const cat of CATALOG) {
      const items = cat.items.map(ci => S.items[ci.id]).filter(i => i.applied);
      if (!items.length) continue;
      n++;
      pages.push([`${String(n).padStart(2, "0")}_${safeName(catNameOf(cat.id))}`, pngCategory(cat, items, today)]);
    }
    for (const [name, cv] of pages) await downloadCanvas(cv, name + ".png");
    msg.className = "saves-msg ok";
    msg.textContent = `${pages.length}枚を書き出しました。`;
  } catch (e) {
    msg.className = "saves-msg err";
    msg.textContent = "書き出せませんでした：" + e.message;
  } finally { btn.disabled = false; }
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
  img.src = "assets/base.png?v=202608260011";
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
  img.src = "assets/cutpass.svg?v=202608260011";
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
  img.src = "assets/shadow.png?v=202608260011";
})();

/* 印字レイヤー（assets/print.svg） */
fetch("assets/print.svg?v=202608260011")
  .then(r => r.ok ? r.text() : Promise.reject(new Error(r.status)))
  .then(t => {
    S.printSrc = t;
    Object.keys(S.items).forEach(refreshCard);
    if (S.current) repaintDetail();
  })
  .catch(() => { console.warn("assets/print.svg を読み込めませんでした"); });

buildCatalog();
