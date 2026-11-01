"use strict";

const $ = (selector) => document.querySelector(selector);
const sample = "4 皮卡丘 151c 025\n4 妙蛙种子 csve2c 001\n1 花舞鸟 csjc 001";
const staticMode = location.hostname.endsWith("github.io");
const fileMode = location.protocol === "file:";
const cardsById = new Map();
let rows = [];
let busy = false;
let deckTitle = "";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const selected = () => rows
  .filter((row) => row.selected_id && !row.error)
  .map((row) => ({id: row.selected_id, count: row.count}));

const setStatus = (selector, text, error = false) => {
  $(selector).textContent = text;
  $(selector).classList.toggle("error", error);
};

function updateSummary() {
  const entries = selected();
  const count = entries.reduce((sum, item) => sum + item.count, 0);
  const ready = rows.length > 0 && entries.length === rows.length && count > 0 && count <= 240;
  $("#card-summary").textContent = rows.length ? `${count} 张 · ${rows.length - entries.length} 行待确认` : "等待导入";
  $("#page-summary").textContent = ready ? `${count} 张卡牌 · ${Math.ceil(count / 9)} 页 A4` : "确认卡牌后即可生成";
  $("#download").disabled = busy || !ready;
  $("#export-deck").disabled = busy || !ready;
  $("#import-link").disabled = busy;
  $("#resolve").disabled = busy;
}

function cardImage(card) {
  const image = el("img");
  image.src = staticMode && card.image_url
    ? card.image_url
    : `/api/image/${encodeURIComponent(card.id)}`;
  image.alt = card.local_name || "卡组卡图";
  image.loading = "lazy";
  image.addEventListener("error", () => {
    image.alt = "卡图加载失败，生成 PDF 时会重新尝试";
    setStatus("#export-status", "有卡图加载失败，生成 PDF 时会重新尝试。", true);
  });
  return image;
}

function render() {
  const cards = $("#cards");
  cards.replaceChildren();
  rows.forEach((row, index) => {
    const card = row.candidates?.find((item) => item.id === row.selected_id);
    if (card && !row.error) {
      const box = el("article", "card");
      const details = card.source === "jihuanshe"
        ? "集换社 · 原图"
        : `${card.card_set_id} · ${card.card_number || "无编号"}`;
      box.append(cardImage(card), el("h3", "", card.local_name), el("small", "", details));
      const controls = el("div", "card-controls");
      const quantity = el("input");
      quantity.type = "number";
      quantity.min = "1";
      quantity.max = "240";
      quantity.value = row.count;
      quantity.setAttribute("aria-label", `${card.local_name}的数量`);
      quantity.addEventListener("change", () => {
        const value = Number(quantity.value);
        if (Number.isInteger(value) && value >= 1 && value <= 240) {
          row.count = value;
          updateSummary();
        } else {
          quantity.value = row.count;
        }
      });
      const remove = el("button", "remove", "移除");
      remove.setAttribute("aria-label", `移除${card.local_name}`);
      remove.addEventListener("click", () => {
        rows.splice(index, 1);
        render();
      });
      controls.append(quantity, remove);
      box.append(controls);
      cards.append(box);
    } else {
      const box = el("article", "unresolved");
      box.append(el("h3", "", `第 ${row.line} 行 · ${row.raw}`));
      box.append(el("p", "", row.error || row.warning || "请选择要打印的版本："));
      const candidates = el("div", "candidates");
      (row.candidates || []).forEach((option) => {
        const choose = el("button", "candidate");
        choose.append(cardImage(option), el("div", "", `${option.local_name} ${option.card_set_id} ${option.card_number || ""}`));
        choose.addEventListener("click", () => {
          row.selected_id = option.id;
          render();
        });
        candidates.append(choose);
      });
      box.append(candidates);
      cards.append(box);
    }
  });
  if (!rows.length) cards.append(el("p", "muted", "卡组为空，请重新导入清单。"));
  updateSummary();
}

async function request(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `请求失败（${response.status}）`);
  }
  return response;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = el("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function pdfFileName() {
  const stem = (deckTitle || "简中卡组")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "")
    .slice(0, 100);
  return `${stem || "简中卡组"}_打印.pdf`;
}

function normalizeShareUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !["jihuanshe.com", "www.jihuanshe.com"].includes(parsed.hostname)) {
    throw new Error("只支持 www.jihuanshe.com 的卡组分享链接。");
  }
  if (parsed.pathname.replace(/\/$/, "") !== "/app/userCardSet") {
    throw new Error("这不是集换社卡组分享页面。");
  }
  if (parsed.port || parsed.username || parsed.password) {
    throw new Error("分享链接格式无效。");
  }
  const deckId = parsed.searchParams.get("marketDeckUuid") || "";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{15,79}$/.test(deckId)) {
    throw new Error("分享链接中的卡组编号无效。");
  }
  if ((parsed.searchParams.get("gameKey") || "").toLowerCase() !== "pkm") {
    throw new Error("当前只支持宝可梦卡组。");
  }
  const language = (parsed.searchParams.get("language") || "").toLowerCase();
  if (language && language !== "sc") {
    throw new Error("当前只支持简中卡组。");
  }
  const normalized = new URL("https://www.jihuanshe.com/app/userCardSet");
  normalized.search = new URLSearchParams({
    marketDeckUuid: deckId,
    gameKey: "pkm",
    language: "sc",
  });
  return {url: normalized.toString(), deckId};
}

function validateImageUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:"
      || parsed.hostname !== "jihuanshe-r2-imagex.jihuanshe.com"
      || !parsed.pathname.startsWith("/pkm/card_versions/")
      || !/\.(?:jpe?g|png)$/i.test(parsed.pathname)
      || parsed.port || parsed.username || parsed.password) {
    throw new Error("集换社返回了不受支持的卡图地址。");
  }
  return parsed.toString();
}

async function fetchShareDeck(value) {
  const share = normalizeShareUrl(value);
  const endpoint = new URL("https://api.jihuanshe.com/api/market/share/market-deck");
  endpoint.search = new URLSearchParams({
    market_deck_uuid: share.deckId,
    url: share.url,
  });
  const response = await fetch(endpoint, {
    headers: {"Accept": "application/json"},
    mode: "cors",
  });
  if (!response.ok) throw new Error(`集换社请求失败（${response.status}）。`);
  const payload = await response.json();
  if (!payload || payload.error || !Array.isArray(payload.market_deck_cards)) {
    throw new Error(payload?.msg || "集换社没有返回有效卡组。");
  }
  const grouped = new Map();
  const order = [];
  for (const group of payload.market_deck_cards) {
    if (!Array.isArray(group?.cards)) throw new Error("集换社卡组数据无效。");
    for (const item of group.cards) {
      const count = item?.count;
      if (!Number.isInteger(count) || count < 1 || count > 240) {
        throw new Error("集换社卡组中的数量无效。");
      }
      const imageUrl = validateImageUrl(item.image_url);
      if (!grouped.has(imageUrl)) {
        order.push(imageUrl);
        grouped.set(imageUrl, {
          id: imageUrl,
          image_url: imageUrl,
          local_name: "",
          name: "",
          source: "jihuanshe",
          count,
        });
      } else {
        grouped.get(imageUrl).count += count;
      }
    }
  }
  const cards = order.map((imageUrl) => grouped.get(imageUrl));
  if (!cards.length) throw new Error("分享中没有找到卡牌。");
  cards.forEach((card, index) => {
    card.local_name = `卡图 ${String(index + 1).padStart(2, "0")}`;
    if (card.count > 240) throw new Error("单张卡的数量超过限制。");
  });
  const total = cards.reduce((sum, card) => sum + card.count, 0);
  if (total > 240) throw new Error("单次最多生成 240 张卡牌。");
  const title = String(payload.market_deck_name || "集换社卡组").replace(/\s+/g, " ").trim().slice(0, 120);
  const environment = String(payload.market_deck_environment_name || "").trim().slice(0, 80);
  return {
    title: title || "集换社卡组",
    environment,
    total,
    cards,
    warnings: total === 60 ? [] : [`这套卡组共有 ${total} 张，仍可打印。`],
  };
}

async function importShareDeck(url) {
  if (staticMode) return fetchShareDeck(url);
  return (await (await request("/api/jihuanshe/import", {url})).json()).deck;
}

function imageBytesKind(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  return "other";
}

async function embedNetworkImage(pdf, url) {
  const response = await fetch(url, {mode: "cors"});
  if (!response.ok) throw new Error(`卡图下载失败（${response.status}）。`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 10 * 1024 * 1024) throw new Error("卡图超过 10 MB。");
  const kind = imageBytesKind(bytes);
  if (kind === "jpg") return pdf.embedJpg(bytes);
  if (kind === "png") return pdf.embedPng(bytes);
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const png = new Uint8Array(await (await new Promise((resolve) => canvas.toBlob(resolve, "image/png"))).arrayBuffer());
  return pdf.embedPng(png);
}

async function createBrowserPdf(entries, widthMm, heightMm, gapMm, cropMarks) {
  if (!window.PDFLib) throw new Error("PDF 生成库没有加载，请刷新页面重试。");
  const {PDFDocument, rgb} = window.PDFLib;
  const expanded = [];
  for (const entry of entries) {
    if (!Number.isInteger(entry.count) || entry.count < 1) throw new Error("卡牌数量无效。");
    for (let index = 0; index < entry.count; index += 1) expanded.push(entry.id);
    if (expanded.length > 240) throw new Error("单次最多生成 240 张卡牌。");
  }
  if (!expanded.length) throw new Error("请先导入卡牌。");
  const pdf = await PDFDocument.create();
  const uniqueIds = [...new Set(expanded)];
  const images = new Map();
  for (const id of uniqueIds) {
    const card = cardsById.get(id);
    if (!card?.image_url) throw new Error("有卡图缺少下载地址，请重新导入卡组。");
    images.set(id, await embedNetworkImage(pdf, card.image_url));
  }
  const mm = 72 / 25.4;
  const pageWidth = 210 * mm;
  const pageHeight = 297 * mm;
  const cardWidth = widthMm * mm;
  const cardHeight = heightMm * mm;
  const gap = gapMm * mm;
  const left = (pageWidth - cardWidth * 3 - gap * 2) / 2;
  const bottom = (pageHeight - cardHeight * 3 - gap * 2) / 2;
  const pages = Math.ceil(expanded.length / 9);
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = pdf.addPage([pageWidth, pageHeight]);
    const chunk = expanded.slice(pageIndex * 9, pageIndex * 9 + 9);
    chunk.forEach((id, slot) => {
      const row = Math.floor(slot / 3);
      const col = slot % 3;
      const x = left + col * (cardWidth + gap);
      const y = pageHeight - bottom - cardHeight - row * (cardHeight + gap);
      page.drawImage(images.get(id), {x, y, width: cardWidth, height: cardHeight});
      if (cropMarks) {
        const color = rgb(0.55, 0.58, 0.60);
        for (const edgeX of [x, x + cardWidth]) {
          for (const edgeY of [y, y + cardHeight]) {
            const dx = edgeX === x ? -1 : 1;
            const dy = edgeY === y ? -1 : 1;
            page.drawLine({start: {x: edgeX + dx * 0.5 * mm, y: edgeY}, end: {x: edgeX + dx * 1.5 * mm, y: edgeY}, thickness: 0.18, color});
            page.drawLine({start: {x: edgeX, y: edgeY + dy * 0.5 * mm}, end: {x: edgeX, y: edgeY + dy * 1.5 * mm}, thickness: 0.18, color});
          }
        }
      }
    });
    const ink = rgb(0.25, 0.28, 0.30);
    page.drawLine({start: {x: 10 * mm, y: 6 * mm}, end: {x: 60 * mm, y: 6 * mm}, thickness: 0.35, color: ink});
    for (let tick = 0; tick < 6; tick += 1) {
      const x = (10 + tick * 10) * mm;
      page.drawLine({start: {x, y: 5 * mm}, end: {x, y: 7 * mm}, thickness: 0.35, color: ink});
    }
    page.drawText("50 mm calibration", {x: 10 * mm, y: 8.2 * mm, size: 6, color: ink});
    page.drawText(`A4 | ${widthMm} x ${heightMm} mm | Print at 100% | ${pageIndex + 1}/${pages}`, {
      x: pageWidth - 10 * mm - 150,
      y: 6 * mm,
      size: 6,
      color: ink,
    });
  }
  return new Blob([await pdf.save()], {type: "application/pdf"});
}

$("#sample").addEventListener("click", () => {
  $("#deck-text").value = sample;
  setStatus("#import-status", "已填入 9 张卡牌的排版示例，可点击匹配。");
});

$("#deck-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 100_000) {
    setStatus("#import-status", "请选择 100 KB 以内的 TXT 或 CSV 文件。", true);
    return;
  }
  $("#deck-text").value = await file.text();
  setStatus("#import-status", `已读取：${file.name}`);
});

$("#resolve").addEventListener("click", async () => {
  if (busy) return;
  if (staticMode) {
    setStatus("#import-status", "GitHub Pages 版本只支持集换社分享链接；本地版本支持 PikaQian 清单匹配。", true);
    return;
  }
  const deckText = $("#deck-text").value;
  const pastedLink = deckText.match(/https:\/\/www\.jihuanshe\.com\/app\/userCardSet\?[^\s]+/i);
  if (pastedLink) {
    $("#deck-link").value = pastedLink[0];
    $("#deck-link").focus();
    setStatus("#import-status", "检测到集换社分享链接，已填入上方。请点击“读取集换社卡组”。");
    return;
  }
  if (/By:\s*Jihuanshe/i.test(deckText)) {
    setStatus("#import-status", "这是集换社英文分享文本，不含已选定的简中卡图。请把集换社分享链接粘贴到页面上方。", true);
    return;
  }
  busy = true;
  updateSummary();
  setStatus("#import-status", "正在匹配卡图，首次查询某个系列可能需要一点时间…");
  setStatus("#export-status", "");
  try {
    const response = await request("/api/resolve", {text: deckText});
    rows = (await response.json()).rows;
    deckTitle = "";
    cardsById.clear();
    rows.forEach((row) => row.candidates?.forEach((card) => cardsById.set(card.id, card)));
    $("#deck-context").textContent = "核对卡面和数量，有多个版本时请选择对应卡图。";
    render();
    const remaining = rows.filter((row) => row.error || !row.selected_id).length;
    setStatus("#import-status", remaining ? `已读取 ${rows.length} 行，还有 ${remaining} 行需要确认或修正。` : `已匹配全部 ${rows.length} 行，请核对卡面与数量。`);
  } catch (error) {
    setStatus("#import-status", error.message, true);
  } finally {
    busy = false;
    updateSummary();
  }
});

$("#import-link").addEventListener("click", async () => {
  if (busy) return;
  const url = $("#deck-link").value.trim();
  if (!url) {
    setStatus("#share-status", "请先粘贴集换社卡组分享链接。", true);
    return;
  }
  busy = true;
  updateSummary();
  setStatus("#share-status", "正在从集换社读取卡组和原图…");
  setStatus("#export-status", "");
  try {
    const result = await importShareDeck(url);
    deckTitle = result.title;
    cardsById.clear();
    result.cards.forEach((card) => cardsById.set(card.id, card));
    rows = result.cards.map((card, index) => ({
      line: index + 1,
      raw: `${card.local_name} × ${card.count}`,
      count: card.count,
      selected_id: card.id,
      candidates: [card],
      source: "jihuanshe",
    }));
    $("#deck-context").textContent = `${result.title}${result.environment ? " · " + result.environment : ""} · 原卡图`;
    render();
    const warning = result.warnings?.[0] || "";
    setStatus("#share-status", `已读取 ${result.total} 张卡牌、${result.cards.length} 种原图。${warning ? " " + warning : " 请核对卡面。"}`);
  } catch (error) {
    setStatus("#share-status", error.message, true);
  } finally {
    busy = false;
    updateSummary();
  }
});

$("#download").addEventListener("click", async () => {
  if (busy) return;
  const width = Number($("#card-width").value);
  const height = Number($("#card-height").value);
  const gap = Number($("#card-gap").value);
  if (width < 60 || width > 64 || height < 85 || height > 89 || gap < 0 || gap > 4) {
    setStatus("#export-status", "宽度须为 60—64 mm，高度须为 85—89 mm，间距须为 0—4 mm。", true);
    return;
  }
  busy = true;
  updateSummary();
  setStatus("#export-status", "正在准备卡图和生成 PDF…");
  try {
    const entries = selected();
    const blob = staticMode
      ? await createBrowserPdf(entries, width, height, gap, $("#crop-marks").checked)
      : await (await request("/api/pdf", {
        entries,
        options: {width_mm: width, height_mm: height, gap_mm: gap, crop_marks: $("#crop-marks").checked},
      })).blob();
    const name = pdfFileName();
    download(blob, name);
    setStatus("#export-status", `PDF 已生成：${name}。打印请选择实际大小 / 100%。`);
  } catch (error) {
    setStatus("#export-status", error.message, true);
  } finally {
    busy = false;
    updateSummary();
  }
});

$("#export-deck").addEventListener("click", () => {
  const text = rows.map((row) => {
    const card = cardsById.get(row.selected_id);
    if (!card) return "";
    if (card.source === "jihuanshe") return `${row.count} ${card.local_name}`;
    return `${row.count} ${card.local_name} ${card.card_set_id} ${card.card_number || ""}`.trim();
  }).filter(Boolean).join("\n");
  const heading = deckTitle ? `${deckTitle}\n\n` : "";
  download(new Blob([heading + text], {type: "text/plain;charset=utf-8"}), "简中卡组.txt");
});

if (fileMode) {
  $("#protocol-warning").hidden = false;
  ["#import-link", "#resolve", "#sample", "#deck-file", "#download", "#export-deck"]
    .forEach((selector) => {$(selector).disabled = true;});
  setStatus("#share-status", "请通过 GitHub Pages 或本地服务器访问，不要直接打开 HTML 文件。", true);
} else if (staticMode) {
  $("#mode-badge").textContent = "GitHub Pages";
  $("#resolve").title = "GitHub Pages 版本仅支持集换社分享链接";
}
