const test = require('node:test');
const assert = require('node:assert');
const a = require('../lib/analise');

const item = (compra_id, data, codigo, quantidade, preco_unit, valor_total, desconto = 0, categoria = 'Mercearia') =>
  ({ compra_id, data, produto_codigo: codigo, descricao: codigo, nome: null, categoria, quantidade, preco_unit, desconto, valor_total });

// Café: 6 linhas em set (29,90), 6 em out (32,90). Sassami com desconto em out.
const itens = [
  ...Array.from({ length: 6 }, () => item(1, '2026-09-01T10:00:00Z', 'CAFE', 1, 29.9, 29.9)),
  item(1, '2026-09-01T10:00:00Z', 'SASSAMI', 1, 17.98, 17.98, 0, 'Carnes e ovos'),
  ...Array.from({ length: 6 }, () => item(2, '2026-10-01T10:00:00Z', 'CAFE', 1, 32.9, 32.9)),
  item(2, '2026-10-01T10:00:00Z', 'SASSAMI', 1, 17.98, 15.98, 2, 'Carnes e ovos'),
];
const compras = [
  { id: 1, data: '2026-09-01T10:00:00Z', total: 197.38, desconto_total: 0 },
  { id: 2, data: '2026-10-01T10:00:00Z', total: 213.38, desconto_total: 2 },
];

test('junta as linhas repetidas do cupom por compra', () => {
  const g = a.porCompraProduto(itens).filter((x) => x.produto_codigo === 'CAFE');
  assert.equal(g.length, 2);
  assert.equal(g[0].quantidade, 6);
  assert.equal(Math.round(g[0].valor_total * 100) / 100, 179.4);
});

test('histórico de preço separa preço de prateleira e preço pago', () => {
  const h = a.historicoPreco(itens, 'SASSAMI');
  assert.deepEqual(h.map((x) => x.preco_unit), [17.98, 17.98]);
  assert.deepEqual(h.map((x) => x.preco_pago), [17.98, 15.98]);
});

test('resumo calcula variação do café', () => {
  const p = a.resumoProdutos(itens).find((x) => x.codigo === 'CAFE');
  assert.equal(p.vezes, 2);
  assert.equal(p.quantidade_total, 12);
  assert.equal(p.variacao_total, 10.03);
  assert.equal(p.variacao_ultima, 10.03);
});

test('mês soma gasto, economia e categorias', () => {
  const m = a.porMes(itens, compras);
  assert.equal(m.length, 2);
  assert.equal(m[1].gasto, 213.38);
  assert.equal(m[1].economia, 2);
  assert.equal(m[1].categorias['Carnes e ovos'], 15.98);
});

test('inflação da cesta pondera pelo consumo', () => {
  const inf = a.inflacaoCesta(a.resumoProdutos(itens));
  // (6*32.90 + 17.98) / (6*29.90 + 17.98) - 1 = 9,12%
  assert.equal(inf.variacao, 9.12);
  assert.equal(inf.produtos, 2);
});

test('alerta só para mudança de 5% ou mais', () => {
  const al = a.alertasPreco(a.resumoProdutos(itens));
  assert.deepEqual(al.map((x) => x.codigo), ['CAFE']);
});

test('lista sugere o que deve acabar pelo ritmo', () => {
  const l = a.listaSugerida(itens, new Date('2026-10-25T00:00:00Z'));
  const cafe = l.find((x) => x.codigo === 'CAFE');
  assert.equal(cafe.intervalo_dias, 30);
  assert.equal(cafe.faltam_dias, 6);
  assert.equal(cafe.quantidade_media, 6);
  assert.equal(a.listaSugerida(itens, new Date('2026-10-02T00:00:00Z')).length, 0);
});

test('conferência compara soma dos itens com total do cupom', () => {
  const c = a.conferir({ total: 20, qtd_total_itens: 3, itens: [
    { quantidade: 1, unidade: 'UN', valor_total: 5 },
    { quantidade: 1.668, unidade: 'KG', valor_total: 13 },
  ] });
  assert.equal(c.soma, 18);
  assert.equal(c.diferenca, 2);
  assert.equal(c.qtd_lida, 2);
});
