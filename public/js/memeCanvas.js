// Petit moteur de rendu "meme classique" : image de fond + texte haut/bas
// en Impact blanc contour noir. Utilisé aussi bien pour le mode Classique
// (template fourni par le serveur) que pour le mode Upload perso (image
// choisie par le joueur) : seule la source de l'image change.
const MemeCanvas = (() => {
  let canvas, ctx;
  let baseImage = null;
  let topText = '';
  let bottomText = '';

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        baseImage = img;
        fitCanvasToImage(img);
        render();
        resolve();
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  function fitCanvasToImage(img) {
    const maxW = 700;
    const ratio = img.height / img.width;
    canvas.width = maxW;
    canvas.height = Math.round(maxW * ratio);
  }

  function setTopText(t) { topText = t; render(); }
  function setBottomText(t) { bottomText = t; render(); }

  function wrapLines(text, maxWidth) {
    const words = text.toUpperCase().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, 3);
  }

  function drawStrokedText(lines, startY, lineHeight, fontSize) {
    ctx.font = `${fontSize}px Anton, Impact, 'Arial Narrow Bold', sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = Math.max(3, fontSize / 12);
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    lines.forEach((line, i) => {
      const y = startY + i * lineHeight;
      ctx.strokeText(line, canvas.width / 2, y);
      ctx.fillText(line, canvas.width / 2, y);
    });
  }

  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (baseImage) {
      ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const fontSize = Math.max(24, Math.round(canvas.width / 11));
    const lineHeight = fontSize * 1.05;
    const maxWidth = canvas.width * 0.92;
    ctx.font = `${fontSize}px Anton, Impact, sans-serif`;

    if (topText) {
      const lines = wrapLines(topText, maxWidth);
      drawStrokedText(lines, fontSize * 1.05, lineHeight, fontSize);
    }
    if (bottomText) {
      const lines = wrapLines(bottomText, maxWidth);
      const totalH = lines.length * lineHeight;
      drawStrokedText(lines, canvas.height - totalH + fontSize * 0.75, lineHeight, fontSize);
    }
  }

  function toDataURL(quality = 0.85) {
    return canvas.toDataURL('image/jpeg', quality);
  }

  function hasImage() {
    return !!baseImage;
  }

  return { init, loadImage, setTopText, setBottomText, render, toDataURL, hasImage };
})();
