const $ = (s) => document.querySelector(s);
const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v) => (v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const dataBR = (d) => new Date(d).toLocaleDateString('pt-BR');
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeMes = (m) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let CATEGORIAS = [];
let IA = false;
let painel = null;
let catFiltro = 'Todas';
const graficos = {};

async function api(url, opcoes = {}) {
  const r = await fetch(url, {
    ...opcoes,
    headers: opcoes.body && !(opcoes.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
  });
  if (r.status === 401 && !url.endsWith('/entrar')) { mostrarLogin(); throw new Error('Entre com a senha.'); }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'Erro ' + r.status);
  return dados;
}

function aviso(msg) {
  const el = $('#aviso');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (el.hidden = true), 3000);
}

// ---------- login ----------
function mostrarLogin() { $('#app').hidden = true; $('#tela-login').hidden = false; $('#senha').focus(); }

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#erro-login').textContent = '';
  try {
    await api('/api/entrar', { method: 'POST', body: JSON.stringify({ senha: $('#senha').value }) });
    $('#senha').value = '';
    iniciar();
  } catch (err) { $('#erro-login').textContent = err.message; }
});

$('#btn-sair').addEventListener('click', async () => { await api('/api/sair', { method: 'POST' }); mostrarLogin(); });

// ---------- abas ----------
const TITULOS = { inicio: 'Início', nota: 'Nova nota', produtos: 'Produtos', lista: 'Lista de compras' };
function irPara(aba) {
  document.querySelectorAll('.aba').forEach((s) => (s.hidden = s.id !== 'aba-' + aba));
  document.querySelectorAll('.abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  $('#titulo').textContent = TITULOS[aba];
  window.scrollTo(0, 0);
}
document.querySelectorAll('.abas button').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.aba)));

// ---------- início ----------
async function carregar() {
  const [p, compras] = await Promise.all([api('/api/painel'), api('/api/compras')]);
  painel = p;
  desenharInicio(compras);
  desenharProdutos();
  desenharLista();
}

function desenharInicio(compras) {
  const meses = painel.meses;
  const atual = new Date().toISOString().slice(0, 7);
  const mAtual = meses.find((m) => m.mes === atual) || { mes: atual, gasto: 0, economia: 0, categorias: {} };
  const anterior = meses.filter((m) => m.mes < atual).pop();
  $('#mes-atual').textContent = nomeMes(atual);
  $('#gasto-mes').textContent = brl(mAtual.gasto);
  $('#comp-mes').textContent = anterior ? `${nomeMes(anterior.mes)}: ${brl(anterior.gasto)}` : `${mAtual.compras || 0} compra(s)`;
  $('#economia-mes').textContent = brl(mAtual.economia);

  if (painel.inflacao) {
    $('#inflacao').textContent = pct(painel.inflacao.variacao);
    $('#inflacao-sub').textContent = `em ${painel.inflacao.produtos} produtos que você repete`;
  }

  // gráfico dos últimos 12 meses
  const ult = meses.slice(-12);
  graficos.meses?.destroy();
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--verde').trim();
  graficos.meses = new Chart($('#graf-meses'), {
    type: 'bar',
    data: { labels: ult.map((m) => nomeMes(m.mes)), datasets: [{ data: ult.map((m) => m.gasto), backgroundColor: cor, borderRadius: 6 }] },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => brl(c.raw) } } },
      scales: { y: { ticks: { callback: (v) => 'R$ ' + v } }, x: { grid: { display: false } } },
    },
  });

  // categorias do último mês com compra
  const mCat = meses[meses.length - 1];
  const cats = Object.entries(mCat?.categorias || {}).sort((a, b) => b[1] - a[1]);
  const maior = cats[0]?.[1] || 1;
  $('#cat-mes').textContent = mCat ? nomeMes(mCat.mes) : '';
  $('#categorias').innerHTML = cats.length
    ? cats.map(([c, v]) => `<div class="barra"><span>${esc(c)}</span><b>${brl(v)}</b><div class="trilho"><i style="width:${(v / maior) * 100}%"></i></div></div>`).join('')
    : '<p class="dica">Lance a primeira nota para ver aqui.</p>';

  $('#bloco-alertas').hidden = !painel.alertas.length;
  $('#alertas').innerHTML = painel.alertas.slice(0, 8).map((p) => `
    <li data-produto="${esc(p.codigo)}">
      <div><div class="nome">${esc(p.nome)}</div><div class="meta">agora ${brl(p.ultimo_preco)}</div></div>
      <span class="selo ${p.variacao_ultima > 0 ? 'sobe' : 'desce'}">${pct(p.variacao_ultima)}</span>
    </li>`).join('');

  $('#compras').innerHTML = compras.length
    ? compras.slice(0, 20).map((c) => `
      <li data-compra="${c.id}">
        <div><div class="nome">${esc(c.loja || 'Compra')}</div><div class="meta">${dataBR(c.data)} · ${c.itens} itens${Number(c.desconto_total) ? ' · economizou ' + brl(c.desconto_total) : ''}</div></div>
        <span class="valor">${brl(c.total)}</span>
      </li>`).join('')
    : '<li class="vazio">Nenhuma compra ainda. Toque em "Nova nota".</li>';
}

// ---------- produtos ----------
function desenharProdutos() {
  const cats = ['Todas', ...new Set(painel.produtos.map((p) => p.categoria))];
  $('#chips-cat').innerHTML = cats.map((c) => `<button class="${c === catFiltro ? 'ativa' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  const termo = $('#busca').value.trim().toLowerCase();
  const lista = painel.produtos.filter((p) =>
    (catFiltro === 'Todas' || p.categoria === catFiltro) &&
    (!termo || p.nome.toLowerCase().includes(termo) || p.descricao.toLowerCase().includes(termo)));
  $('#produtos').innerHTML = lista.length
    ? lista.map((p) => `
      <li data-produto="${esc(p.codigo)}">
        <div><div class="nome">${esc(p.nome)}</div><div class="meta">${p.vezes}× · ${p.quantidade_total} un · total ${brl(p.gasto_total)}</div></div>
        <div class="valor">${brl(p.ultimo_preco)}${p.variacao_total ? `<br><span class="selo ${p.variacao_total > 0 ? 'sobe' : 'desce'}">${pct(p.variacao_total)}</span>` : ''}</div>
      </li>`).join('')
    : '<li class="vazio">Nenhum produto encontrado.</li>';
}
$('#busca').addEventListener('input', desenharProdutos);
$('#chips-cat').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) { catFiltro = b.dataset.cat; desenharProdutos(); }
});

// ---------- lista sugerida ----------
function desenharLista() {
  let marcados = {};
  try { marcados = JSON.parse(localStorage.getItem('lista-marcados') || '{}'); } catch {}
  $('#lista-compras').innerHTML = painel.lista.length
    ? painel.lista.map((p) => `
      <li data-marcar="${esc(p.codigo)}" style="${marcados[p.codigo] ? 'opacity:.45;text-decoration:line-through' : ''}">
        <div><div class="nome">${marcados[p.codigo] ? '✅' : '⬜'} ${esc(p.nome)}</div>
        <div class="meta">compra a cada ${p.intervalo_dias} dias · ${p.faltam_dias <= 0 ? 'já deve ter acabado' : `acaba em ~${p.faltam_dias} dias`}</div></div>
        <div class="valor">${p.quantidade_media}× ${brl(p.ultimo_preco)}</div>
      </li>`).join('')
    : '<li class="vazio">A lista aparece quando houver pelo menos 2 compras do mesmo produto.</li>';
}
$('#lista-compras').addEventListener('click', (e) => {
  const li = e.target.closest('[data-marcar]');
  if (!li) return;
  let m = {};
  try { m = JSON.parse(localStorage.getItem('lista-marcados') || '{}'); } catch {}
  m[li.dataset.marcar] = !m[li.dataset.marcar];
  try { localStorage.setItem('lista-marcados', JSON.stringify(m)); } catch {}
  desenharLista();
});

// ---------- detalhe (produto ou compra) ----------
document.addEventListener('click', (e) => {
  const prod = e.target.closest('[data-produto]');
  const comp = e.target.closest('[data-compra]');
  if (prod) abrirProduto(prod.dataset.produto);
  else if (comp) abrirCompra(comp.dataset.compra);
});
$('#det-fechar').addEventListener('click', () => $('#detalhe').close());

async function abrirProduto(codigo) {
  const p = await api('/api/produtos/' + encodeURIComponent(codigo));
  const h = p.historico;
  const precos = h.map((x) => x.preco_unit);
  $('#det-titulo').textContent = p.nome || p.descricao;
  $('#det-corpo').innerHTML = `
    <div class="meta">${esc(p.descricao)} · ${esc(codigo.startsWith('int:') ? 'código da loja' : 'EAN ' + codigo)}</div>
    <div class="mini-cards">
      <div><b>${brl(precos.at(-1))}</b><span>último</span></div>
      <div><b>${brl(Math.min(...precos))}</b><span>menor</span></div>
      <div><b>${brl(Math.max(...precos))}</b><span>maior</span></div>
    </div>
    <div class="bloco"><h2>Preço por compra</h2><div class="grafico"><canvas id="graf-preco"></canvas></div></div>
    <div class="bloco"><h2>Consumo por mês</h2><div class="grafico"><canvas id="graf-consumo"></canvas></div></div>
    <div class="bloco"><h2>Editar</h2>
      <div class="edicao">
        <input id="ed-nome" value="${esc(p.nome || '')}" placeholder="Nome curto">
        <select id="ed-cat">${CATEGORIAS.map((c) => `<option ${c === p.categoria ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div>
      <button id="ed-salvar" class="btn primario grande" style="margin-top:8px">Salvar</button>
    </div>`;
  $('#detalhe').showModal();
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--verde').trim();
  graficos.preco?.destroy();
  graficos.preco = new Chart($('#graf-preco'), {
    type: 'line',
    data: {
      labels: h.map((x) => dataBR(x.data)),
      datasets: [
        { label: 'Preço', data: precos, borderColor: cor, backgroundColor: cor, tension: .25 },
        { label: 'Pago (com desconto)', data: h.map((x) => x.preco_pago), borderColor: '#999', borderDash: [4, 4], pointRadius: 2 },
      ],
    },
    options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + brl(c.raw) } } } },
  });
  graficos.consumo?.destroy();
  graficos.consumo = new Chart($('#graf-consumo'), {
    type: 'bar',
    data: { labels: p.consumo.map((m) => nomeMes(m.mes)), datasets: [{ data: p.consumo.map((m) => m.quantidade), backgroundColor: cor, borderRadius: 6 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
  $('#ed-salvar').addEventListener('click', async () => {
    await api('/api/produtos/' + encodeURIComponent(codigo), {
      method: 'PATCH', body: JSON.stringify({ nome: $('#ed-nome').value, categoria: $('#ed-cat').value }),
    });
    $('#detalhe').close();
    aviso('Produto atualizado');
    carregar();
  });
}

async function abrirCompra(id) {
  const c = await api('/api/compras/' + id);
  $('#det-titulo').textContent = `${c.loja || 'Compra'} · ${dataBR(c.data)}`;
  $('#det-corpo').innerHTML = `
    <div class="mini-cards">
      <div><b>${brl(c.total)}</b><span>total</span></div>
      <div><b>${c.itens.length}</b><span>linhas</span></div>
      <div><b>${brl(c.desconto_total)}</b><span>descontos</span></div>
    </div>
    <div class="bloco"><ul class="lista">${c.itens.map((i) => `
      <li data-produto="${esc(i.produto_codigo)}"><div><div class="nome">${esc(i.nome || i.descricao)}</div>
      <div class="meta">${Number(i.quantidade)} ${esc(i.unidade || '')} × ${brl(i.preco_unit)}${Number(i.desconto) ? ' · desc. ' + brl(i.desconto) : ''}</div></div>
      <span class="valor">${brl(i.valor_total)}</span></li>`).join('')}</ul></div>
    <button id="btn-apagar" class="btn perigo grande">Apagar esta compra</button>`;
  $('#detalhe').showModal();
  $('#btn-apagar').addEventListener('click', async () => {
    if (!confirm('Apagar esta compra e todos os itens dela?')) return;
    await api('/api/compras/' + id, { method: 'DELETE' });
    $('#detalhe').close();
    aviso('Compra apagada');
    carregar();
  });
}

// ---------- nova nota ----------
let fotos = [];
let rascunho = null;

// reduz a foto no celular antes de enviar (cupom continua legível)
function reduzir(arquivo, lado = 2200) {
  return new Promise((ok, erro) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, lado / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k);
      cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((b) => (b ? ok(b) : erro(new Error('Foto inválida'))), 'image/jpeg', 0.85);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => erro(new Error('Não consegui abrir a foto'));
    img.src = URL.createObjectURL(arquivo);
  });
}

function desenharMiniaturas() {
  $('#miniaturas').innerHTML = fotos.map((f, i) => `<div><img src="${f.url}" alt="Foto ${i + 1}"><button data-tirar="${i}" aria-label="Remover">✕</button></div>`).join('');
  $('#btn-ler').hidden = !fotos.length;
  $('#btn-ler-ia').hidden = !fotos.length || !IA;
}

$('#fotos').addEventListener('change', async (e) => {
  for (const arq of e.target.files) {
    try {
      const blob = await reduzir(arq);
      fotos.push({ blob, url: URL.createObjectURL(blob) });
    } catch (err) { aviso(err.message); }
  }
  e.target.value = '';
  desenharMiniaturas();
});
$('#miniaturas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tirar]');
  if (b) { fotos.splice(Number(b.dataset.tirar), 1); desenharMiniaturas(); }
});

// bibliotecas pesadas só carregam quando usadas
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const scripts = {};
function carregarScript(url) {
  scripts[url] ??= new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = ok;
    s.onerror = () => { delete scripts[url]; erro(new Error('Sem internet para carregar o leitor.')); };
    document.head.appendChild(s);
  });
  return scripts[url];
}

function imagemDe(blob) {
  return new Promise((ok, erro) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => erro(new Error('Não consegui abrir a foto'));
    img.src = URL.createObjectURL(blob);
  });
}

// procura o QR Code da NFC-e na foto (inteira e na metade de baixo, onde ele costuma ficar)
async function lerQr(blob) {
  await carregarScript(JSQR);
  const img = await imagemDe(blob);
  const tentativas = [[0, 0, img.width, img.height], [0, img.height / 2, img.width, img.height / 2]];
  for (const [x, y, w, h] of tentativas) {
    for (const lado of [1400, 900]) {
      const k = Math.min(1, lado / Math.max(w, h));
      const cv = document.createElement('canvas');
      cv.width = Math.round(w * k);
      cv.height = Math.round(h * k);
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, x, y, w, h, 0, 0, cv.width, cv.height);
      const r = jsQR(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
      if (r?.data) return r.data;
    }
  }
  return null;
}

const chaveDoQr = (url) => (String(url || '').match(/(?:p=|chNFe=)(\d{44})/i) || [])[1] || null;

function lendo(texto) {
  $('#lendo').hidden = !texto;
  if (texto) $('#lendo-txt').textContent = texto;
}

// leitura grátis: o texto é reconhecido no próprio celular e o servidor monta os itens
$('#btn-ler').addEventListener('click', async () => {
  $('#btn-ler').hidden = true;
  $('#btn-ler-ia').hidden = true;
  $('#erro-nota').textContent = '';
  try {
    lendo('Preparando o leitor… (na primeira vez baixa uns 15 MB)');
    await carregarScript(TESSERACT);
    let atual = 0;
    const worker = await Tesseract.createWorker('por', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') lendo(`Lendo foto ${atual + 1} de ${fotos.length}… ${Math.round(m.progress * 100)}%`);
      },
    });
    const textos = [];
    let chave = null;
    for (atual = 0; atual < fotos.length; atual++) {
      const { data } = await worker.recognize(fotos[atual].blob);
      textos.push(data.text);
      chave ||= chaveDoQr(await lerQr(fotos[atual].blob).catch(() => null));
    }
    await worker.terminate();
    lendo('Montando os itens…');
    const r = await api('/api/leitura-texto', { method: 'POST', body: JSON.stringify({ textos, chave }) });
    rascunho = r.nota;
    mostrarRevisao(r);
  } catch (err) {
    $('#erro-nota').textContent = err.message;
    desenharMiniaturas();
  } finally {
    lendo(null);
  }
});

// leitura por IA (só aparece se o servidor tiver a chave)
$('#btn-ler-ia').addEventListener('click', async () => {
  const fd = new FormData();
  fotos.forEach((f, i) => fd.append('fotos', f.blob, `foto${i + 1}.jpg`));
  $('#btn-ler').hidden = true;
  $('#btn-ler-ia').hidden = true;
  lendo('Lendo o cupom com IA… pode levar até 1 minuto.');
  $('#erro-nota').textContent = '';
  try {
    const r = await api('/api/leitura', { method: 'POST', body: fd });
    rascunho = r.nota;
    mostrarRevisao(r);
  } catch (err) {
    $('#erro-nota').textContent = err.message;
    desenharMiniaturas();
  } finally {
    lendo(null);
  }
});

// ---------- nota da SEFAZ pelo QR Code ----------
let chaveSefaz = null;

$('#foto-qr').addEventListener('change', async (e) => {
  const arq = e.target.files[0];
  e.target.value = '';
  if (!arq) return;
  $('#qr-info').textContent = 'Procurando o QR Code…';
  try {
    const url = await lerQr(arq);
    if (!url || !/^https?:\/\//i.test(url)) throw new Error('Não achei o QR Code. Fotografe de perto, só o QR, sem reflexo.');
    chaveSefaz = chaveDoQr(url);
    // o "|" do link quebra em vários celulares; codificado, abre normal
    $('#link-sefaz').href = url.replace(/\|/g, '%7C');
    $('#link-sefaz').hidden = false;
    $('#qr-info').textContent = chaveSefaz ? `Nota encontrada (chave …${chaveSefaz.slice(-8)}). Toque em "Abrir nota na SEFAZ".` : 'QR Code lido.';
  } catch (err) {
    $('#qr-info').textContent = err.message;
  }
});

// Lê o texto da nota da SEFAZ; se a soma bater com o total e nada precisar de conferência, já salva
async function processarSefaz(texto, url) {
  irPara('nota');
  $('#erro-nota').textContent = '';
  lendo('Lendo a nota da SEFAZ…');
  try {
    const r = await api('/api/leitura-sefaz', {
      method: 'POST', body: JSON.stringify({ texto, url: url || null, chave: chaveDoQr(url) || chaveSefaz }),
    });
    const n = r.nota;
    const bate = Math.abs(r.conferencia.diferenca) < 0.01 && n.data && !n.itens.some((i) => i.conferir);
    if (bate && !r.duplicada) {
      await api('/api/compras', { method: 'POST', body: JSON.stringify({ nota: { ...n, data: n.data.length === 19 ? n.data + '-03:00' : n.data } }) });
      aviso(`Nota salva: ${n.itens.length} itens, ${brl(n.total)}`);
      $('#texto-sefaz').value = '';
      await carregar();
      irPara('inicio');
    } else {
      rascunho = n;
      mostrarRevisao(r);
      if (!r.duplicada) aviso('Confira a nota antes de salvar');
    }
  } catch (err) {
    $('#erro-nota').textContent = err.message;
  } finally {
    lendo(null);
  }
}

$('#btn-ler-sefaz').addEventListener('click', () => processarSefaz($('#texto-sefaz').value, null));

$('#btn-colar-sefaz').addEventListener('click', async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (!t.trim()) return aviso('Nada copiado ainda.');
    $('#texto-sefaz').value = t;
    processarSefaz(t, null);
  } catch {
    aviso('O navegador não deixou colar. Segure o dedo na caixa e escolha Colar.');
  }
});

// ---------- favorito "Enviar ao Mercado" ----------
// Roda na página da SEFAZ: copia o texto (reserva), abre o app e entrega a nota quando o app avisar que está pronto
function codigoFavorito() {
  const A = location.origin;
  const js = `(function(){var A='${A}';var t=document.body.innerText,u=location.href;`
    + `try{navigator.clipboard.writeText(t).catch(function(){})}catch(e){}`
    + `var w=window.open(A+'/#sefaz','mercado');if(!w){alert('Permita janelas pop-up para enviar a nota ao Mercado.');return}`
    + `var ok=0;window.addEventListener('message',function(e){if(e.origin===A&&e.data==='mercado-pronto'&&!ok){ok=1;w.postMessage({tipo:'nota-sefaz',texto:t,url:u},A)}})})()`;
  return 'javascript:' + encodeURIComponent(js);
}
$('#link-favorito').href = codigoFavorito();
$('#link-favorito').addEventListener('click', (e) => { e.preventDefault(); aviso('Arraste este botão para a barra de favoritos.'); });
$('#btn-copiar-favorito').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(codigoFavorito());
    aviso('Código copiado. Cole no endereço do favorito.');
  } catch {
    prompt('Copie o código abaixo:', codigoFavorito());
  }
});

// só aceita notas vindas de sites da Fazenda/SEFAZ do governo
function origemSefaz(origem) {
  try {
    const h = new URL(origem).hostname;
    return /\.gov\.br$/.test(h) && /fazenda|sefaz|sef\b/.test(h);
  } catch { return false; }
}
window.addEventListener('message', (e) => {
  if (e.data?.tipo !== 'nota-sefaz' || !origemSefaz(e.origin) || typeof e.data.texto !== 'string') return;
  history.replaceState(null, '', location.pathname);
  processarSefaz(e.data.texto, e.data.url);
});

// aberto pelo favorito: avisa a página da SEFAZ que já pode mandar a nota
function anunciarPronto() {
  if (location.hash !== '#sefaz') return;
  irPara('nota');
  if (window.opener) {
    window.opener.postMessage('mercado-pronto', '*');
    lendo('Recebendo a nota da SEFAZ…');
    setTimeout(() => {
      if (location.hash === '#sefaz') {
        lendo(null);
        history.replaceState(null, '', location.pathname);
        $('#erro-nota').textContent = 'A nota não chegou sozinha. Ela foi copiada: toque em "📋 Colar copiado".';
      }
    }, 8000);
  } else {
    $('#erro-nota').textContent = 'A nota foi copiada: toque em "📋 Colar copiado".';
  }
}

function paraInputData(iso) {
  if (!iso) return '';
  return iso.slice(0, 16);
}

function mostrarRevisao(r) {
  $('#nota-envio').hidden = true;
  $('#nota-revisao').hidden = false;
  $('#rev-loja').textContent = rascunho.loja?.nome || 'Compra';
  $('#rev-data').value = paraInputData(rascunho.data);
  $('#rev-obs').hidden = !rascunho.observacoes;
  $('#rev-obs').textContent = rascunho.observacoes ? '⚠️ ' + rascunho.observacoes : '';
  $('#rev-dup').hidden = !r.duplicada;
  $('#rev-dup').textContent = r.duplicada ? `Esta nota já foi lançada em ${dataBR(r.duplicada.data)}.` : '';
  desenharItensRevisao();
}

function atualizarConferencia() {
  const soma = rascunho.itens.reduce((s, i) => s + (Number(i.valor_total) || 0), 0);
  const total = Number(rascunho.total) || 0;
  const dif = Math.round((total - soma) * 100) / 100;
  const el = $('#rev-conferencia');
  el.className = 'conferencia ' + (Math.abs(dif) < 0.01 ? 'ok' : 'dif');
  el.textContent = Math.abs(dif) < 0.01
    ? `✓ Soma dos itens bate com o total do cupom: ${brl(total)}`
    : `Soma dos itens ${brl(soma)} × total do cupom ${brl(total)}: ${dif > 0 ? 'faltam' : 'sobram'} ${brl(Math.abs(dif))}. Confira os itens.`;
  const conferir = rascunho.itens.filter((i) => i.conferir).length;
  $('#rev-qtd').textContent = `${rascunho.itens.length} linhas${rascunho.qtd_total_itens ? ` · cupom diz ${rascunho.qtd_total_itens} itens` : ''}${conferir ? ` · ${conferir} para conferir` : ''}`;
}

function desenharItensRevisao() {
  $('#rev-itens').innerHTML = rascunho.itens.map((it, i) => `
    <div class="item-rev${it.conferir ? ' conferir' : ''}" data-i="${i}">
      ${it.conferir ? '<span class="marca">⚠️ Conferir este item</span>' : ''}
      <input class="desc" data-campo="descricao" value="${esc(it.descricao)}">
      <div class="campos">
        <label>Qtd<input data-campo="quantidade" type="number" step="0.001" inputmode="decimal" value="${it.quantidade}"></label>
        <label>Preço<input data-campo="preco_unit" type="number" step="0.01" inputmode="decimal" value="${it.preco_unit}"></label>
        <label>Total<input data-campo="valor_total" type="number" step="0.01" inputmode="decimal" value="${it.valor_total}"></label>
        <button class="remover" data-remover="${i}" aria-label="Remover item">🗑</button>
      </div>
      <select data-campo="categoria">${CATEGORIAS.map((c) => `<option ${c === it.categoria ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      ${Number(it.desconto) ? `<span class="desconto">desconto de ${brl(it.desconto)}</span>` : ''}
    </div>`).join('');
  atualizarConferencia();
}

$('#rev-itens').addEventListener('input', (e) => {
  const campo = e.target.dataset.campo;
  const caixa = e.target.closest('[data-i]');
  if (!campo || !caixa) return;
  const it = rascunho.itens[Number(caixa.dataset.i)];
  it[campo] = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
  atualizarConferencia();
});
$('#rev-itens').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remover]');
  if (b) { rascunho.itens.splice(Number(b.dataset.remover), 1); desenharItensRevisao(); }
});
$('#btn-add-item').addEventListener('click', () => {
  rascunho.itens.push({ codigo: '', descricao: 'Novo item', quantidade: 1, unidade: 'UN', preco_unit: 0, desconto: 0, valor_total: 0, categoria: 'Outros', conteudo: null, conteudo_unid: null });
  desenharItensRevisao();
});

function limparNota() {
  fotos = [];
  rascunho = null;
  desenharMiniaturas();
  $('#nota-revisao').hidden = true;
  $('#nota-envio').hidden = false;
}
$('#btn-descartar').addEventListener('click', () => { if (confirm('Descartar esta leitura?')) limparNota(); });

$('#btn-salvar').addEventListener('click', async () => {
  const d = $('#rev-data').value;
  if (!d) return aviso('Informe a data da compra.');
  rascunho.data = d + ':00-03:00';
  $('#btn-salvar').disabled = true;
  try {
    await api('/api/compras', { method: 'POST', body: JSON.stringify({ nota: rascunho }) });
    aviso('Compra salva!');
    limparNota();
    await carregar();
    irPara('inicio');
  } catch (err) { aviso(err.message); }
  finally { $('#btn-salvar').disabled = false; }
});

// ---------- início ----------
async function iniciar() {
  try {
    const eu = await api('/api/eu');
    CATEGORIAS = eu.categorias;
    IA = eu.ia;
    $('#tela-login').hidden = true;
    $('#app').hidden = false;
    anunciarPronto();
    await carregar();
  } catch { /* api() já mostrou o login */ }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
iniciar();
