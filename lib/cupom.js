// Monta a nota a partir do texto lido das fotos (OCR gratuito no celular).
// O OCR de cupom térmico erra letras e números; aqui corrigimos o que dá e
// marcamos o resto como "conferir" para a pessoa revisar na tela.

// letras que o OCR costuma trocar por dígitos
const PARA_DIGITO = { T: '7', O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', '|': '1', i: '1', '!': '1', J: '1', S: '5', s: '5', B: '8', G: '6', Z: '2', z: '2', A: '4', g: '9', q: '9' };
const DINHEIRO = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2}(?!\d)/g;

const valor = (s) => {
  if (!s) return null;
  const t = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const r2 = (v) => Math.round(v * 100) / 100;

function eanValido(c) {
  if (!/^\d{8}$|^\d{12,14}$/.test(c)) return false;
  const d = c.split('').map(Number);
  const dv = d.pop();
  const soma = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === dv;
}

// dígitos que o OCR confunde entre si num cupom térmico
const TROCAS = { 0: '869', 1: '7', 3: '8', 5: '6', 6: '858', 7: '1', 8: '0365', 9: '0' };

// EAN com dígito verificador errado: tenta 1 troca comum (ou tirar um dígito dobrado)
// e só aceita se sobrar exatamente um código brasileiro válido (78/79...)
function repararEan(c) {
  if (eanValido(c)) return c;
  const achados = new Set();
  if (c.length === 14) {
    for (let i = 0; i < 14; i++) {
      const s = c.slice(0, i) + c.slice(i + 1);
      if (eanValido(s) && /^7[89]/.test(s)) achados.add(s);
    }
  }
  if (c.length === 13) {
    for (let i = 0; i < 13; i++) {
      for (const t of TROCAS[c[i]] || '') {
        const s = c.slice(0, i) + t + c.slice(i + 1);
        if (eanValido(s) && /^7[89]/.test(s)) achados.add(s);
      }
    }
  }
  return achados.size === 1 ? [...achados][0] : c;
}

// "T896324400021" -> "7896324400021"; devolve null se não parece código
function lerCodigo(tok) {
  if (!tok || tok.length < 3 || tok.length > 15) return null;
  const c = tok.split('').map((ch) => (/\d/.test(ch) ? ch : PARA_DIGITO[ch] ?? 'x')).join('');
  if (c.includes('x')) return null;
  const digitosReais = tok.replace(/\D/g, '').length;
  if (digitosReais < c.length * 0.6) return null; // palavra comum, não código
  return c.length >= 13 ? repararEan(c) : c;
}

function unidadeDe(tok) {
  const t = (tok || '').toUpperCase();
  if (/K[G6]/.test(t)) return 'KG';
  if (/PT|PR/.test(t)) return 'PT';
  if (/CX/.test(t)) return 'CX';
  if (/FR/.test(t)) return 'FR';
  if (/TB|178/.test(t)) return 'TB';
  return 'UN';
}

// Valores no fim da linha: "1PT 29,90 29,90", "1,668KG 11,98 19,98", "UN 14,98 14,98"
function lerValores(linha) {
  const moedas = [...linha.matchAll(DINHEIRO)];
  if (!moedas.length) return null;
  const peso = linha.match(/(\d+[.,]\d{3})\s*K[G6]/i);
  const ultimos = moedas.slice(-2).map((m) => valor(m[0]));
  let [unit, total] = ultimos.length === 2 ? ultimos : [ultimos[0], ultimos[0]];
  const antes = linha.slice(0, moedas[Math.max(0, moedas.length - 2)].index);
  const tokUn = antes.trim().split(/\s+/).pop();
  const qtd = peso ? valor(peso[1]) : 1;
  const unidade = peso ? 'KG' : unidadeDe(tokUn);
  let conferir = false;
  if (unidade !== 'KG' && unit !== total) {
    // um dos dois veio errado; sem como saber qual, mantém o total e pede conferência
    conferir = true;
  }
  if (unidade === 'KG' && Math.abs(r2(qtd * unit) - total) > 0.02) conferir = true;
  return { quantidade: qtd, unidade, preco_unit: unit, valor_total: total, conferir };
}

function limparDescricao(s) {
  return s
    .replace(DINHEIRO, ' ')
    .replace(/\s\d*[.,]?\d*\s*(UN|UM|PT|KG|K6|CX|FR|TB)\b.*$/i, ' ')
    .replace(/[^\wÀ-ú/&.,% -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Lê o texto de UMA foto e devolve itens e dados de cabeçalho/rodapé encontrados
function lerTexto(texto) {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const r = { itens: [], cnpj: null, loja: null, data: null, total: null, qtd_total_itens: null, chave: null, cabecalho: false, rodape: false };
  let pendente = null;

  const fechar = () => { if (pendente) { r.itens.push(pendente); pendente = null; } };

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];

    // cabeçalho
    const cnpj = l.match(/CNPJ[^\d]*([\d .\/-]{14,22})/i);
    if (cnpj) { r.cnpj = cnpj[1].replace(/\D/g, '').slice(0, 14); r.cabecalho = true; }
    if (!r.loja && /LTDA|S\.?\s?A\b|SUPERMERC|MERCADO|ATACAD|DISTRIBUI/i.test(l) && !/CNPJ/i.test(l)) {
      r.loja = l.replace(/^[^A-Z]*/, '').trim();
    }
    const dt = l.match(/(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (dt && !r.data) {
      const ano = dt[3].length === 2 ? '20' + dt[3] : dt[3];
      r.data = `${ano}-${dt[2]}-${dt[1]}T${dt[4]}:${dt[5]}:${dt[6] || '00'}`;
    }
    const chave = l.replace(/[^\d ]/g, '').match(/(\d{4}\s?){11}/);
    if (chave && chave[0].replace(/\D/g, '').length === 44) r.chave = chave[0].replace(/\D/g, '');

    // rodapé
    const qi = l.match(/T[o0]tal\s+de\s+[Il1]?tens\D*(\d{1,4})/i);
    if (qi) { r.qtd_total_itens = Number(qi[1]); r.rodape = true; }
    if (/Total\s+de\s+[Il1]?tens|Valor\s+a\s+Pag|FORMA\s+PAG|VALOR\s+PAGO/i.test(l)) {
      fechar();
      r.rodape = true;
      // procura o total nesta e nas próximas linhas: maior valor com cara de dinheiro
      const trecho = linhas.slice(i, i + 4).join(' ');
      const m = [...trecho.matchAll(/\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}/g)].map((x) => valor(x[0]));
      if (m.length) r.total = Math.max(r.total || 0, ...m);
      continue;
    }
    if (r.rodape) continue;

    // desconto do item anterior: "DESCONTO -11,12% R$ -2,00 15,98"
    if (/DESC[O0]NT[O0]/i.test(l)) {
      const alvo = pendente || r.itens[r.itens.length - 1];
      const d = l.match(/R\$?\s*-\s*(\d+[.,]\d{2})/i);
      const moedas = [...l.matchAll(DINHEIRO)].map((x) => valor(x[0]));
      if (alvo) {
        const novo = moedas.length ? moedas[moedas.length - 1] : null;
        const desc = d ? valor(d[1]) : (novo !== null ? r2(alvo.valor_total - novo) : 0);
        if (desc > 0 && desc < alvo.valor_total) {
          alvo.desconto = desc;
          alvo.valor_total = r2(alvo.valor_total - desc);
        }
      }
      continue;
    }

    // linha de item: começa com código
    const partes = l.replace(/^[^\w|]+/, '').split(/\s+/);
    let cod = lerCodigo(partes[0]);
    let resto = partes.slice(1);
    // "7891 164015459" -> junta pedaços do EAN
    if (cod && cod.length < 13 && partes[1]) {
      const junto = lerCodigo(partes[0] + partes[1]);
      if (junto && (junto.length === 13 || junto.length === 14)) { cod = junto; resto = partes.slice(2); }
    }
    const pareceItem = cod && (cod.length >= 8 || (cod.length <= 6 && /^[A-Z]{2,}/i.test(resto[0] || '')));

    if (pareceItem) {
      fechar();
      const corpo = resto.join(' ');
      const vals = lerValores(corpo);
      pendente = {
        codigo: cod,
        descricao: limparDescricao(corpo),
        quantidade: 1, unidade: 'UN', preco_unit: 0, valor_total: 0, desconto: 0,
        conferir: !eanValido(cod) && cod.length >= 8,
        ...(vals || {}),
      };
      if (vals?.conferir || (cod.length >= 8 && !eanValido(cod))) pendente.conferir = true;
      if (!vals) pendente.semValor = true;
      continue;
    }

    // continuação: valores do item na linha de baixo
    if (pendente?.semValor) {
      const vals = lerValores(l);
      if (vals) {
        Object.assign(pendente, vals, { conferir: pendente.conferir || vals.conferir });
        delete pendente.semValor;
        fechar();
      }
    }
  }
  fechar();
  for (const it of r.itens) {
    if (it.semValor) { it.conferir = true; delete it.semValor; }
  }
  return r;
}

const mesmoItem = (a, b) => a.codigo === b.codigo && Math.abs(a.valor_total - b.valor_total) < 0.01;

// Junta várias fotos: cabeçalho primeiro, rodapé por último, tira a sobreposição nas emendas
function montarNota(textos) {
  const partes = textos.map(lerTexto);
  partes.sort((a, b) => (b.cabecalho - a.cabecalho) || (a.rodape - b.rodape));
  const total = partes.map((p) => p.total).find((t) => t) || null;

  let itens = [];
  for (const p of partes) {
    // candidatos de sobreposição: os k últimos itens já lidos iguais aos k primeiros desta foto
    const cands = [0];
    for (let k = 1; k <= Math.min(6, itens.length, p.itens.length); k++) {
      const fim = itens.slice(-k);
      if (fim.every((it, j) => mesmoItem(it, p.itens[j]))) cands.push(k);
    }
    const somaAtual = itens.reduce((s, i) => s + i.valor_total, 0) + p.itens.reduce((s, i) => s + i.valor_total, 0);
    // com o total conhecido, escolhe a emenda que deixa a soma mais perto dele; senão, a maior sobreposição
    const k = total
      ? cands.reduce((best, c) => {
        const tira = (n) => p.itens.slice(0, n).reduce((s, i) => s + i.valor_total, 0);
        return Math.abs(total - (somaAtual - tira(c))) < Math.abs(total - (somaAtual - tira(best))) ? c : best;
      }, 0)
      : cands[cands.length - 1];
    itens = itens.concat(p.itens.slice(k));
  }

  ajustarPelosIrmaos(itens);
  const pega = (campo) => partes.map((p) => p[campo]).find((v) => v) || null;
  return {
    loja: { nome: pega('loja') || 'Supermercado', cnpj: pega('cnpj'), cidade: null },
    data: pega('data'),
    chave: pega('chave'),
    numero: null,
    total,
    qtd_total_itens: pega('qtd_total_itens'),
    forma_pagamento: null,
    itens: itens.map((it) => ({ ...it, categoria: 'Outros', conteudo: null, conteudo_unid: null })),
    observacoes: '',
  };
}

// O mesmo produto aparece várias vezes no cupom: o preço que mais se repete corrige os que vieram tortos
function ajustarPelosIrmaos(itens) {
  const grupos = new Map();
  for (const it of itens) {
    if (it.unidade === 'KG') continue;
    if (!grupos.has(it.codigo)) grupos.set(it.codigo, []);
    grupos.get(it.codigo).push(it);
  }
  for (const lista of grupos.values()) {
    if (lista.length < 2) continue;
    const votos = {};
    for (const it of lista) for (const v of new Set([it.preco_unit, it.valor_total + it.desconto])) if (v > 0) votos[v] = (votos[v] || 0) + 1;
    const [preco, n] = Object.entries(votos).sort((a, b) => b[1] - a[1])[0] || [];
    if (!preco || n < 2) continue;
    const p = Number(preco);
    for (const it of lista) {
      if (!it.conferir && it.preco_unit === p) continue;
      if (it.preco_unit === p || it.valor_total + it.desconto === p || it.valor_total === 0) {
        it.preco_unit = p;
        it.valor_total = r2(p * it.quantidade - it.desconto);
        it.conferir = !eanValido(it.codigo) && it.codigo.length >= 8;
      }
    }
  }
}

// Texto copiado da página da nota na SEFAZ (consulta pelo QR Code).
// Formato nacional mais comum (SVRS e vários estados):
//   "CAFE PO CAJUBA 500G (Código: 7896324400021) Qtde.:6 UN: PT Vl. Unit.: 29,90 Vl. Total 179,40"
// Se não bater, tenta o leitor de linhas do cupom. O layout de MG ainda precisa ser confirmado.
function lerSefaz(texto, chave = null) {
  const corrido = texto.replace(/\s+/g, ' ');
  const re = /([A-ZÀ-Ú0-9][^()]{2,120}?)\s*\(\s*C[óo]digo:\s*([\w-]+)\s*\)\s*Qtde\.?:\s*([\d.,]+)\s*UN:\s*(\w+)\s*Vl\.\s*Unit\.?:\s*([\d.,]+)\s*Vl\.\s*Total:?\s*([\d.,]+)/gi;
  const itens = [];
  for (const m of corrido.matchAll(re)) {
    const qtd = valor(m[3]);
    const unit = valor(m[5]);
    const total = valor(m[6]);
    itens.push({
      codigo: m[2].replace(/\D/g, '') || m[2],
      descricao: m[1].trim().toUpperCase(),
      quantidade: qtd,
      unidade: unidadeDe(m[4]),
      preco_unit: unit,
      desconto: Math.max(0, r2(qtd * unit - total)),
      valor_total: total,
      conferir: false,
    });
  }
  let nota;
  if (itens.length) {
    const cnpj = corrido.match(/CNPJ:?\s*([\d./-]{14,18})/i);
    const dt = corrido.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
    const total = corrido.match(/Valor a pagar R?\$?:?\s*([\d.,]+)/i);
    const qtdItens = corrido.match(/Qtd\.? total de itens:?\s*(\d+)/i);
    const loja = texto.split(/\r?\n/).map((l) => l.trim()).find((l) => /LTDA|S\.?\s?A\b|SUPERMERC|MERCADO|ATACAD|DISTRIBUI/i.test(l));
    nota = {
      loja: { nome: loja || 'Supermercado', cnpj: cnpj ? cnpj[1].replace(/\D/g, '') : null, cidade: null },
      data: dt ? `${dt[3]}-${dt[2]}-${dt[1]}T${dt[4]}:${dt[5]}:${dt[6]}` : null,
      chave, numero: null,
      total: total ? valor(total[1]) : r2(itens.reduce((s, i) => s + i.valor_total, 0)),
      qtd_total_itens: qtdItens ? Number(qtdItens[1]) : null,
      forma_pagamento: null,
      itens: itens.map((it) => ({ ...it, categoria: 'Outros', conteudo: null, conteudo_unid: null })),
      observacoes: '',
    };
  } else {
    nota = montarNota([texto]);
    nota.chave = chave || nota.chave;
    nota.observacoes = 'O texto da SEFAZ veio num formato ainda não conhecido; os itens foram lidos linha a linha. Confira com atenção.';
  }
  return nota;
}

// Similaridade simples entre descrições (palavras em comum)
function parecido(a, b) {
  const pa = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const pb = new Set(b.split(/\s+/).filter((w) => w.length > 2));
  if (!pa.size || !pb.size) return 0;
  let comum = 0;
  for (const w of pa) if (pb.has(w)) comum++;
  return comum / Math.max(pa.size, pb.size);
}

const distancia = (a, b) => (a.length !== b.length ? Infinity : [...a].filter((c, i) => c !== b[i]).length);

// Corrige código, descrição e categoria com os produtos já cadastrados
function corrigirComCadastro(nota, produtos) {
  const porCodigo = new Map(produtos.map((p) => [p.codigo, p]));
  for (const it of nota.itens) {
    let p = porCodigo.get(it.codigo);
    if (!p && it.codigo.length >= 8) {
      p = produtos.find((x) => distancia(x.codigo, it.codigo) <= 2 && parecido(x.descricao, it.descricao) >= 0.3);
    }
    if (!p) {
      let melhor = null;
      let nota0 = 0.6;
      for (const x of produtos) {
        const s = parecido(x.descricao, it.descricao);
        if (s > nota0) { nota0 = s; melhor = x; }
      }
      p = melhor;
    }
    if (p) {
      it.codigo = p.codigo.startsWith('int:') ? p.codigo.slice(4) : p.codigo;
      it.descricao = p.descricao;
      it.categoria = p.categoria;
      if (eanValido(it.codigo) || p.codigo.startsWith('int:')) {
        // código confirmado; só continua em "conferir" se os valores não fecharam
        it.conferir = it.unidade === 'KG' ? it.conferir : Math.abs(it.preco_unit * it.quantidade - (it.valor_total + it.desconto)) > 0.02;
      }
    }
  }
  return nota;
}

// Chave de acesso dentro do link do QR Code da NFC-e (p=CHAVE|2|1|1|HASH ou chNFe=CHAVE)
function chaveDoQr(url) {
  const m = String(url || '').match(/(?:p=|chNFe=)(\d{44})/i);
  return m ? m[1] : null;
}

module.exports = { lerTexto, montarNota, lerSefaz, corrigirComCadastro, eanValido, lerCodigo, chaveDoQr };
