// Cálculos do painel. Recebe as linhas de itens já juntadas com compra e produto:
// { compra_id, data, produto_codigo, descricao, nome, categoria, quantidade, preco_unit, desconto, valor_total }
// Tudo em JS porque o volume de uma casa é pequeno (milhares de linhas).

const DIA = 24 * 60 * 60 * 1000;

const num = (v) => Number(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;
const mesDe = (d) => new Date(d).toISOString().slice(0, 7);

// Preço pago por unidade, já com desconto
function precoEfetivo(item) {
  const q = num(item.quantidade);
  return q > 0 ? num(item.valor_total) / q : num(item.preco_unit);
}

// Um cupom lista cada unidade numa linha; junta por compra + produto
function porCompraProduto(itens) {
  const mapa = new Map();
  for (const it of itens) {
    const k = it.compra_id + '|' + it.produto_codigo;
    let g = mapa.get(k);
    if (!g) {
      g = { ...it, quantidade: 0, valor_total: 0, desconto: 0 };
      mapa.set(k, g);
    }
    g.quantidade += num(it.quantidade);
    g.valor_total += num(it.valor_total);
    g.desconto += num(it.desconto);
  }
  return [...mapa.values()].sort((a, b) => new Date(a.data) - new Date(b.data));
}

function historicoPreco(itens, codigo) {
  return porCompraProduto(itens.filter((i) => i.produto_codigo === codigo)).map((g) => ({
    data: g.data,
    compra_id: g.compra_id,
    quantidade: r2(g.quantidade),
    preco_unit: r2(num(g.preco_unit)),
    preco_pago: r2(precoEfetivo(g)),
  }));
}

function consumoMensal(itens, codigo) {
  const meses = {};
  for (const it of itens) {
    if (it.produto_codigo !== codigo) continue;
    const m = mesDe(it.data);
    meses[m] ??= { mes: m, quantidade: 0, gasto: 0 };
    meses[m].quantidade += num(it.quantidade);
    meses[m].gasto += num(it.valor_total);
  }
  return Object.values(meses)
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((m) => ({ ...m, quantidade: r2(m.quantidade), gasto: r2(m.gasto) }));
}

function resumoProdutos(itens) {
  const grupos = new Map();
  for (const g of porCompraProduto(itens)) {
    if (!grupos.has(g.produto_codigo)) grupos.set(g.produto_codigo, []);
    grupos.get(g.produto_codigo).push(g);
  }
  const lista = [];
  for (const [codigo, compras] of grupos) {
    const primeiro = compras[0];
    const ultimo = compras[compras.length - 1];
    const penultimo = compras.length > 1 ? compras[compras.length - 2] : null;
    const precos = compras.map((c) => num(c.preco_unit));
    const pUlt = num(ultimo.preco_unit);
    const pPri = num(primeiro.preco_unit);
    const pPen = penultimo ? num(penultimo.preco_unit) : null;
    lista.push({
      codigo,
      nome: ultimo.nome || ultimo.descricao,
      descricao: ultimo.descricao,
      categoria: ultimo.categoria || 'Outros',
      vezes: compras.length,
      quantidade_total: r2(compras.reduce((s, c) => s + c.quantidade, 0)),
      gasto_total: r2(compras.reduce((s, c) => s + c.valor_total, 0)),
      ultimo_preco: r2(pUlt),
      primeiro_preco: r2(pPri),
      menor_preco: r2(Math.min(...precos)),
      maior_preco: r2(Math.max(...precos)),
      variacao_total: pPri > 0 && compras.length > 1 ? r2(((pUlt - pPri) / pPri) * 100) : null,
      variacao_ultima: pPen > 0 ? r2(((pUlt - pPen) / pPen) * 100) : null,
      ultima_compra: ultimo.data,
    });
  }
  return lista.sort((a, b) => b.gasto_total - a.gasto_total);
}

function porMes(itens, compras) {
  const meses = {};
  const base = (m) => (meses[m] ??= { mes: m, gasto: 0, economia: 0, compras: 0, categorias: {} });
  // economia vem da compra: inclui o desconto geral que a SEFAZ-MG não reparte por item
  for (const c of compras) {
    const m = base(mesDe(c.data));
    m.gasto += num(c.total);
    m.economia += num(c.desconto_total);
    m.compras += 1;
  }
  for (const it of itens) {
    const m = base(mesDe(it.data));
    const cat = it.categoria || 'Outros';
    m.categorias[cat] = r2((m.categorias[cat] || 0) + num(it.valor_total));
  }
  return Object.values(meses)
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((m) => ({ ...m, gasto: r2(m.gasto), economia: r2(m.economia) }));
}

// Inflação da sua cesta: o que você comprou, pesado pelo quanto você compra,
// comparando o primeiro preço pago com o último (só produtos comprados 2+ vezes)
function inflacaoCesta(produtos) {
  let antes = 0;
  let agora = 0;
  let n = 0;
  for (const p of produtos) {
    if (p.vezes < 2 || p.primeiro_preco <= 0) continue;
    const peso = p.quantidade_total / p.vezes;
    antes += peso * p.primeiro_preco;
    agora += peso * p.ultimo_preco;
    n++;
  }
  return antes > 0 ? { variacao: r2(((agora - antes) / antes) * 100), produtos: n } : null;
}

function alertasPreco(produtos, limite = 5) {
  return produtos
    .filter((p) => p.variacao_ultima !== null && Math.abs(p.variacao_ultima) >= limite)
    .sort((a, b) => b.variacao_ultima - a.variacao_ultima);
}

// Lista sugerida: pelo intervalo médio entre compras, o que deve acabar nos próximos dias
function listaSugerida(itens, hoje = new Date(), horizonteDias = 10) {
  const grupos = new Map();
  for (const g of porCompraProduto(itens)) {
    if (!grupos.has(g.produto_codigo)) grupos.set(g.produto_codigo, []);
    grupos.get(g.produto_codigo).push(g);
  }
  const lista = [];
  for (const [codigo, compras] of grupos) {
    if (compras.length < 2) continue;
    const datas = compras.map((c) => new Date(c.data).getTime());
    const intervalo = (datas[datas.length - 1] - datas[0]) / (datas.length - 1);
    if (intervalo < DIA) continue;
    const proxima = datas[datas.length - 1] + intervalo;
    const faltam = Math.round((proxima - hoje.getTime()) / DIA);
    if (faltam > horizonteDias) continue;
    const ult = compras[compras.length - 1];
    lista.push({
      codigo,
      nome: ult.nome || ult.descricao,
      categoria: ult.categoria || 'Outros',
      quantidade_media: Math.round(compras.reduce((s, c) => s + c.quantidade, 0) / compras.length),
      intervalo_dias: Math.round(intervalo / DIA),
      faltam_dias: faltam,
      ultimo_preco: r2(num(ult.preco_unit)),
    });
  }
  return lista.sort((a, b) => a.faltam_dias - b.faltam_dias);
}

function painel(itens, compras, hoje = new Date()) {
  const produtos = resumoProdutos(itens);
  return {
    meses: porMes(itens, compras),
    produtos,
    inflacao: inflacaoCesta(produtos),
    alertas: alertasPreco(produtos),
    lista: listaSugerida(itens, hoje),
  };
}

// Conferência da leitura: soma dos itens contra o total do cupom
function conferir(nota) {
  const soma = r2((nota.itens || []).reduce((s, i) => s + num(i.valor_total), 0));
  const qtdLida = r2((nota.itens || []).reduce((s, i) => s + (/kg/i.test(i.unidade || '') ? 1 : num(i.quantidade)), 0));
  return {
    soma,
    total: r2(num(nota.total)),
    diferenca: r2(num(nota.total) - soma),
    qtd_lida: qtdLida,
    qtd_cupom: nota.qtd_total_itens ?? null,
  };
}

module.exports = {
  precoEfetivo,
  porCompraProduto,
  historicoPreco,
  consumoMensal,
  resumoProdutos,
  porMes,
  inflacaoCesta,
  alertasPreco,
  listaSugerida,
  painel,
  conferir,
};
